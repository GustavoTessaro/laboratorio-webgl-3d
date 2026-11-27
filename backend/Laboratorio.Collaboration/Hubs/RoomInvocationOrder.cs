using Microsoft.AspNetCore.SignalR;

namespace Laboratorio.Collaboration.Hubs;

public sealed class RoomInvocationOrder : IHubFilter
{
    private readonly SemaphoreSlim _gate = new(1, 1);

    internal Task EnterAsync(CancellationToken cancellationToken = default) => _gate.WaitAsync(cancellationToken);
    internal void Exit() => _gate.Release();

    public async ValueTask<object?> InvokeMethodAsync(HubInvocationContext context,
        Func<HubInvocationContext, ValueTask<object?>> next)
    {
        await EnterAsync(context.Context.ConnectionAborted);
        try { return await next(context); }
        finally { Exit(); }
    }
}
