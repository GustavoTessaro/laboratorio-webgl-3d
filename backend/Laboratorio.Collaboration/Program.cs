using Laboratorio.Collaboration.Hubs;
using Laboratorio.Collaboration.Data;
using Laboratorio.Collaboration.Services;
using Microsoft.EntityFrameworkCore;

var builder = WebApplication.CreateBuilder(args);
var frontendOrigins = builder.Configuration
    .GetSection("FrontendOrigins")
    .Get<string[]>()
    ?? [];
if (builder.Environment.IsProduction() && frontendOrigins.Length == 0)
{
    throw new InvalidOperationException(
        "Configure FrontendOrigins com a origem HTTPS exata do frontend em produção.");
}

foreach (var origin in frontendOrigins)
{
    if (!Uri.TryCreate(origin, UriKind.Absolute, out var parsedOrigin) ||
        parsedOrigin.Scheme is not ("http" or "https") ||
        parsedOrigin.GetLeftPart(UriPartial.Authority) != origin ||
        origin.Contains('*') ||
        (builder.Environment.IsProduction() && parsedOrigin.Scheme != Uri.UriSchemeHttps))
    {
        throw new InvalidOperationException(
            $"Origem CORS inválida: '{origin}'. Configure apenas origens exatas, sem caminhos ou curingas.");
    }
}

builder.Services.AddCors(options => options.AddPolicy("Frontend", policy =>
{
    policy.WithOrigins(frontendOrigins)
        .AllowAnyHeader()
        .AllowAnyMethod()
        .AllowCredentials();
}));
builder.Services.AddSignalR(options =>
{
    options.MaximumReceiveMessageSize = 256 * 1024;
});
builder.Services.AddSingleton<RoomStateStore>();
var persistenceProvider = builder.Configuration["Persistence:Provider"]
    ?? (builder.Environment.IsDevelopment() ? "Sqlite" : "SqlServer");
var roomConnectionString = builder.Configuration.GetConnectionString("RoomDatabase");
switch (persistenceProvider.ToLowerInvariant())
{
    case "sqlite":
        Directory.CreateDirectory(Path.Combine(builder.Environment.ContentRootPath, "App_Data"));
        roomConnectionString ??= $"Data Source={Path.Combine(
            builder.Environment.ContentRootPath,
            "App_Data",
            "laboratorio-collaboration.db")}";
        builder.Services.AddDbContextFactory<RoomDbContext>(options => options.UseSqlite(roomConnectionString));
        break;
    case "sqlserver":
        if (string.IsNullOrWhiteSpace(roomConnectionString))
        {
            throw new InvalidOperationException(
                "Configure ConnectionStrings:RoomDatabase por ambiente para usar SQL Server.");
        }

        builder.Services.AddDbContextFactory<RoomDbContext>(options => options.UseSqlServer(
            roomConnectionString,
            sqlServer => sqlServer.EnableRetryOnFailure(
                maxRetryCount: 3,
                maxRetryDelay: TimeSpan.FromSeconds(5),
                errorNumbersToAdd: null)));
        break;
    default:
        throw new InvalidOperationException(
            $"Provedor de persistência desconhecido: {persistenceProvider}.");
}

builder.Services.AddSingleton(serviceProvider => new RoomPersistenceService(
    serviceProvider.GetRequiredService<IDbContextFactory<RoomDbContext>>(),
    serviceProvider.GetRequiredService<RoomStateStore>(),
    serviceProvider.GetRequiredService<ILogger<RoomPersistenceService>>(),
    builder.Configuration.GetValue<bool?>("Persistence:ApplyMigrationsOnStartup")
        ?? builder.Environment.IsDevelopment(),
    hubContext: serviceProvider.GetRequiredService<Microsoft.AspNetCore.SignalR.IHubContext<LaboratoryHub>>()));
builder.Services.AddHostedService(serviceProvider =>
    serviceProvider.GetRequiredService<RoomPersistenceService>());
builder.Services.AddHostedService<LockLeaseCleanupService>();

var app = builder.Build();
app.UseCors("Frontend");
app.MapGet("/", () => Results.Ok(new
{
    service = "Laboratório WebGL 3D Collaboration",
    protocolVersion = 1,
    room = "laboratorio-principal",
}));
app.MapHub<LaboratoryHub>("/hubs/laboratory");
app.Run();

public partial class Program { }
