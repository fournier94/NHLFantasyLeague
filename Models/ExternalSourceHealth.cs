namespace NhlFantasyLeague.api.Models
{
    /// <summary>
    /// One row per external data source our sync jobs depend on
    /// (ESPN injuries, NHL rosters, AHL rosters, CapFreeze, ...).
    ///
    /// The row records the last successful and last failed fetch so
    /// the admin banner and the time-based escalation ladder can be
    /// computed. It is deliberately a simple snapshot: no history,
    /// just the current state per source.
    ///
    /// SourceName is the stable key, e.g.:
    ///   "EspnInjuries"
    ///   "NhlRosters"
    ///   "AhlRosters"
    /// Adding a new source is a matter of inserting a new row with a
    /// new SourceName; nothing else needs to change.
    /// </summary>
    public class ExternalSourceHealth
    {
        public int Id { get; set; }

        /// <summary>Stable key for the source, e.g. "EspnInjuries".</summary>
        public string SourceName { get; set; } = string.Empty;

        /// <summary>UTC instant of the last successful fetch, or null.</summary>
        public DateTime? LastSuccessAt { get; set; }

        /// <summary>UTC instant of the last failed fetch, or null.</summary>
        public DateTime? LastFailureAt { get; set; }

        /// <summary>
        /// Error message from the last failed fetch, or null. Overwritten
        /// on every failure so the admin banner can show why the source
        /// is currently unhealthy.
        /// </summary>
        public string? LastError { get; set; }

        /// <summary>
        /// How many times the fetch has failed in a row. Reset to 0 on
        /// the next success.
        /// </summary>
        public int ConsecutiveFailures { get; set; }
    }
}