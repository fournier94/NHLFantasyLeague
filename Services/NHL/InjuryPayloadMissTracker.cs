using System.Collections.Concurrent;

namespace NhlFantasyLeague.api.Services.NHL
{
    /// <summary>
    /// Tracks how many consecutive ESPN injury payloads have omitted
    /// each NHL team. Used by NhlInjuryService to decide when a team
    /// missing from the payload is a transient CDN blip (skip) versus
    /// a persistent condition worth acting on (clear that team's
    /// injury flags anyway).
    ///
    /// WHY THIS EXISTS
    ///
    /// ESPN's injuries endpoint occasionally returns a 200 with a
    /// partial payload: one or two teams are missing from the
    /// response, usually due to a CDN edge issue on their side. The
    /// old NhlInjuryService clear loop handled that by skipping
    /// players whose NHL team was not in the payload, which is
    /// correct for a single bad fetch but has a downside: if ESPN
    /// silently drops a team for days (as happened once with a
    /// rebranded team whose ESPN id changed), those players keep
    /// their stale injury flag forever, and no amount of refreshing
    /// clears it.
    ///
    /// With this tracker, a team missing once is still skipped, but
    /// a team missing for two consecutive refreshes is treated as a
    /// real "not on the ESPN injured list" signal, and its players
    /// are cleared like any other team.
    ///
    /// STATE
    ///
    /// In-memory only, on a singleton. Lost on API restart, which
    /// resets every counter to 0; the worst case is one extra
    /// refresh cycle before a persistently missing team is cleared.
    ///
    /// Keyed by our internal NhlTeamId, not by the ESPN id, so it
    /// is stable across ESPN renames and rebrands.
    /// </summary>
    public class InjuryPayloadMissTracker
    {
        private readonly ConcurrentDictionary<int, int> _consecutiveMisses
            = new();

        /// <summary>
        /// Records that the team was present in the current payload.
        /// Resets its consecutive-miss counter.
        /// </summary>
        public void RecordHit(int nhlTeamId)
        {
            _consecutiveMisses.TryRemove(nhlTeamId, out _);
        }

        /// <summary>
        /// Records that the team was missing from the current
        /// payload. Returns the new consecutive-miss count.
        /// </summary>
        public int RecordMiss(int nhlTeamId)
        {
            return _consecutiveMisses.AddOrUpdate(
                nhlTeamId,
                addValue: 1,
                updateValueFactory: (_, current) => current + 1);
        }

        /// <summary>
        /// Clears the counter for one team without recording either
        /// a hit or a miss. Used after a forced clear, so the
        /// counter restarts at 0 and the warning is not re-emitted
        /// on every subsequent refresh.
        /// </summary>
        public void Reset(int nhlTeamId)
        {
            _consecutiveMisses.TryRemove(nhlTeamId, out _);
        }
    }
}