namespace NhlFantasyLeague.api.Constants
{
    /// <summary>
    /// Single source of truth for the "current" NHL season codes used
    /// across the backend. Update these three constants each October
    /// when the NHL season rolls over. Do NOT scatter 20262027-style
    /// literals elsewhere in the backend.
    ///
    /// Frontend has its own copies in PlayerCard.tsx / PlayerPage.tsx /
    /// AdminPage.tsx — those must be updated at the same time.
    /// </summary>
    public static class SeasonCodes
    {
        /// <summary>Current season, e.g. 20262027 for the 2026-27 season.</summary>
        public const int Current = 20262027;

        /// <summary>Previous season, e.g. 20252026 for the 2025-26 season.</summary>
        public const int Previous = 20252026;

        /// <summary>Two seasons ago, e.g. 20242025 for the 2024-25 season.</summary>
        public const int TwoSeasonsAgo = 20242025;
    }
}