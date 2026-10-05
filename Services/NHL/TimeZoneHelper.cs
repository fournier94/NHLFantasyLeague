namespace NhlFantasyLeague.api.Services.NHL
{
    /// <summary>
    /// Eastern Time conversion helpers for the scheduled jobs.
    ///
    /// The NHL schedules games in ET, our users are in ET, and the
    /// schedule windows ("6 PM start", "1:30 AM post-game") are all
    /// expressed in ET. We convert UTC to ET at each tick of the
    /// scheduler so DST is handled automatically by the OS time
    /// zone database.
    ///
    /// The time zone ID differs by OS:
    ///   Windows  -> "Eastern Standard Time"
    ///   Linux    -> "America/Toronto"
    /// Render runs Linux; local dev runs Windows. We try both.
    /// </summary>
    public static class TimeZoneHelper
    {
        private static readonly TimeZoneInfo EasternTimeZone =
            ResolveEasternTimeZone();

        private static TimeZoneInfo ResolveEasternTimeZone()
        {
            // Try the IANA name first (Linux, containers), then the
            // Windows name, then the generic one.
            foreach (var id in new[]
                     {
                         "America/Toronto",
                         "Eastern Standard Time",
                         "America/New_York",
                     })
            {
                try
                {
                    return TimeZoneInfo.FindSystemTimeZoneById(id);
                }
                catch (TimeZoneNotFoundException)
                {
                    // Try the next ID.
                }
                catch (InvalidTimeZoneException)
                {
                    // Try the next ID.
                }
            }

            // Absolute fallback: fixed offset UTC-5. This never
            // happens on supported hosts, but avoids a hard crash if
            // the time zone database is missing entirely.
            return TimeZoneInfo.CreateCustomTimeZone(
                "ET-Fallback",
                TimeSpan.FromHours(-5),
                "Eastern Time (fallback)",
                "Eastern Time (fallback)");
        }

        /// <summary>Converts a UTC instant to Eastern Time.</summary>
        public static DateTime ToEastern(DateTime utc)
        {
            if (utc.Kind != DateTimeKind.Utc)
            {
                utc = DateTime.SpecifyKind(utc, DateTimeKind.Utc);
            }

            return TimeZoneInfo.ConvertTimeFromUtc(utc, EasternTimeZone);
        }

        /// <summary>Converts an Eastern Time instant to UTC.</summary>
        public static DateTime ToUtc(DateTime eastern)
        {
            return TimeZoneInfo.ConvertTimeToUtc(eastern, EasternTimeZone);
        }
    }
}