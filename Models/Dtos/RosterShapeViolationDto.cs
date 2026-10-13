namespace NhlFantasyLeague.api.Models.Dtos
{
    /// <summary>
    /// One continuous window of time during which a fantasy team's
    /// roster shape was not the league-mandated
    /// 12F/6D/1G active + 4F/2D/1G bench + 3 prospects.
    ///
    /// A window opens at the first RosterStatusHistory EffectiveAt
    /// that produced the wrong shape, and closes at the EffectiveAt
    /// that fixed it. When the shape was still wrong as of the latest
    /// history row, EndEffectiveAt is null.
    ///
    /// All instants are UTC at day precision (00:00:00), matching the
    /// granularity used by the scoring recompute and every other
    /// RosterStatusHistory row.
    /// </summary>
    public class RosterShapeViolationDto
    {
        public int FantasyTeamId { get; set; }
        public string FantasyTeamName { get; set; } = string.Empty;

        /// <summary>UTC instant the wrong shape first became effective.</summary>
        public DateTime StartEffectiveAt { get; set; }

        /// <summary>
        /// UTC instant the shape was fixed. Null when it was still
        /// wrong as of the latest history row.
        /// </summary>
        public DateTime? EndEffectiveAt { get; set; }

        // ---- Actual counts during the window (snapshot at start) ----

        public int ActiveForwards { get; set; }
        public int ActiveDefensemen { get; set; }
        public int ActiveGoalies { get; set; }

        public int BenchForwards { get; set; }
        public int BenchDefensemen { get; set; }
        public int BenchGoalies { get; set; }

        public int Prospects { get; set; }

        // ---- Expected counts (constants, sent so the frontend does not hardcode them) ----

        public int ExpectedActiveForwards { get; set; }
        public int ExpectedActiveDefensemen { get; set; }
        public int ExpectedActiveGoalies { get; set; }

        public int ExpectedBenchForwards { get; set; }
        public int ExpectedBenchDefensemen { get; set; }
        public int ExpectedBenchGoalies { get; set; }

        public int ExpectedProspects { get; set; }

        /// <summary>
        /// Every player who was on the team at the START of the
        /// violation window, with the status and position group they
        /// held at that instant. Ordered Active, then Bench, then
        /// Prospects; within each group, by position group, then by
        /// last name.
        ///
        /// This is what lets the commissioner see the roster that
        /// caused the violation, not just the counts.
        /// </summary>
        public List<RosterShapeViolationPlayerDto> Players { get; set; } = new();
    }

    public class RosterShapeViolationPlayerDto
    {
        public int PlayerId { get; set; }
        public int NhlPlayerId { get; set; }
        public string FirstName { get; set; } = string.Empty;
        public string LastName { get; set; } = string.Empty;
        public string Position { get; set; } = string.Empty;

        /// <summary>"F", "D" or "G".</summary>
        public string PositionGroup { get; set; } = string.Empty;

        /// <summary>"Active", "Bench" or "Prospect".</summary>
        public string RosterStatus { get; set; } = string.Empty;
    }
}