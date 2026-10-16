import {
  HubConnectionBuilder,
  HubConnectionState,
  LogLevel,
} from '@microsoft/signalr';

export const COLLABORATION_PROTOCOL_VERSION = 1;
export const COLLABORATION_ROOM_ID = 'laboratorio-principal';
const HUB_URL = import.meta.env.VITE_COLLABORATION_URL
  ?? 'http://localhost:5080/hubs/laboratory';

export class CollaborationClient {
  constructor(handlers = {}) {
    this.handlers = handlers;
    this.joined = false;
    this.displayName = '';
    this.initialEntities = [];
    this.heldLocks = new Set();
    this.pendingLocks = new Map();
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
    this.connection.on('LockChanged', (editLock) => this.handlers.onLockChanged?.(editLock));
    this.connection.on('LockExpired', (editLock) => this.handlers.onLockChanged?.(editLock));
    this.connection.onreconnecting(() => {
      this.joined = false;
      this.heldLocks.clear();
      this.handlers.onStatus?.('reconnecting', 'Reconectando à sala…');
    });
    this.connection.onreconnected(async () => {
      this.handlers.onStatus?.('connecting', 'Reconectado; sincronizando a sala…');
      try {
        await this.joinRoom();
      } catch (error) {
        this.handlers.onStatus?.('disconnected', 'Reconexão incompleta · alterações locais preservadas');
        this.handlers.onTransportError?.(error);
      }
    });
    this.connection.onclose(() => {
      this.joined = false;
      this.heldLocks.clear();
      this.stopRenewal();
      this.handlers.onStatus?.('disconnected', 'Colaboração desconectada · modo local');
    });
  }

  get connected() {
    return this.joined && this.connection.state === HubConnectionState.Connected;
  }

  async connect(displayName, initialEntities) {
    this.displayName = displayName;
    this.initialEntities = initialEntities;
    this.handlers.onStatus?.('connecting', 'Conectando à sala…');
    try {
      if (this.connection.state === HubConnectionState.Disconnected) {
        await this.connection.start();
      }
      return await this.joinRoom();
    } catch (error) {
      this.handlers.onStatus?.('disconnected', 'Colaboração indisponível · alterações locais preservadas');
      throw error;
    }
  }

  async joinRoom() {
    const snapshot = await this.connection.invoke(
      'JoinRoom',
      this.displayName,
      COLLABORATION_PROTOCOL_VERSION,
      this.initialEntities,
    );
    this.joined = true;
    this.handlers.onStatus?.('connected', `Conectado à sala ${snapshot.roomId}`);
    this.handlers.onSnapshot?.(snapshot);
    return snapshot;
  }

  async acquireEditLock(entityId) {
    if (!this.connected) return { granted: false, reason: 'A colaboração está desconectada.' };
    if (this.heldLocks.has(entityId)) return { granted: true };
    if (this.pendingLocks.has(entityId)) return this.pendingLocks.get(entityId);

    const request = this.connection.invoke('AcquireEditLock', entityId)
      .then((result) => {
        if (result.granted) {
          this.heldLocks.add(entityId);
          this.startRenewal();
        }
        return result;
      })
      .finally(() => this.pendingLocks.delete(entityId));
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

  async deleteEntity(entityId) {
    await this.connection.invoke('DeleteEntity', entityId);
    this.heldLocks.delete(entityId);
    if (this.heldLocks.size === 0) this.stopRenewal();
  }

  async stop() {
    this.stopRenewal();
    this.heldLocks.clear();
    if (this.connection.state !== HubConnectionState.Disconnected) {
      await this.connection.stop();
    }
  }

  startRenewal() {
    if (this.renewalTimer) return;
    this.renewalTimer = window.setInterval(async () => {
      if (!this.connected) return;
      for (const entityId of this.heldLocks) {
        try {
          const renewed = await this.connection.invoke('RenewEditLock', entityId);
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
