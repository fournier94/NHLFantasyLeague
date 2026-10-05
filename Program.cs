using Microsoft.AspNetCore.DataProtection;
using Microsoft.AspNetCore.DataProtection.KeyManagement;
using Microsoft.AspNetCore.DataProtection.Repositories;
using Microsoft.AspNetCore.Identity;
using Microsoft.AspNetCore.ResponseCompression;
using Microsoft.EntityFrameworkCore;
using NhlFantasyLeague.api.Data;
using NhlFantasyLeague.api.Models;
using NhlFantasyLeague.api.Services;
using NhlFantasyLeague.api.Services.Auth;
using NhlFantasyLeague.api.Services.Cache;
using NhlFantasyLeague.api.Services.CapFreeze;
using NhlFantasyLeague.api.Services.Health;
using NhlFantasyLeague.api.Services.Jobs;
using NhlFantasyLeague.api.Services.NHL;
using System.IO.Compression;

var builder = WebApplication.CreateBuilder(args);

// Render injects a PORT environment variable. Locally, PORT is
// undefined, so we do NOT call UseUrls: launchSettings.json drives
// the binding (https://localhost:7081), which is what the Vite dev
// proxy targets.
var renderPort = Environment.GetEnvironmentVariable("PORT");

if (!string.IsNullOrEmpty(renderPort))
{
    builder.WebHost.UseUrls($"http://0.0.0.0:{renderPort}");
}

// ---------------------------------------------------------------------
// Response compression
// ---------------------------------------------------------------------

builder.Services.AddResponseCompression(options =>
{
    options.EnableForHttps = true;
    options.Providers.Add<BrotliCompressionProvider>();
    options.Providers.Add<GzipCompressionProvider>();
    options.MimeTypes = ResponseCompressionDefaults.MimeTypes.Concat(
        new[]
        {
            "application/json",
            "text/json",
            "application/problem+json",
        });
});

builder.Services.Configure<BrotliCompressionProviderOptions>(options =>
{
    options.Level = CompressionLevel.Fastest;
});

builder.Services.Configure<GzipCompressionProviderOptions>(options =>
{
    options.Level = CompressionLevel.Fastest;
});

builder.Services.AddDbContext<AppDbContext>(options =>
    options.UseNpgsql(
        builder.Configuration.GetConnectionString("DefaultConnection")));

// ---------------------------------------------------------------------
// Data Protection — key ring persisted to PostgreSQL
// ---------------------------------------------------------------------

builder.Services.AddSingleton<IXmlRepository, EfCoreXmlRepository>();
builder.Services.AddDataProtection()
    .SetApplicationName("NhlFantasyLeague");

builder.Services.AddOptions<KeyManagementOptions>()
    .Configure<IXmlRepository>((options, repository) =>
    {
        options.XmlRepository = repository;
    });

// ---------------------------------------------------------------------
// Identity + cookie authentication
// ---------------------------------------------------------------------

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

        options.Cookie.SecurePolicy = builder.Configuration
     .GetValue<bool>("Auth:CookieRequireHttps", false)
         ? CookieSecurePolicy.Always
         : CookieSecurePolicy.None;

        options.ExpireTimeSpan = TimeSpan.FromDays(365);
        options.SlidingExpiration = true;

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

// ---------------------------------------------------------------------
// NHL services
// ---------------------------------------------------------------------

builder.Services.AddHttpClient<NhlPlayerService>();
builder.Services.AddHttpClient<NhlTeamService>();
builder.Services.AddHttpClient<NhlStatsService>();
builder.Services.AddHttpClient<NhlGameLogService>();
builder.Services.AddHttpClient<NhlInjuryService>();
builder.Services.AddScoped<PlayerDetailService>();

// ---------------------------------------------------------------------
// CapFreeze services
// ---------------------------------------------------------------------

builder.Services.AddHttpClient<CapFreezePageService>();
builder.Services.AddScoped<CapFreezeMatchingService>();
builder.Services.AddScoped<CapFreezeContractService>();
builder.Services.AddScoped<CapFreezeSyncService>();

// ---------------------------------------------------------------------
// League, roster and auth services
// ---------------------------------------------------------------------

builder.Services.AddScoped<NhlPopulationService>();
builder.Services.AddScoped<LeagueSetupService>();
builder.Services.AddScoped<RosterAdminService>();
builder.Services.AddScoped<AuthService>();

// ---------------------------------------------------------------------
// Health / external-source tracking
// ---------------------------------------------------------------------

builder.Services.AddScoped<ExternalSourceHealthService>();

builder.Services.AddHttpClient<PlayerRosterStatusService>(client =>
{
    client.Timeout = TimeSpan.FromSeconds(90);
});

// ---------------------------------------------------------------------
// Background jobs, live cache, response cache
// ---------------------------------------------------------------------

// Existing long-running job runner (refresh-all, roster status,
// hat-trick backfill). Browser-facing; polled.
builder.Services.AddSingleton<BackgroundJobService>();

// In-memory live game cache. Serves Game Day without touching the DB.
builder.Services.AddSingleton<LiveGameCache>();

// Response cache. Short-circuits repeated GETs so user traffic does
// not wake Neon on every page load.
builder.Services.AddSingleton<ResponseCacheService>();

// Scheduled jobs runner. Owns the six jobs and their state. Injects
// IServiceScopeFactory so it can create scopes for scoped services.
builder.Services.AddSingleton<ScheduledJobsRunner>();

// The tick loop. Runs every 30 s in the background.
builder.Services.AddHostedService<ScheduledJobsHostedService>();

// Game Day service (schedule, boxscore, live cache refresh, post-game write).
builder.Services.AddHttpClient<NhlGameService>();

// Bootstraps the Commissioner role from appsettings on startup.
builder.Services.AddHostedService<CommissionerBootstrapService>();

var app = builder.Build();

// Apply any pending EF Core migrations at startup.
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

app.UseResponseCompression();

app.UseAuthentication();
app.UseAuthorization();

// Lightweight warm-up endpoint for the cron job.
app.MapGet("/ping", () => Results.Ok("pong"))
   .AllowAnonymous();

app.MapControllers();

app.Run();