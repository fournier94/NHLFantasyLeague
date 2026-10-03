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
var renderPort = Environment.GetEnvironmentVariable("PORT");
var listenPort = int.TryParse(renderPort, out var p) ? p : 10000;
builder.WebHost.ConfigureKestrel(options =>
{
    options.ListenAnyIP(listenPort);
});

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

// Bootstraps the Commissioner role from appsettings on startup.
builder.Services.AddHostedService<CommissionerBootstrapService>();

var app = builder.Build();

// Apply any pending EF Core migrations to the database at startup.
// On the first deploy this creates every table. On subsequent
// deploys it applies only the new migrations. Safe to run multiple
// times (EF tracks applied migrations in __EFMigrationsHistory).
using (var scope = app.Services.CreateScope())
{
    var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
    db.Database.Migrate();
}

if (app.Environment.IsDevelopment())
{
    app.UseSwagger();
    app.UseSwaggerUI();
}

// Skip HTTPS redirection in production: Render terminates SSL at
// its edge and forwards plain HTTP to the container, so the app
// can't determine the redirect port and logs a warning every
// request. Redirecting here would also cause an infinite loop.
if (app.Environment.IsDevelopment())
{
    app.UseHttpsRedirection();
}

app.UseAuthentication();
app.UseAuthorization();

app.MapControllers();

app.Run();