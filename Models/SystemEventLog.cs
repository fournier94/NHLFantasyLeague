namespace NhlFantasyLeague.api.Models
{
    /// <summary>
    /// One row per unique error or warning signature. Repeated
    /// occurrences within a short window are folded into the same
    /// row by incrementing Count and bumping LastSeenUtc, so a
    /// 429 storm does not flood the table.
    ///
    /// Auto-cleaned: rows with LastSeenUtc older than 30 days are
    /// deleted daily. Hard cap of 5,000 rows total.
    /// </summary>
    public class SystemEventLog
    {
        public int Id { get; set; }

        public DateTime TimestampUtc { get; set; }

        public DateTime LastSeenUtc { get; set; }

        public int Count { get; set; } = 1;

        /// <summary>Where the error originated. Examples:
        /// "NhlApi", "EspnApi", "CapFreeze", "AhlFeed",
        /// "ScheduledJob:live-refresh".</summary>
        public string Source { get; set; } = string.Empty;

        /// <summary>Short category, e.g. "Http429", "Http500",
        /// "JobFailure", "JobTimeout".</summary>
        public string Category { get; set; } = string.Empty;

        /// <summary>"Warning" or "Error".</summary>
        public string Severity { get; set; } = "Error";

        public string Message { get; set; } = string.Empty;

        public string? Details { get; set; }

        /// <summary>Hash of Source + Category + Message. Used to
        /// dedupe identical events without comparing long strings.</summary>
        public string DedupeKey { get; set; } = string.Empty;
    }
}