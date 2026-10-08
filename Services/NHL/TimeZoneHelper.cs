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
    ///
    /// TWO DIFFERENT "TODAY"S
    ///
    /// This class exposes two date helpers that look similar but
    /// answer different questions:
    ///
    ///   GetNhlGameDateEt       — the real ET calendar date of an
    ///                            instant. The date the NHL labels
    ///                            a game with, and the value that
    ///                            goes into PlayerGameLog.GameDate.
    ///                            A game starting Oct 1 22:00 ET
    ///                            and ending Oct 2 01:00 ET is an
    ///                            Oct 1 game, always. No cutoff.
    ///
    ///   GetFantasyDateEt       — the date the USER-FACING "Aujourd'hui"
    ///                            and "Hier" columns should show.
    ///                            Same as GetNhlGameDateEt, except
    ///                            between 00:00 and 03:00 ET, when
    ///                            it stays on the previous calendar
    ///                            day. This lets a manager who is up
    ///                            at 01:30 ET still see the still-
    ///                            running West Coast game under
    ///                            "Aujourd'hui", which is what a
    ///                            real hockey fan would call it.
    ///
    /// Use the right one. Mixing them is what caused the two
    /// separate bugs this class was extended to fix.
    /// </summary>
    public static class TimeZoneHelper
    {
        private static readonly TimeZoneInfo EasternTimeZone =
            ResolveEasternTimeZone();

        /// <summary>
        /// The ET time-of-day at which the fantasy display day rolls
        /// over. Between 00:00 and 03:00 ET, the "current fantasy
        /// date" is still the previous ET calendar day.
        ///
        /// Chosen because our managers routinely stay up until
        /// around 03:00 ET watching late West Coast games. Rolling
        /// the display day over at real ET midnight would move the
        /// game they are currently watching from "Aujourd'hui" to
        /// "Hier" in the middle of a period.
        /// </summary>
        public static readonly TimeSpan FantasyDayCutoffEt =
            new(3, 0, 0);

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

        /// <summary>
        /// Returns the real ET calendar date of the given UTC instant.
        /// No cutoff is applied.
        ///
        /// This is the date the NHL labels a game with and the value
        /// that ends up in PlayerGameLog.GameDate. A game starting
        /// Oct 1 22:00 ET and ending Oct 2 01:00 ET is an Oct 1
        /// game, always — its stats are counted under Oct 1 no
        /// matter how late it runs.
        ///
        /// Use this for:
        ///   - deciding which ET day a game belongs to
        ///   - writing PlayerGameLog.GameDate
        ///   - job scheduling keys ("today" for a once-per-day job)
        ///   - any DB query that filters by GameDate
        ///
        /// Do NOT use this for the "Aujourd'hui" / "Hier" display
        /// columns. Use GetFantasyDateEt for those.
        /// </summary>
        public static DateOnly GetNhlGameDateEt(DateTime utcNow)
        {
            return DateOnly.FromDateTime(ToEastern(utcNow));
        }

        /// <summary>
        /// Returns the current "fantasy date" in ET: the real ET
        /// calendar date, except between 00:00 and 03:00 ET, when it
        /// stays on the previous ET calendar day.
        ///
        /// This is what the "Aujourd'hui" / "Hier" columns display.
        /// The 3 AM cut exists so a manager watching a late West
        /// Coast game that started at 22:30 ET is not told at 00:01
        /// ET that the still-running game has become "hier".
        ///
        /// Use this for:
        ///   - the "Aujourd'hui" / "Hier" columns on Classement
        ///   - the "Aujourd'hui" and "Hier" player tables
        ///   - the Game Day date picker's "today"
        ///   - the GamesController date-range validation
        ///
        /// Do NOT use this when computing PlayerGameLog.GameDate or
        /// a scheduled job's "today" key. Those use the real ET
        /// calendar day (GetNhlGameDateEt).
        /// </summary>
        public static DateOnly GetFantasyDateEt(DateTime utcNow)
        {
            var et = ToEastern(utcNow);

            if (et.TimeOfDay < FantasyDayCutoffEt)
            {
                et = et.AddDays(-1);
            }

            return DateOnly.FromDateTime(et);
        }
    }
}