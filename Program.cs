using Microsoft.AspNetCore.Identity;
using Microsoft.AspNetCore.ResponseCompression;
using Microsoft.EntityFrameworkCore;
using NhlFantasyLeague.api.Data;
using NhlFantasyLeague.api.Models;
using NhlFantasyLeague.api.Services;
using NhlFantasyLeague.api.Services.Auth;
using NhlFantasyLeague.api.Services.NHL;
using NhlFantasyLeague.api.Services.CapFreeze;
using NhlFantasyLeague.api.Services.Health;
using System.IO.Compression;

var builder = WebApplication.CreateBuilder(args);

// Render injects a PORT environment variable (default 10000) and
// requires the app to bind to 0.0.0.0 on that port. Configuring
// Kestrel explicitly here avoids any ambiguity with environment
// variables like ASPNETCORE_URLS or ASPNETCORE_HTTP_PORTS.
var renderPort = Environment.GetEnvironmentVariable("PORT") ?? "10000";
builder.WebHost.UseUrls($"http://0.0.0.0:{renderPort}");

// ---------------------------------------------------------------------
// Response compression
//
// Every JSON response over the size threshold is compressed with Brotli
// (falling back to Gzip on clients that don't support Brotli). For a
// team roster payload this typically cuts the wire size by 70-85%.
// On slow mobile connections this is the single biggest win available.
//
// EnableForHttps is required because Render terminates TLS at its edge
// and forwards HTTP to us, but the browser-visible response is HTTPS.
// Without this flag ASP.NET refuses to compress over HTTPS.
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
    // Fastest is a good tradeoff: ~70% reduction for minimal CPU cost.
    // Optimal would be slightly smaller but noticeably more expensive
    // per response, which matters on Render Free's shared 0.5 CPU.
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
        // TODO Dev-only: allow the cookie to be set over plain HTTP so LAN
        // testing from a phone works. Flip back to SameAsRequest (or
        // Always) once you host the app behind HTTPS.
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

// Background jobs: runs long operations (refresh-all, roster status,
// hat-trick backfill) on a background thread so the browser never
// waits longer than a second for a response.
builder.Services.AddSingleton<NhlFantasyLeague.api.Services.Jobs.BackgroundJobService>();

// Bootstraps the Commissioner role from appsettings on startup.
builder.Services.AddHostedService<CommissionerBootstrapService>();

var app = builder.Build();

// Apply any pending EF Core migrations to the database at startup.
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

// Must come before the endpoints are registered so every response
// gets compressed. Placed before UseAuthentication because the auth
// middleware writes its own small responses that don't need to be
// compressed anyway.
app.UseResponseCompression();

app.UseAuthentication();
app.UseAuthorization();

app.MapControllers();

app.Run();