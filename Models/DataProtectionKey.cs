namespace NhlFantasyLeague.api.Models
{
    /// <summary>
    /// One row of the ASP.NET Core Data Protection key ring. Persisted
    /// to PostgreSQL so that auth cookies encrypted by a previous
    /// deployment can still be decrypted by the current one.
    ///
    /// Note: intentionally does NOT implement IDataProtectionKey, so
    /// the type doesn't depend on Microsoft.AspNetCore.DataProtection.
    /// EntityFrameworkCore. The property names (Id, FriendlyName, Xml)
    /// match what PersistKeysToDbContext expects.
    /// </summary>
    public class DataProtectionKey
    {
        public int Id { get; set; }

        public string FriendlyName { get; set; } = string.Empty;

        public string Xml { get; set; } = string.Empty;
    }
}