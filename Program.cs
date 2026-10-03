using Microsoft.AspNetCore.Identity;
using Microsoft.EntityFrameworkCore;
using NhlFantasyLeague.api.Data;
using NhlFantasyLeague.api.Models;
using NhlFantasyLeague.api.Services;
using NhlFantasyLeague.api.Services.Auth;
using NhlFantasyLeague.api.Services.NHL;
using NhlFantasyLeague.api.Services.CapFreeze;
using NhlFantasyLeague.api.Services.Health;

var builder = WebApplication.CreateBuilder(args);

// Render injects a PORT environment variable (default 10000) and
// requires the app to bind to 0.0.0.0 on that port.
var renderPort = Environment.GetEnvironmentVariable("PORT") ?? "10000";
builder.WebHost.UseUrls($"http://0.0.0.0:{renderPort}");

builder.Services.AddDbContext<AppDbContext>(options =>
    options.UseNpgsql(
        builder.Configuration.GetConnectionString("DefaultConnection")));

builder.Services
    .AddIdentityCore<ApplicationUser>(options =>
    {
        options.Password.RequiredLength = 6;
        options.Password.RequireDigit = false;
        options.Password.RequireUppercase = false;
        options.Password.RequireLowercase = false;
        options.Password.RequireNonAlphanumeric = false;
        options.User.RequireUniqueEmail = false;
        options.Lockout.MaxFailedAccessAttempts = 10;
        options.Lockout.DefaultLockoutTimeSpan = TimeSpan.FromMinutes(15);
    })
    .AddRoles<IdentityRole<int>>()
    .AddSignInManager()
    .AddEntityFrameworkStores<AppDbContext>()
    .AddDefaultTokenProviders();

builder.Services
    .AddAuthentication(IdentityConstants.ApplicationScheme)
    .AddCookie(IdentityConstants.ApplicationScheme, options =>
    {
        options.Cookie.Name = "LigueMousse.Auth";
        options.Cookie.HttpOnly = true;
        options.Cookie.SameSite = SameSiteMode.Lax;
        options.Cookie.SecurePolicy = CookieSecurePolicy.None;
        options.Events.OnRedirectToLogin = ctx =>
        {
            ctx.Response.StatusCode = StatusCodes.Status401Unauthorized;
            return Task.CompletedTask;
        };
        options.Events.OnRedirectToAccessDenied = ctx =>
        {
            ctx.Response.StatusCode = StatusCodes.Status403Forbidden;
            return Task.CompletedTask;
        };
    });

builder.Services.AddAuthorization();

builder.Services.AddControllers(options =>
{
    options.Filters.Add(new Microsoft.AspNetCore.Mvc.Authorization.AuthorizeFilter());
});

builder.Services.AddEndpointsApiExplorer();
builder.Services.AddSwaggerGen();

builder.Services.AddHttpClient<NhlPlayerService>();
builder.Services.AddHttpClient<NhlTeamService>();
builder.Services.AddHttpClient<NhlStatsService>();
builder.Services.AddHttpClient<NhlGameLogService>();
builder.Services.AddHttpClient<NhlInjuryService>();
builder.Services.AddScoped<PlayerDetailService>();

builder.Services.AddHttpClient<CapFreezePageService>();
builder.Services.AddScoped<CapFreezeMatchingService>();
builder.Services.AddScoped<CapFreezeContractService>();
builder.Services.AddScoped<CapFreezeSyncService>();

builder.Services.AddScoped<NhlPopulationService>();
builder.Services.AddScoped<LeagueSetupService>();
builder.Services.AddScoped<RosterAdminService>();
builder.Services.AddScoped<AuthService>();

builder.Services.AddScoped<ExternalSourceHealthService>();

builder.Services.AddHttpClient<PlayerRosterStatusService>(client =>
{
    client.Timeout = TimeSpan.FromSeconds(90);
});

builder.Services.AddHostedService<CommissionerBootstrapService>();

var app = builder.Build();

// Render health check: return 200 OK on the root path.
app.MapGet("/", () => Results.Ok("OK"));

// Apply pending EF Core migrations at startup.
using (var scope = app.Services.CreateScope())
{
    var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
    db.Database.Migrate();
}

if (app.Environment.IsDevelopment())
{
    app.UseSwagger();
    app.UseSwaggerUI();
    app.UseHttpsRedirection();
}

app.UseAuthentication();
app.UseAuthorization();
app.MapGet("/api/test", () => "Minimal API is working");
app.MapControllers();

app.Run();