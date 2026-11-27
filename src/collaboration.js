import {
  HubConnectionBuilder,
  HubConnectionState,
  LogLevel,
} from '@microsoft/signalr';

export const COLLABORATION_PROTOCOL_VERSION = 10;
export const COLLABORATION_ROOM_ID = 'laboratorio-principal';
const HUB_URL = import.meta.env.VITE_COLLABORATION_URL?.trim()
  || (import.meta.env.DEV ? 'http://localhost:5080/hubs/laboratory' : null);

export class CollaborationClient {
  constructor(handlers = {}) {
    if (!HUB_URL) {
      throw new Error('Configure VITE_COLLABORATION_URL para habilitar a colaboração.');
    }
    if (!import.meta.env.DEV) {
      let hubUrl;
      try {
        hubUrl = new URL(HUB_URL);
      } catch {
        throw new Error('VITE_COLLABORATION_URL deve ser uma URL HTTPS absoluta.');
      }
      if (hubUrl.protocol !== 'https:' || hubUrl.pathname !== '/hubs/laboratory') {
        throw new Error('VITE_COLLABORATION_URL deve usar HTTPS e terminar em /hubs/laboratory.');
      }
    }

    this.handlers = handlers;
    this.joined = false;
    this.displayName = '';
    this.initialEntities = [];
    this.connectPromise = null;
    this.joinPromise = null;
    this.lastSnapshot = null;
    this.connectionGeneration = 0;
    this.stopPromise = null;
    this.heldLocks = new Set();
    this.pendingLocks = new Map();
    this.queuedEnvironments = [];
    this.renewalTimer = null;
    this.connection = new HubConnectionBuilder()
      .withUrl(HUB_URL)
      .withAutomaticReconnect([0, 2000, 5000, 10000])
      .configureLogging(LogLevel.Warning)
      .build();

    this.connection.on('ParticipantJoined', (participant) => this.handlers.onParticipantJoined?.(participant));
    this.connection.on('ParticipantLeft', (participantId) => this.handlers.onParticipantLeft?.(participantId));
    this.connection.on('EntityUpserted', (entity) => this.handlers.onEntityUpserted?.(entity));
    this.connection.on('EntityDeleted', (entityId) => this.handlers.onEntityDeleted?.(entityId));
    this.connection.on('RoomLightingChanged', (state) => this.handlers.onLighting?.(state));
    this.connection.on('RoomParticlesChanged', (state) => this.handlers.onParticles?.(state));
    this.connection.on('EnvironmentApplied', (change) => {
      if (this.joined) this.handlers.onEnvironment?.(change);
      else this.queuedEnvironments.push(change);
    });
    this.connection.on('EnvironmentReconciled', (snapshot) => this.handlers.onSnapshot?.(snapshot));
    this.connection.on('LockChanged', (editLock) => this.handlers.onLockChanged?.(editLock));
    this.connection.on('LockExpired', (editLock) => this.handlers.onLockChanged?.(editLock));
    this.connection.onreconnecting(() => {
      this.joined = false;
      this.queuedEnvironments.length = 0;
      this.heldLocks.clear();
      this.pendingLocks.clear();
      this.handlers.onStatus?.('reconnecting', 'Reconectando à sala…');
    });
    this.connection.onreconnected(async () => {
      if (this.connection.state !== HubConnectionState.Connected) return;
      const generation = this.connectionGeneration;
      this.handlers.onStatus?.('reconnecting', 'Reconectando à sala...');
      try {
        await this.joinRoom(generation);
      } catch (error) {
        if (generation === this.connectionGeneration) {
          this.handlers.onStatus?.(
            'error',
            'Não foi possível sincronizar a reconexão. Tente conectar novamente.',
          );
        }
      }
    });
    this.connection.onclose(() => {
      this.joined = false;
      this.queuedEnvironments.length = 0;
      this.heldLocks.clear();
      this.pendingLocks.clear();
      this.stopRenewal();
      this.handlers.onStatus?.('disconnected', 'Colaboração desconectada · modo local');
    });
  }

  get connected() {
    return this.joined && this.connection.state === HubConnectionState.Connected;
  }

  async connect(displayName, initialEntities) {
    if (this.stopPromise) {
      const pendingConnect = this.connectPromise;
      await this.stopPromise;
      if (pendingConnect) {
        try {
          await pendingConnect;
        } catch (error) {
          if (error.name !== 'AbortError') throw error;
        }
      }
    }
    if (this.connectPromise) return this.connectPromise;
    if (this.connected && this.lastSnapshot) return this.lastSnapshot;

    this.displayName = displayName;
    this.initialEntities = initialEntities;
    const generation = ++this.connectionGeneration;
    const attempt = this.connectAndJoin(generation);
    this.connectPromise = attempt;
    try {
      return await attempt;
    } catch (error) {
      this.joined = false;
      if (generation !== this.connectionGeneration) {
        const cancellation = new Error('A tentativa de conexão foi cancelada.');
        cancellation.name = 'AbortError';
        throw cancellation;
      }
      this.handlers.onStatus?.(
        'error',
        'Não foi possível conectar agora. Verifique a conexão e tente novamente.',
      );
      throw error;
    } finally {
      if (this.connectPromise === attempt) this.connectPromise = null;
    }
  }

  async joinRoom(generation = this.connectionGeneration) {
    if (generation !== this.connectionGeneration) {
      throw new Error('A tentativa de conexão foi cancelada.');
    }
    if (this.connection.state !== HubConnectionState.Connected) {
      throw new Error('A conexão SignalR ainda não está pronta para entrar na sala.');
    }
    if (this.joinPromise) return this.joinPromise;
    if (this.joined && this.lastSnapshot) return this.lastSnapshot;

    const attempt = this.connection.invoke(
      'JoinRoom',
      this.displayName,
      COLLABORATION_PROTOCOL_VERSION,
      this.initialEntities,
    ).then((snapshot) => {
      if (generation !== this.connectionGeneration) {
        throw new Error('A tentativa de conexão foi cancelada.');
      }
      this.joined = true;
      this.lastSnapshot = snapshot;
      this.handlers.onStatus?.('connected', `Conectado à sala ${snapshot.roomId}`);
      this.handlers.onSnapshot?.(snapshot);
      for (const change of this.queuedEnvironments.splice(0)) this.handlers.onEnvironment?.(change);
      return snapshot;
    }).catch((error) => {
      if (generation === this.connectionGeneration) this.joined = false;
      throw error;
    });
    this.joinPromise = attempt;
    try {
      return await attempt;
    } finally {
      if (this.joinPromise === attempt) this.joinPromise = null;
    }
  }

  async connectAndJoin(generation) {
    this.handlers.onStatus?.('connecting', 'Conectando à sala...');
    if (this.connection.state === HubConnectionState.Disconnected) {
      await this.connection.start();
    }
    if (generation !== this.connectionGeneration) {
      throw new Error('A tentativa de conexão foi cancelada.');
    }
    if (this.connection.state !== HubConnectionState.Connected) {
      throw new Error('A conexão SignalR não chegou ao estado conectado.');
    }
    return this.joinRoom(generation);
  }

  async acquireEditLock(entityId) {
    if (!this.connected) return { granted: false, reason: 'A colaboração está desconectada.' };
    if (this.heldLocks.has(entityId)) return { granted: true };
    if (this.pendingLocks.has(entityId)) return this.pendingLocks.get(entityId);

    const connectionId = this.connection.connectionId;
    const request = this.connection.invoke('AcquireEditLock', entityId)
      .then((result) => {
        if (!this.connected || connectionId !== this.connection.connectionId) {
          return { granted: false, reason: 'A conexão mudou durante o bloqueio.' };
        }
        if (result.granted) {
          this.heldLocks.add(entityId);
          this.startRenewal();
        }
        return result;
      })
      .finally(() => {
        if (this.pendingLocks.get(entityId) === request) this.pendingLocks.delete(entityId);
      });
    this.pendingLocks.set(entityId, request);
    return request;
  }

  async releaseEditLock(entityId) {
    this.heldLocks.delete(entityId);
    if (this.connected) await this.connection.invoke('ReleaseEditLock', entityId);
    if (this.heldLocks.size === 0) this.stopRenewal();
  }

  async createEntity(entity) {
    return this.connection.invoke('CreateEntity', entity);
  }

  async updateEntity(entity, final = false) {
    return this.connection.invoke('UpdateEntity', entity, final);
  }

  updateLighting({ group, patch }) {
    return this.connection.invoke('UpdateLighting', group, patch);
  }

  updateParticles(command) {
    return this.connection.invoke('UpdateParticles', command);
  }

  applyEnvironment(command) {
    return this.connection.invoke('ApplyEnvironment', command);
  }

  async deleteEntity(entityId) {
    await this.connection.invoke('DeleteEntity', entityId);
    this.heldLocks.delete(entityId);
    if (this.heldLocks.size === 0) this.stopRenewal();
  }

  async stop() {
    if (this.stopPromise) return this.stopPromise;
    this.connectionGeneration += 1;
    this.joined = false;
    this.stopRenewal();
    this.heldLocks.clear();
    this.pendingLocks.clear();
    const attempt = this.stopConnection();
    this.stopPromise = attempt;
    try {
      await attempt;
    } finally {
      if (this.stopPromise === attempt) this.stopPromise = null;
    }
  }

  async stopConnection() {
    if (this.connection.state !== HubConnectionState.Disconnected) {
      await this.connection.stop();
    }
  }

  startRenewal() {
    if (this.renewalTimer) return;
    this.renewalTimer = window.setInterval(async () => {
      if (!this.connected) return;
      const connectionId = this.connection.connectionId;
      for (const entityId of this.heldLocks) {
        try {
          const renewed = await this.connection.invoke('RenewEditLock', entityId);
          if (!this.connected || connectionId !== this.connection.connectionId) return;
          if (!renewed) {
            this.heldLocks.delete(entityId);
            this.handlers.onLockLost?.(entityId);
          }
        } catch (error) {
          this.handlers.onTransportError?.(error);
        }
      }
      if (this.heldLocks.size === 0) this.stopRenewal();
    }, 6000);
  }

  stopRenewal() {
    if (!this.renewalTimer) return;
    window.clearInterval(this.renewalTimer);
    this.renewalTimer = null;
  }
}
