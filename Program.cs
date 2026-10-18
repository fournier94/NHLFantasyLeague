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
using NhlFantasyLeague.api.Services.Logging;
using NhlFantasyLeague.api.Services.NHL;
using System.IO.Compression;

var builder = WebApplication.CreateBuilder(args);

// ---------------------------------------------------------------------
// System event logging (errors + warnings surfaced in the admin page)
// ---------------------------------------------------------------------
//
// Registered once, at the top. Used by both the HTTP error logging
// handler and the scheduled jobs runner.

builder.Services.AddScoped<SystemEventLogService>();

// ---------------------------------------------------------------------
// NHL API rate limiting
// ---------------------------------------------------------------------
//
// Process-wide rate limiter for every NHL API call made by a
// SCHEDULED JOB. User-initiated HTTP requests bypass the limiter;
// see NhlRateLimitHandler and NhlRequestContext for the mechanism.
//
// The limiter is a singleton so that all HTTP clients that talk to
// the NHL share the same meter.
//
// Registered explicitly as a singleton so a future refactor cannot
// accidentally change its lifetime.

builder.Services.AddSingleton<NhlApiRateLimiter>();

// Tracks consecutive refreshes during which an NHL team has been
// missing from the ESPN injuries payload. Shared state, so
// singleton; see InjuryPayloadMissTracker for the rationale.
builder.Services.AddSingleton<InjuryPayloadMissTracker>();

// Both handlers are transient because AddHttpMessageHandler
// resolves them per client. They are stateless; all shared state
// lives on the singleton limiter.
builder.Services.AddTransient<NhlRateLimitHandler>();
builder.Services.AddTransient<HttpErrorLoggingHandler>();

// Attach both handlers to every HttpClient the app registers.
//
// ORDER MATTERS.
//
// In .NET's handler pipeline, the FIRST handler registered is the
// OUTERMOST (called first on the request, last on the response).
// The LAST registered handler is the INNERMOST (called last on the
// request, first on the response, closest to the network).
//
// We register, in this order:
//
//   1. HttpErrorLoggingHandler (outermost)
//      Sees every request and response, writes failures to the DB.
//      Being outermost means it inspects the response AFTER the
//      rate limiter's finally has released the semaphore, so a
//      slow DB write can never hold the NHL API gate.
//
//   2. NhlRateLimitHandler (innermost)
//      Holds the semaphore across the actual HTTP call, unless the
//      current request is user-initiated (in which case it passes
//      through unchanged).
//
// Reversing this order would put the DB write inside the
// semaphore, which is the failure mode we designed the limiter
// to avoid.

builder.Services.ConfigureHttpClientDefaults(http =>
{
    http.AddHttpMessageHandler<HttpErrorLoggingHandler>();
    http.AddHttpMessageHandler<NhlRateLimitHandler>();
});

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
// Backup service (commissioner-triggered pg_dump download)
// ---------------------------------------------------------------------

builder.Services.AddScoped<BackupService>();

// ---------------------------------------------------------------------
// League, roster, marketplace and auth services
// ---------------------------------------------------------------------

builder.Services.AddScoped<NhlPopulationService>();
builder.Services.AddScoped<LeagueSetupService>();
builder.Services.AddScoped<RosterAdminService>();
builder.Services.AddScoped<AuthService>();
builder.Services.AddScoped<MarketplaceService>();

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

builder.Services.AddSingleton<BackgroundJobService>();
builder.Services.AddSingleton<LiveGameCache>();
builder.Services.AddSingleton<ResponseCacheService>();
builder.Services.AddSingleton<ScheduledJobsRunner>();

builder.Services.AddHostedService<ScheduledJobsHostedService>();

builder.Services.AddHttpClient<NhlGameService>();

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

// Set the user-request flag for the duration of every HTTP request.
//
// The NHL API rate limiter reads this flag to decide whether to
// throttle a given request. When the flag is true (i.e. the call
// originates from an HTTP request), the limiter is bypassed; when
// it is false (background job, scheduled task, startup), the
// limiter applies.
//
// AsyncLocal flows through every async call made from this request,
// including any HttpClient call reached through the controller and
// its services. The finally block resets the flag at the end of the
// request, so no state leaks between requests.
app.Use(async (context, next) =>
{
    NhlRequestContext.IsUserRequest = true;
    try
    {
        await next();
    }
    finally
    {
        NhlRequestContext.IsUserRequest = false;
    }
});

app.UseAuthentication();
app.UseAuthorization();

app.UseMiddleware<NhlFantasyLeague.api.Services.Auth.LastActiveMiddleware>();

app.MapGet("/ping", () => Results.Ok("pong"))
   .AllowAnonymous();

app.MapControllers();

app.Run();