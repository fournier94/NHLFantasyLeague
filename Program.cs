using Microsoft.EntityFrameworkCore;
using NhlFantasyLeague.api.Data;
using NhlFantasyLeague.api.Services;
using NhlFantasyLeague.api.Services.NHL;
using NhlFantasyLeague.api.Services.CapFreeze;

var builder = WebApplication.CreateBuilder(args);

builder.Services.AddDbContext<AppDbContext>(options =>
    options.UseNpgsql(
        builder.Configuration.GetConnectionString("DefaultConnection")));

// NHL services
builder.Services.AddHttpClient<NhlPlayerService>();
builder.Services.AddHttpClient<NhlTeamService>();
builder.Services.AddHttpClient<NhlStatsService>();
builder.Services.AddHttpClient<NhlGameLogService>();

// CapFreeze services
builder.Services.AddHttpClient<CapFreezePageService>();
builder.Services.AddScoped<CapFreezeMatchingService>();
builder.Services.AddScoped<CapFreezeContractService>();
builder.Services.AddScoped<CapFreezeSyncService>();

// Master orchestration service
builder.Services.AddScoped<NhlPopulationService>();

// League and roster services
builder.Services.AddScoped<LeagueSetupService>();
builder.Services.AddScoped<RosterAdminService>();

builder.Services.AddControllers();
builder.Services.AddEndpointsApiExplorer();
builder.Services.AddSwaggerGen();

var app = builder.Build();

if (app.Environment.IsDevelopment())
{
    app.UseSwagger();
    app.UseSwaggerUI();
}

app.UseHttpsRedirection();
app.UseAuthorization();

app.MapControllers();

app.Run();