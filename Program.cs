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
// requires the app to bind to 0.0.0.0 on that port. Configuring
// Kestrel explicitly here avoids any ambiguity with environment
// variables like ASPNETCORE_URLS or ASPNETCORE_HTTP_PORTS.
var renderPort = Environment.GetEnvironmentVariable("PORT") ?? "10000";
builder.WebHost.UseUrls($"http://0.0.0.0:{renderPort}");

builder.Services.AddDbContext<AppDbContext>(options =>
    options.UseNpgsql(
        builder.Configuration.GetConnectionString("DefaultConnection")));

// ---------------------------------------------------------------------
// Identity + cookie authentication
// ---------------------------------------------------------------------

builder.Services
    .AddIdentityCore<ApplicationUser>(options =>
    {
        // Reasonable defaults for a private 12-person league. Password
        // rules are still enforced but relaxed compared to the Identity
        // defaults (which require non-alphanumeric characters, etc.).
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
        // TODO Dev-only: allow the cookie to be set over plain HTTP so LAN
        // testing from a phone works. Flip back to SameAsRequest (or
        // Always) once you host the app behind HTTPS.
        options.Cookie.SecurePolicy = CookieSecurePolicy.None;

        // Return 401/403 instead of redirecting to a login page. The
        // SPA handles redirects itself.
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

// Every controller requires an authenticated user by default, unless
// it explicitly opts out with [AllowAnonymous]. Keeps the surface
// safe by construction.
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

// Records the last success and failure of every external data source
// our sync jobs depend on. Consumed by the admin banner and by the
// PlayerRosterStatusService escalation ladder.
builder.Services.AddScoped<ExternalSourceHealthService>();

// Computes each player's RosterLocation (NHL / AHL / Injured /
// NotOnActiveRoster) by combining NHL rosters, AHL rosters and the
// injury flags already written by NhlInjuryService. A no-op while
// PlayerStatus:Enabled is false in appsettings.
builder.Services.AddHttpClient<PlayerRosterStatusService>(client =>
{
    client.Timeout = TimeSpan.FromSeconds(90);
});

// ---------------------------------------------------------------------
// NOTE: CommissionerBootstrapService is intentionally NOT registered
// as a hosted service anymore. Its work (EnsureCommissionersAsync) is
// now run from the background initialization task below, AFTER the
// database migrations have completed. Running it as a hosted service
// would race with migrations and fail on a fresh database.
// ---------------------------------------------------------------------

var app = builder.Build();

// ---------------------------------------------------------------------
// BACKGROUND INITIALIZATION
//
// The HTTP server starts listening immediately when app.Run() is
// called below. Migrations and the commissioner bootstrap then run in
// parallel on a background task. This is critical for Render: their
// edge router opens a TCP health check on the assigned port and only
// routes real traffic once the port is open. Running migrations
// synchronously BEFORE app.Run() would delay the port from opening
// for 10-30+ seconds, which is exactly what caused the
// X-Render-Routing: no-server responses.
//
// The trade-off is a small window (a few seconds) at cold start where
// the port is open but the database tables may not yet exist. For a
// 12-person fantasy league this is acceptable; Render retries failed
// requests, and the first real user request usually arrives well after
// migrations complete.
// ---------------------------------------------------------------------

_ = Task.Run(async () =>
{
    try
    {
        using var scope = app.Services.CreateScope();

        // 1. Apply pending EF Core migrations.
        var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
        await db.Database.MigrateAsync();

        Console.WriteLine("[BOOTSTRAP] Database migrations applied.");

        // 2. Ensure the Commissioner role exists and is assigned to
        //    every username listed in appsettings
        //    (Auth:CommissionerUsernames). Idempotent.
        var authService = scope.ServiceProvider.GetRequiredService<AuthService>();
        await authService.EnsureCommissionersAsync();

        Console.WriteLine("[BOOTSTRAP] Commissioner bootstrap completed.");
    }
    catch (Exception ex)
    {
        // Log and swallow: the app is already running and serving
        // requests. We do not want a migration failure to crash the
        // container and trigger a redeploy loop.
        Console.WriteLine($"[BOOTSTRAP] FAILED: {ex.GetType().Name}: {ex.Message}");
        Console.WriteLine(ex.StackTrace);
    }
});

// ---------------------------------------------------------------------
// HTTP PIPELINE
// ---------------------------------------------------------------------

if (app.Environment.IsDevelopment())
{
    app.UseSwagger();
    app.UseSwaggerUI();
    app.UseHttpsRedirection();
}

app.UseAuthentication();
app.UseAuthorization();

app.MapControllers();

app.Run();