using Laboratorio.Collaboration.Contracts;
using Laboratorio.Collaboration.Hubs;
using Microsoft.AspNetCore.SignalR;

namespace Laboratorio.Collaboration.Services;

public sealed class LockLeaseCleanupService(
    RoomStateStore store,
    IHubContext<LaboratoryHub> hubContext,
    ILogger<LockLeaseCleanupService> logger) : BackgroundService
{
    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        using var timer = new PeriodicTimer(TimeSpan.FromSeconds(2));
        while (await timer.WaitForNextTickAsync(stoppingToken))
        {
            foreach (var expiredLock in store.ExpireLocks())
            {
                try
                {
                    await hubContext.Clients.Group(CollaborationProtocol.RoomId)
                        .SendAsync("LockChanged", new EditLockDto(
                            expiredLock.EntityId,
                            string.Empty,
                            string.Empty), stoppingToken);
                }
                catch (OperationCanceledException) when (stoppingToken.IsCancellationRequested)
                {
                    return;
                }
                catch (Exception exception)
                {
                    logger.LogWarning(exception, "Falha ao notificar expiração de bloqueio {EntityId}", expiredLock.EntityId);
                }
            }
        }
    }
}
