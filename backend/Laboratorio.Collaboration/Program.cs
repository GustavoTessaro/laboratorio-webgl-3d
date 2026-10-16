using Laboratorio.Collaboration.Hubs;
using Laboratorio.Collaboration.Data;
using Laboratorio.Collaboration.Services;
using Microsoft.EntityFrameworkCore;

var builder = WebApplication.CreateBuilder(args);
var frontendOrigins = builder.Configuration
    .GetSection("FrontendOrigins")
    .Get<string[]>()
    ?? ["http://localhost:5173", "http://127.0.0.1:5173"];

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
var persistenceProvider = builder.Configuration["Persistence:Provider"] ?? "Sqlite";
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

        builder.Services.AddDbContextFactory<RoomDbContext>(options => options.UseSqlServer(roomConnectionString));
        break;
    default:
        throw new InvalidOperationException(
            $"Provedor de persistência desconhecido: {persistenceProvider}.");
}

builder.Services.AddSingleton<RoomPersistenceService>();
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
