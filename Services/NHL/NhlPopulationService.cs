using Microsoft.EntityFrameworkCore;
using NhlFantasyLeague.api.Models;
using NhlFantasyLeague.api.Data;
using NhlFantasyLeague.api.Services;
using System.Net.Http;

namespace NhlFantasyLeague.api.Services.NHL
{
    public class NhlPopulationService
    {
        private readonly HttpClient _httpClient;
        private readonly AppDbContext _dbContext;

        public NhlPopulationService(
    HttpClient httpClient,
    AppDbContext dbContext)
        {
            _httpClient = httpClient;
            _dbContext = dbContext;
        }


    }
}
