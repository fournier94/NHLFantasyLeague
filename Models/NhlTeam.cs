namespace NhlFantasyLeague.api.Models
{
    /// <summary>
    /// One NHL club. Identity and location fields are static
    /// (name, abbreviation, arena, conference, division) and are
    /// refreshed by the daily team stats job. Season-specific
    /// numbers live on <see cref="NhlTeamSeasonStat"/>, one row per
    /// (team, season, game type), so this table never grows.
    ///
    /// ArenaName / ArenaCity are the only non-API fields: the NHL
    /// does not expose arena names on any modern endpoint, so they
    /// are seeded from a static dictionary during the sync.
    /// </summary>
    public class NhlTeam
    {
        public int Id { get; set; }

        /// <summary>NHL API team id, e.g. 8 for Montreal.</summary>
        public int NhlTeamId { get; set; }

        /// <summary>NHL franchise id, e.g. 1 for the Canadiens franchise.</summary>
        public int? FranchiseId { get; set; }

        /// <summary>Full name, e.g. "Montreal Canadiens".</summary>
        public string Name { get; set; } = string.Empty;

        /// <summary>Nickname only, e.g. "Canadiens".</summary>
        public string CommonName { get; set; } = string.Empty;

        /// <summary>City / place name, e.g. "Montréal".</summary>
        public string PlaceName { get; set; } = string.Empty;

        /// <summary>Three-letter tri-code, e.g. "MTL".</summary>
        public string Abbreviation { get; set; } = string.Empty;

        public string? LogoUrl { get; set; }

        public string? ConferenceName { get; set; }
        public string? ConferenceAbbreviation { get; set; }

        public string? DivisionName { get; set; }
        public string? DivisionAbbreviation { get; set; }

        /// <summary>NHL season id of the franchise's first season, e.g. 19171918.</summary>
        public int? FirstSeasonId { get; set; }

        /// <summary>Home arena name, e.g. "Bell Centre". Non-API field.</summary>
        public string? ArenaName { get; set; }

        /// <summary>Home arena city, e.g. "Montréal". Non-API field.</summary>
        public string? ArenaCity { get; set; }

        public string? OfficialSiteUrl { get; set; }

        /// <summary>False for franchises that no longer exist (e.g. Nordiques).</summary>
        public bool IsActive { get; set; } = true;

        public ICollection<Player> Players { get; set; } = new List<Player>();
    }
}