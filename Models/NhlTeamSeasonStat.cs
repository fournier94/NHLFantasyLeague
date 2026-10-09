namespace NhlFantasyLeague.api.Models
{
    /// <summary>
    /// One row per (NHL team, season, game type). Stores every
    /// season-level team aggregate the NHL API exposes, so a future
    /// team stats page can read everything from one table without
    /// further migrations.
    ///
    /// Populated by the daily team stats refresh job
    /// (NhlTeamService.SyncTeamSeasonStatsAsync). Read by the
    /// GameDay page for team records on the game cards, and by any
    /// future team stats page.
    ///
    /// Unique per (NhlTeamId, NhlSeasonCode, GameTypeId).
    /// </summary>
    public class NhlTeamSeasonStat
    {
        public int Id { get; set; }

        public int NhlTeamId { get; set; }
        public NhlTeam NhlTeam { get; set; } = null!;

        /// <summary>NHL season code, e.g. 20262027.</summary>
        public int NhlSeasonCode { get; set; }

        /// <summary>2 = regular season, 3 = playoffs.</summary>
        public int GameTypeId { get; set; }

        // -------------------------------------------------------------
        // Record (from /v1/standings/now)
        // -------------------------------------------------------------

        public int GamesPlayed { get; set; }
        public int Wins { get; set; }
        public int Losses { get; set; }
        public int OtLosses { get; set; }
        public int Ties { get; set; }
        public int Points { get; set; }
        public decimal PointPctg { get; set; }
        public int GamesRemaining { get; set; }

        // -------------------------------------------------------------
        // Goals
        // -------------------------------------------------------------

        public int GoalsFor { get; set; }
        public int GoalsAgainst { get; set; }
        public int GoalDifferential { get; set; }

        // -------------------------------------------------------------
        // Splits
        // -------------------------------------------------------------

        public int HomeWins { get; set; }
        public int HomeLosses { get; set; }
        public int HomeOtLosses { get; set; }
        public int RoadWins { get; set; }
        public int RoadLosses { get; set; }
        public int RoadOtLosses { get; set; }
        public int L10Wins { get; set; }
        public int L10Losses { get; set; }
        public int L10OtLosses { get; set; }

        // -------------------------------------------------------------
        // Streak
        // -------------------------------------------------------------

        /// <summary>"W", "L", or "OT". Null when the API omits it.</summary>
        public string? StreakCode { get; set; }

        public int StreakCount { get; set; }

        // -------------------------------------------------------------
        // Rankings
        // -------------------------------------------------------------

        public int LeagueSequence { get; set; }
        public int ConferenceSequence { get; set; }
        public int DivisionSequence { get; set; }
        public int WildcardSequence { get; set; }

        // -------------------------------------------------------------
        // Indicators
        // -------------------------------------------------------------

        /// <summary>"P" (Presidents'), "Y" (division), "X" (playoff), "E" (eliminated), or null.</summary>
        public string? ClinchIndicator { get; set; }

        public bool WildcardIndicator { get; set; }

        // -------------------------------------------------------------
        // Shootout
        // -------------------------------------------------------------

        public int ShootoutWins { get; set; }
        public int ShootoutLosses { get; set; }

        // -------------------------------------------------------------
        // Team summary (from api.nhle.com/stats/rest/en/team/summary)
        // -------------------------------------------------------------

        public decimal PowerPlayPct { get; set; }
        public decimal PowerPlayNetPct { get; set; }
        public decimal PenaltyKillPct { get; set; }
        public decimal PenaltyKillNetPct { get; set; }
        public decimal FaceoffWinPct { get; set; }
        public decimal ShotsForPerGame { get; set; }
        public decimal ShotsAgainstPerGame { get; set; }
        public decimal GoalsForPerGame { get; set; }
        public decimal GoalsAgainstPerGame { get; set; }
        public decimal PenaltyMinutesPerGame { get; set; }

        /// <summary>UTC timestamp of the last successful sync.</summary>
        public DateTime LastUpdatedUtc { get; set; } = DateTime.UtcNow;
    }
}