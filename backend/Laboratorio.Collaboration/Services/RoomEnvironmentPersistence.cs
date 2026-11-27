using System.Text.Json;
using Laboratorio.Collaboration.Contracts;
using Laboratorio.Collaboration.Data;
using Microsoft.EntityFrameworkCore;

namespace Laboratorio.Collaboration.Services;

public sealed partial class RoomPersistenceService
{
    private volatile bool _reconcileEnvironment;

    internal void ReconcileEnvironmentDelivery()
    {
        _reconcileEnvironment = true;
        MarkStateUncertain();
    }

    public async Task<EnvironmentChangeDto?> ApplyEnvironmentAsync(string connectionId, EnvironmentCommandDto command)
    {
        var preset = EnvironmentCatalog.Get(command);
        await _writeLock.WaitAsync();
        try
        {
            EnsureReady();
            var previousLighting = store.GetLighting(connectionId);
            var previousParticles = store.GetParticles(connectionId);
            await using var context = await contextFactory.CreateDbContextAsync();
            if (await context.EnvironmentReceipts.FindAsync(command.OperationId) is { } receipt)
            {
                ValidateReceipt(receipt, command);
                return null;
            }
            var change = store.PrepareEnvironment(connectionId, command, preset);
            try
            {
                var room = await context.Rooms.SingleAsync(item => item.RoomId == CollaborationProtocol.RoomId);
                if (change.Mode == "replace")
                {
                    var old = await context.RoomEntities.Where(item => item.RoomId == room.RoomId).ToListAsync();
                    context.RoomEntities.RemoveRange(old);
                }
                context.RoomEntities.AddRange(change.Entities.Select(ToRecord));
                if (change.Lighting.Revision != previousLighting.Revision)
                    room.LightingJson = JsonSerializer.Serialize(change.Lighting);
                if (change.Particles.Revision != previousParticles.Revision)
                    room.ParticlesJson = JsonSerializer.Serialize(change.Particles);
                room.UpdatedAtUtc = DateTime.UtcNow;
                context.EnvironmentReceipts.Add(new EnvironmentReceipt
                {
                    OperationId = command.OperationId, EnvironmentId = command.EnvironmentId,
                    Mode = command.Mode, CatalogVersion = command.CatalogVersion
                });
                try
                {
                    // EF commits all tracked changes in one transaction for both configured providers.
                    await context.SaveChangesAsync();
                }
                catch (Exception writeError)
                {
                    EnvironmentReceipt? persisted;
                    try
                    {
                        await using var verification = await contextFactory.CreateDbContextAsync();
                        persisted = await verification.EnvironmentReceipts.AsNoTracking()
                            .SingleOrDefaultAsync(item => item.OperationId == command.OperationId);
                    }
                    catch (Exception verificationError)
                    {
                        ReconcileEnvironmentDelivery();
                        throw CreatePersistenceException("Não foi possível confirmar a aplicação do ambiente. Aguarde a reconciliação.",
                            new AggregateException(writeError, verificationError), requiresReconciliation: true);
                    }
                    if (persisted is null)
                        throw CreatePersistenceException("O ambiente não foi aplicado.", writeError);
                    ValidateReceipt(persisted, command);
                }
                store.CompleteEnvironment(change);
                if (change.Mode == "replace") _persistedEntities.Clear();
                foreach (var entity in change.Entities) _persistedEntities.Add(entity.Id, entity);
                return change;
            }
            finally
            {
                store.EndEnvironment();
            }
        }
        finally
        {
            _writeLock.Release();
        }
    }

    private static void ValidateReceipt(EnvironmentReceipt receipt, EnvironmentCommandDto command)
    {
        if (receipt.EnvironmentId != command.EnvironmentId || receipt.Mode != command.Mode ||
            receipt.CatalogVersion != command.CatalogVersion)
            throw new InvalidOperationException("O identificador já foi usado para outro comando de ambiente.");
    }
}
