using Laboratorio.Collaboration.Hubs;
using Laboratorio.Collaboration.Services;

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
builder.Services.AddSingleton<RoomStateStore>(_ => new RoomStateStore());
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
