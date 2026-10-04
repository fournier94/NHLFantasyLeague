using System.Xml.Linq;
using Microsoft.AspNetCore.DataProtection.Repositories;
using Microsoft.EntityFrameworkCore;
using NhlFantasyLeague.api.Data;
using NhlFantasyLeague.api.Models;

namespace NhlFantasyLeague.api.Services.Auth
{
    /// <summary>
    /// Custom IXmlRepository that persists Data Protection keys in the
    /// DataProtectionKeys table via AppDbContext.
    ///
    /// Why custom instead of PersistKeysToDbContext&lt;TContext&gt;():
    /// that built-in extension requires the context to implement
    /// IDataProtectionKeyContext, which forces the DbSet's entity type
    /// to be the library's own DataProtectionKey. We use a plain POCO,
    /// so we implement the repository directly.
    ///
    /// ASP.NET Core calls GetAllElements() on startup to load the key
    /// ring, and StoreElement() when it rolls a new key. Both must
    /// succeed for cookies to survive restarts.
    /// </summary>
    public class EfCoreXmlRepository : IXmlRepository
    {
        private readonly IServiceScopeFactory _scopeFactory;

        public EfCoreXmlRepository(IServiceScopeFactory scopeFactory)
        {
            _scopeFactory = scopeFactory;
        }

        public IReadOnlyCollection<XElement> GetAllElements()
        {
            using var scope = _scopeFactory.CreateScope();
            var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();

            return db.DataProtectionKeys
                .AsNoTracking()
                .Select(k => k.Xml)
                .ToList()
                .Select(XElement.Parse)
                .ToList();
        }

        public void StoreElement(XElement element, string friendlyName)
        {
            using var scope = _scopeFactory.CreateScope();
            var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();

            db.DataProtectionKeys.Add(new DataProtectionKey
            {
                FriendlyName = friendlyName ?? string.Empty,
                Xml = element.ToString()
            });

            db.SaveChanges();
        }
    }
}