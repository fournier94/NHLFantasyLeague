using Microsoft.AspNetCore.Identity;
using Microsoft.EntityFrameworkCore;
using NhlFantasyLeague.api.Data;
using NhlFantasyLeague.api.Models;
using NhlFantasyLeague.api.Services;
using NhlFantasyLeague.api.Services.Auth;
using NhlFantasyLeague.api.Services.NHL;
using NhlFantasyLeague.api.Services.CapFreeze;

var builder = WebApplication.CreateBuilder(args);

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
        options.Cookie.SecurePolicy = CookieSecurePolicy.SameAsRequest;

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

// Bootstraps the Commissioner role from appsettings on startup.
builder.Services.AddHostedService<CommissionerBootstrapService>();

var app = builder.Build();

if (app.Environment.IsDevelopment())
{
    app.UseSwagger();
    app.UseSwaggerUI();
}

app.UseHttpsRedirection();

app.UseAuthentication();
app.UseAuthorization();

app.MapControllers();

app.Run();