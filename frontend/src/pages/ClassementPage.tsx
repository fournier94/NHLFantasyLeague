import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { Crown } from 'lucide-react';
import {
    getStandings,
    getTeamRoster,
    getTodayGames,
    getGameBoxscore,
    getRosterGameStatsForDate,
    type StandingsRow,
    type RosterEntry,
    type GameDayGameSummary,
    type NhlBoxscoreResponse,
    type NhlPeriodDescriptor,
    type NhlSkaterStats,
    type NhlGoalieStats,
} from '@/api/client';
import { useAuth } from '@/lib/AuthContext';
import { cn } from '@/lib/utils';
import { NeonTitle } from '@/components/ui/NeonTitle';
import { NhlTeamLogo } from '@/components/nhl/NhlTeamLogo';

type SortKey =
    | 'totalGames'
    | 'skaterHatTricks'
    | 'goalieWins'
    | 'goalieOvertimeLosses'
    | 'goalieShutouts'
    | 'totalPoints'
    | 'yesterdayFantasyPoints'
    | 'todayFantasyPoints'
    | 'totalFantasyPoints';

type SortDirection = 'asc' | 'desc';

// ---------------------------------------------------------------------
// Palette — electric blue
// ---------------------------------------------------------------------

const GOLD = '#FFC72C';
const SILVER = '#C0C0C0';
const BRONZE = '#CD7F32';

const ELECTRIC_BRIGHT = '#33BBFF';
const ELECTRIC_SOFT = '#7DD3FC';

/**
 * Cyan used for the PTS column header and values, matching the exact
 * color MonEquipePage uses on its lineup table (see LineupHeader and
 * LineupRow in MonEquipePage.tsx).
 */
const PTS_HIGHLIGHT = '#00F0FF';

const RED_NEON = '#FF0F3D';

const GRID_COLUMNS = '6% 20% repeat(9, calc((100% - 26%) / 9))';

/**
 * Accent used for the neon left bar on every row of the two
 * "Mes joueurs" tables. Kept separate from the standings table's
 * rank-based accent because those tables do not have a rank — every
 * row belongs to the current user, so a single consistent blue tube
 * reads better and matches the header cyan.
 */
const PLAYER_ROW_ACCENT = {
    accent: '#0088FF',
    mid: '#33BBFF',
    core: '#7DD3FC',
};

// ---------------------------------------------------------------------
// Auto-refresh
// ---------------------------------------------------------------------

/**
 * Cadence used by the auto-refresh scheduler on ClassementPage.
 *
 *   FAST   (30s) : at least one game is LIVE or CRIT right now.
 *   MEDIUM (60s) : no live game, but at least one game is scheduled
 *                  today and has not started yet (FUT / PRE).
 *   SLOW   (5m)  : no live or scheduled games today.
 *
 * The backend's own response cache on `standings:*` is 30 s, so
 * polling faster than the FAST cadence would not return fresher data
 * anyway.
 */
const REFRESH_FAST_MS = 30_000;
const REFRESH_MEDIUM_MS = 60_000;
const REFRESH_SLOW_MS = 5 * 60_000;

/**
 * Schedules periodic refreshes of the page's data. Returns a tick
 * counter the caller uses as a dependency to know when to re-fetch.
 *
 * The interval is decided by looking at today's NHL schedule:
 *   - a live game -> fast
 *   - a scheduled game -> medium
 *   - no game today -> slow
 *
 * The schedule is re-checked on every tick, so the cadence adapts
 * automatically as the day progresses (e.g. it accelerates the moment
 * a game goes from PRE to LIVE).
 *
 * Polling is paused while the tab is hidden. When the tab becomes
 * visible again, the counter is bumped immediately so the user sees
 * current data on the very first frame after switching back.
 */
function useAutoRefreshTick(): number {
    const [tick, setTick] = useState(0);

    useEffect(() => {
        let cancelled = false;
        let timeoutId: number | null = null;

        const scheduleNext = (delayMs: number) => {
            timeoutId = window.setTimeout(() => {
                if (cancelled) return;
                setTick((t) => t + 1);
                void checkAndReschedule();
            }, delayMs);
        };

        const checkAndReschedule = async () => {
            if (cancelled) return;

            // Pause while hidden. The visibility effect below will
            // fire an immediate tick when the tab comes back.
            if (
                typeof document !== 'undefined' &&
                document.visibilityState === 'hidden'
            ) {
                scheduleNext(REFRESH_FAST_MS);
                return;
            }

            try {
                const data = await getTodayGames();

                if (cancelled) return;

                const hasLive = data.games.some(
                    (g) =>
                        g.gameState === 'LIVE' ||
                        g.gameState === 'CRIT',
                );

                if (hasLive) {
                    scheduleNext(REFRESH_FAST_MS);
                    return;
                }

                const hasScheduledToday = data.games.some(
                    (g) =>
                        g.gameState === 'FUT' ||
                        g.gameState === 'PRE',
                );

                scheduleNext(
                    hasScheduledToday
                        ? REFRESH_MEDIUM_MS
                        : REFRESH_SLOW_MS,
                );
            } catch {
                // Network hiccup. Retry at the slow cadence so we do
                // not hammer an unhealthy API.
                scheduleNext(REFRESH_SLOW_MS);
            }
        };

        // Kick off the first cycle without bumping the tick. The
        // page's own initial-load effects already fetched everything
        // once, so a bump here would double-fetch on mount.
        void checkAndReschedule();

        return () => {
            cancelled = true;
            if (timeoutId != null) {
                window.clearTimeout(timeoutId);
            }
        };
    }, []);

    // When the tab becomes visible again, fire one immediate tick so
    // the user sees current data without waiting for the next timer.
    useEffect(() => {
        const onVisibility = () => {
            if (document.visibilityState === 'visible') {
                setTick((t) => t + 1);
            }
        };

        document.addEventListener('visibilitychange', onVisibility);

        return () => {
            document.removeEventListener(
                'visibilitychange',
                onVisibility,
            );
        };
    }, []);

    return tick;
}

// ---------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------

/**
 * Contained 3-layer neon bar. Produces a 6px-wide horizontal gradient
 * that reads left-to-right as:
 *
 *   1.5px accent     (the dark tube)
 *   1px   mid        (a step between the tube and the core)
 *   1px   core       (the inner highlight)
 *   1px   mid        (step back down)
 *   1.5px accent     (the dark tube)
 *   transparent after 6px
 *
 * The `core` color of each metal is deliberately shifted toward its
 * accent so the inner layer reads as a warm highlight rather than a
 * near-white stripe.
 *
 * The gradient is drawn under a `borderLeft: 6px solid transparent`,
 * with `backgroundOrigin: border-box` on the element, so its left
 * edge sits at x=0 of the element — flush with the header's cyan
 * border.
 */
function leftBarGradient(
    accent: string,
    mid: string,
    core: string,
): string {
    return `linear-gradient(to right, ${accent} 0px 1.5px, ${mid} 1.5px 2.5px, ${core} 2.5px 3.5px, ${mid} 3.5px 4.5px, ${accent} 4.5px 6px, transparent 6px)`;
}

interface RankAccent {
    accent: string;
    /** Intermediate shade used by the contained bar between the
     *  accent and the core. */
    mid: string;
    /** Inner highlight color used by the contained bar. Kept close
     *  in value to the accent so it reads as a warm highlight, not
     *  as a near-white stripe. */
    core: string;
    tint: string | undefined;
    glow: string;
}

function rankAccent(rank: number): RankAccent {
    if (rank === 1) {
        return {
            accent: GOLD,
            mid: '#FFD666',
            core: '#FFDD7A',
            tint: 'rgba(255, 199, 44, 0.28)',
            glow: 'rgba(255, 199, 44, 0.6)',
        };
    }
    if (rank === 2) {
        return {
            accent: SILVER,
            mid: '#D8D8D8',
            core: '#E0E0E0',
            tint: 'rgba(200, 205, 220, 0.26)',
            glow: 'rgba(192, 192, 192, 0.55)',
        };
    }
    if (rank === 3) {
        return {
            accent: BRONZE,
            mid: '#D89A5A',
            core: '#DCA478',
            tint: 'rgba(205, 127, 50, 0.28)',
            glow: 'rgba(205, 127, 50, 0.55)',
        };
    }
    // Rank 4+: red bar with a warm inner highlight that stays close
    // to the red so it never goes pink.
    return {
        accent: RED_NEON,
        mid: '#FF5068',
        core: '#FF6878',
        tint: undefined,
        glow: 'rgba(255, 15, 61, 0.55)',
    };
}

function renderDailyTotal(value: number) {
    if (value > 0) {
        return (
            <span className='font-semibold text-[#22C55E]'>
                +{value}
            </span>
        );
    }
    return <span className='text-muted-foreground'>0</span>;
}

// ---------------------------------------------------------------------
// Small line-chart glyph used in the FP column
// ---------------------------------------------------------------------

function TrendGlyph({ color = GOLD }: { color?: string }) {
    return (
        <svg
            viewBox='0 0 24 24'
            width={16}
            height={16}
            fill='none'
            stroke={color}
            strokeWidth={2}
            strokeLinecap='round'
            strokeLinejoin='round'
            aria-hidden='true'
            style={{ filter: `drop-shadow(0 0 2px ${color})` }}
        >
            <path d='M3 17 L9 11 L13 15 L21 6' />
            <path d='M15 6 L21 6 L21 12' />
        </svg>
    );
}

// ---------------------------------------------------------------------
// Rank cell — crown for 1, metallic pill for 2/3, outlined for 4+
// ---------------------------------------------------------------------

function RankCell({
    rank,
    isMine,
}: {
    rank: number;
    isMine: boolean;
}) {
    if (rank === 1) {
        return (
            <span
                className='inline-flex h-6 w-6 items-center justify-center'
                aria-label='Première place'
            >
                <svg
                    viewBox='0 0 24 24'
                    className='h-4 w-4'
                    fill='none'
                    stroke={GOLD}
                    strokeWidth={2.4}
                    strokeLinejoin='round'
                    aria-hidden='true'
                >
                    <path d='M3 8l4.5 4L12 5l4.5 7L21 8l-2 10H5L3 8z' />
                </svg>
                <svg
                    viewBox='0 0 24 24'
                    className='absolute h-4 w-4'
                    fill='none'
                    stroke='#FFF4C9'
                    strokeWidth={1}
                    strokeLinejoin='round'
                    aria-hidden='true'
                >
                    <path d='M3 8l4.5 4L12 5l4.5 7L21 8l-2 10H5L3 8z' />
                </svg>
            </span>
        );
    }

    if (rank === 2 || rank === 3) {
        const isSilver = rank === 2;

        return (
            <span
                className='flex h-6 w-6 items-center justify-center rounded-full text-[0.85rem] font-bold'
                style={{
                    color: isSilver ? '#1a1a1a' : '#FFFFFF',
                    background: isSilver
                        ? 'linear-gradient(180deg, #f8fafc 0%, #d4d8dd 35%, #a8aeb5 65%, #d0d4d9 100%)'
                        : 'linear-gradient(180deg, #f0c893 0%, #d69a5a 35%, #a5612c 65%, #d08a48 100%)',
                    boxShadow: isSilver
                        ? 'inset 0 1px 0 rgba(255, 255, 255, 0.9), inset 0 -1px 0 rgba(0, 0, 0, 0.25), 0 1px 2px rgba(0, 0, 0, 0.4)'
                        : 'inset 0 1px 0 rgba(255, 220, 180, 0.8), inset 0 -1px 0 rgba(0, 0, 0, 0.35), 0 1px 2px rgba(0, 0, 0, 0.4)',
                    textShadow: isSilver
                        ? '0 1px 0 rgba(255, 255, 255, 0.7)'
                        : '0 1px 1px rgba(0, 0, 0, 0.5)',
                }}
                aria-hidden='true'
            >
                {rank}
            </span>
        );
    }

    return (
        <span
            className='flex h-6 w-6 items-center justify-center rounded-full text-[0.85rem] font-bold'
            style={{
                color: isMine ? ELECTRIC_BRIGHT : ELECTRIC_SOFT,
                border: `1.5px solid ${isMine ? ELECTRIC_BRIGHT : 'rgba(51, 187, 255, 0.4)'}`,
            }}
            aria-hidden='true'
        >
            {rank}
        </span>
    );
}

// ---------------------------------------------------------------------
// Sortable column header
// ---------------------------------------------------------------------

function ColumnHeader({
    label,
    sortField,
    activeSortField,
    sortDirection,
    onClick,
    color = ELECTRIC_SOFT,
}: {
    label: string;
    sortField: SortKey;
    activeSortField: SortKey;
    sortDirection: SortDirection;
    onClick: (key: SortKey) => void;
    color?: string;
}) {
    const active = activeSortField === sortField;

    const isCompact = label === 'HIER' || label === 'AJD';

    return (
        <button
            type='button'
            onClick={() => onClick(sortField)}
            className={cn(
                'w-full cursor-pointer select-none text-center font-bold uppercase tracking-wider transition-colors hover:text-white',
                isCompact && 'text-[0.5rem] sm:text-[0.6rem]',
            )}
            style={{
                color: active ? ELECTRIC_BRIGHT : color,
            }}
        >
            {label}
            {active && (
                <span className='ml-0.5 inline-block text-[0.6rem] align-middle'>
                    {sortDirection === 'asc' ? '▲' : '▼'}
                </span>
            )}
        </button>
    );
}

// ---------------------------------------------------------------------
// "Mes joueurs" sections (today + yesterday)
// ---------------------------------------------------------------------

/**
 * Compact grid for the "Mes joueurs" table.
 *
 * Columns: logo | name | G | A | PTS | +/- | TOI | SOG.
 * Total fixed width is ~190px, which leaves enough room for a
 * short name on a 375px phone once the page padding is accounted
 * for. TOI gets the widest fixed column because it holds an
 * "MM:SS" string rather than a single digit count.
 */
const MY_PLAYERS_GRID_COLUMNS =
    '34px minmax(0,1fr) 62px 22px 22px 28px 44px 32px';

interface PlayerGameStats {
    entry: RosterEntry;
    gameId: number;
    goals: number | null;
    assists: number | null;
    points: number | null;
    plusMinus: number | null;
    timeOnIce: string | null;
    shots: number | null;
    /**
     * Fantasy points for that single game, computed on the frontend
     * from the boxscore values (same formula the backend uses for
     * PlayerGameLog.FantasyPoints). Null when the player did not
     * dress, matching the other columns.
     */
    fantasyPoints: number | null;
    /**
     * Short human-readable state of the game the player is in:
     *   - "À venir"               : not started yet
     *   - "2e · 10:32"            : live, period 2, 10:32 left
     *   - "2e · Entracte"         : between periods
     *   - "Terminé"               : final horn
     *   - "—"                     : unknown / boxscore missing
     */
    gameClockLabel: string;
    /**
     * Scheduled puck-drop instant (UTC ISO string) for the game the
     * player is in. Never changes once the game is scheduled, so it
     * is the stable sort key the table uses to keep rows pinned in
     * their pre-game order even after a game goes LIVE and the
     * "Temps" column shows a running clock instead of the start
     * time.
     */
    gameStartTimeUtc: string;
}

type MyPlayersVariant = 'today' | 'yesterday';

const VARIANT_CONFIG: Record<
    MyPlayersVariant,
    {
        title: string;
        emptyMessage: string;
        loadingMessage: string;
        errorMessage: string;
    }
> = {
    today: {
        title: "Aujourd'hui",
        emptyMessage: "Aucun de vos joueurs ne joue aujourd'hui.",
        loadingMessage: 'Chargement des joueurs du jour...',
        errorMessage:
            'Impossible de charger les statistiques du jour.',
    },
    yesterday: {
        title: 'Hier',
        emptyMessage: "Aucun de vos joueurs n'a joué hier.",
        loadingMessage: "Chargement des joueurs d'hier...",
        errorMessage:
            "Impossible de charger les statistiques d'hier.",
    },
};

/**
 * Renders the list of players on the current user's fantasy team who
 * played on the target day (today or yesterday), with their per-game
 * stats for that day.
 *
 * Data flow:
 *   1. Get the user's roster (GET /api/Roster/team/{id}).
 *   2. Get the NHL schedule for the target day:
 *        - today     -> GET /api/Games/today, then keep only the
 *                       games that fall on the user's local calendar
 *                       day (the endpoint returns the whole game
 *                       week).
 *        - yesterday -> GET /api/Games/by-date/{yyyy-MM-dd}, which
 *                       is already filtered to that ET date on the
 *                       server.
 *   3. Work out which of those games involve a team the user has a
 *      player on. Only fetch those boxscores.
 *   4. Match each roster player to their entry in the boxscore by
 *      NHL player id and read off G / A / PTS / +/- / TOI / SOG.
 *
 * The table uses the same visual chrome as the standings table:
 * cyan hairline borders, the same header gradient, a #050A16
 * background, and a contained neon tube on the left edge of every
 * row.
 *
 * When `refreshTick` changes, the section silently re-fetches
 * without flashing the loading state or the error state. The very
 * first load (the one that runs on mount) still shows the loading
 * state as before.
 */
function MyPlayersSection({
    variant,
    refreshTick,
}: {
    variant: MyPlayersVariant;
    refreshTick: number;
}) {
    const { user } = useAuth();
    const teamId = user?.fantasyTeamId ?? null;

    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [players, setPlayers] = useState<PlayerGameStats[]>([]);

    const config = VARIANT_CONFIG[variant];

    /**
     * Shared fetch routine. `silent` skips the loading/error toggles
     * so an auto-refresh never flashes the UI.
     */
    const loadPlayers = async (
        cancelledRef: { cancelled: boolean },
        silent: boolean,
    ) => {
        if (teamId == null) {
            if (!silent) {
                setLoading(false);
                setPlayers([]);
            }
            return;
        }

        if (!silent) {
            setLoading(true);
            setError(null);
        }

        try {
            const roster = await getTeamRoster(teamId);

            if (cancelledRef.cancelled) return;

            const result: PlayerGameStats[] = [];

            if (variant === 'yesterday') {
                // ---------------------------------------------------
                // HIER — read from PlayerGameLog, never from the
                // NHL API. Yesterday's games are final and frozen,
                // so the DB already has everything we need. This
                // path is instant and cannot trigger a 429.
                //
                // Only players who dressed are returned by the
                // endpoint: a PlayerGameLog row exists only when
                // the player actually appeared in a game.
                // ---------------------------------------------------

                const yesterdayIso = toIsoDate(
                    new Date(Date.now() - 86_400_000),
                );

                const stats = await getRosterGameStatsForDate(
                    teamId,
                    yesterdayIso,
                );

                if (cancelledRef.cancelled) return;

                // Cross-reference with the current roster so we can
                // render the same card shape as the today variant
                // (name, position, team abbreviation, isGoalie).
                const entryByPlayerId = new Map<number, RosterEntry>();

                for (const entry of roster.entries) {
                    entryByPlayerId.set(entry.playerId, entry);
                }

                for (const stat of stats) {
                    const entry = entryByPlayerId.get(stat.playerId);

                    // Player not on the current roster (traded away
                    // since yesterday) — skip.
                    if (!entry) continue;

                    result.push({
                        entry,
                        gameId: stat.gameId,
                        goals: stat.goals,
                        assists: stat.assists,
                        points: stat.points,
                        plusMinus: stat.plusMinus,
                        timeOnIce: stat.timeOnIce,
                        shots: stat.shots,
                        fantasyPoints: stat.fantasyPoints,
                        // Yesterday's games are always final; the
                        // "Temps" column shows the same label for
                        // every row.
                        gameClockLabel: 'Terminé',
                        // Not used by the sort for yesterday, but
                        // the field is required on the interface.
                        gameStartTimeUtc: '',
                    });
                }
            } else {
                // ---------------------------------------------------
                // AUJOURD'HUI — keep the boxscore path. Live games
                // need the clock, which only the boxscore carries.
                // ---------------------------------------------------

                const schedule = await getTodayGames();

                const games = schedule.games.filter(
                    (g) => isTodayLocal(g.startTimeUtc) || isLive(g),
                );

                if (cancelledRef.cancelled) return;

                const gameByTeam = new Map<string, GameDayGameSummary>();

                for (const g of games) {
                    gameByTeam.set(g.awayAbbreviation, g);
                    gameByTeam.set(g.homeAbbreviation, g);
                }

                // Hide players who should not appear in today's
                // table even if their NHL team has a game scheduled:
                //   - injured or suspended (ESPN flag on the entry)
                //   - sent down to the AHL affiliate
                //   - no longer on any active NHL or AHL roster
                //
                // The "Hier" table is a historical game log and is
                // intentionally NOT filtered here: it still shows
                // every player who dressed yesterday, including one
                // who got hurt mid-game. Only the "Aujourd'hui"
                // table cares about the current availability.
                const visibleEntries = roster.entries.filter(
                    (entry) =>
                        !entry.isInjured &&
                        entry.rosterLocation !== 'AhlRoster' &&
                        entry.rosterLocation !== 'NotOnActiveRoster',
                );

                // Only fetch boxscores for games that involve at
                // least one team the user has a visible player on
                // AND whose boxscore actually exists. Skipping
                // FUT/PRE games avoids a 404 per scheduled-but-not-
                // yet-started game, which is what floods the browser
                // console during the day.
                const relevantGameIds = new Set<number>();

                for (const entry of visibleEntries) {
                    const g = gameByTeam.get(entry.nhlTeamAbbreviation);
                    if (g && g.hasBoxscore) relevantGameIds.add(g.gameId);
                }

                const boxes = await Promise.all(
                    Array.from(relevantGameIds).map((id) =>
                        getGameBoxscore(id).catch(() => null),
                    ),
                );

                if (cancelledRef.cancelled) return;

                const boxById = new Map<number, NhlBoxscoreResponse>();

                for (const box of boxes) {
                    if (box) boxById.set(box.id, box);
                }

                for (const entry of visibleEntries) {
                    const game = gameByTeam.get(entry.nhlTeamAbbreviation);
                    if (!game) continue;

                    const box = boxById.get(game.gameId) ?? null;
                    const isGoalie =
                        entry.position?.toUpperCase() === 'G';

                    let goals: number | null = null;
                    let assists: number | null = null;
                    let points: number | null = null;
                    let plusMinus: number | null = null;
                    let timeOnIce: string | null = null;
                    let shots: number | null = null;
                    let fantasyPoints: number | null = null;

                    if (box) {
                        const skater = isGoalie
                            ? null
                            : findSkater(box, entry.nhlPlayerId);

                        const goalie = isGoalie
                            ? findGoalie(box, entry.nhlPlayerId)
                            : null;

                        if (skater) {
                            goals = skater.goals;
                            assists = skater.assists;
                            points = skater.points;
                            plusMinus = skater.plusMinus;
                            timeOnIce = skater.toi;
                            shots = skater.shots;

                            // Skater FP: 1 point per G/A, +3 for a hat
                            // trick (3+ goals in the game).
                            fantasyPoints =
                                skater.points +
                                (skater.goals >= 3 ? 3 : 0);
                        } else if (goalie) {
                            goals = goalie.goals;
                            assists = goalie.assists;
                            points = goalie.points;
                            plusMinus = null;
                            timeOnIce = goalie.toi;
                            shots = null;

                            // Goalie FP: G + A, +2 for a win, +1 for
                            // an overtime loss, +3 for a shutout.
                            let goalieFp =
                                goalie.goals + goalie.assists;

                            if (goalie.decision === 'W') {
                                goalieFp += 2;
                            }
                            if (goalie.decision === 'O') {
                                goalieFp += 1;
                            }
                            if (
                                goalie.decision != null &&
                                goalie.goalsAgainst === 0 &&
                                goalie.shotsAgainst > 0
                            ) {
                                goalieFp += 3;
                            }

                            fantasyPoints = goalieFp;
                        }
                    }

                    result.push({
                        entry,
                        gameId: game.gameId,
                        goals,
                        assists,
                        points,
                        plusMinus,
                        timeOnIce,
                        shots,
                        fantasyPoints,
                        gameClockLabel: gameClockLabel(box, game),
                        gameStartTimeUtc: game.startTimeUtc,
                    });
                }
            }

            // Sort rules, applied in this order:
            //   1. Fantasy points descending — biggest contributors
            //      on top. Players who did not dress (null FP) sink
            //      to the bottom.
            //   2. Scheduled game start time (UTC, ascending). For
            //      today this keeps live rows stable while a game
            //      progresses. For yesterday all values are '' so
            //      this is a no-op.
            //   3. Last name A→Z as the final tiebreak.
            result.sort((a, b) => {
                const aHasFp = a.fantasyPoints != null;
                const bHasFp = b.fantasyPoints != null;

                if (aHasFp !== bHasFp) {
                    return aHasFp ? -1 : 1;
                }

                if (aHasFp && bHasFp) {
                    const fpCmp =
                        (b.fantasyPoints ?? 0) -
                        (a.fantasyPoints ?? 0);
                    if (fpCmp !== 0) return fpCmp;
                }

                const startCmp = a.gameStartTimeUtc.localeCompare(
                    b.gameStartTimeUtc,
                );
                if (startCmp !== 0) return startCmp;

                const aLast = a.entry.lastName ?? '';
                const bLast = b.entry.lastName ?? '';

                return aLast.localeCompare(bLast);
            });

            if (cancelledRef.cancelled) return;

            setPlayers(result);

            if (!silent) {
                setLoading(false);
            }
        } catch {
            if (cancelledRef.cancelled) return;

            if (!silent) {
                setError(config.errorMessage);
                setLoading(false);
            }
            // Silent mode swallows errors: the next tick will retry.
        }
    };

    // Initial load. Fires on mount and whenever the team, the
    // variant, or the error message (i.e. the display context)
    // changes. Shows the loading state.
    useEffect(() => {
        const ref = { cancelled: false };

        void loadPlayers(ref, false);

        return () => {
            ref.cancelled = true;
        };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [teamId, variant, config.errorMessage]);

    // Auto-refresh tick. Fires only when the scheduler bumps the
    // counter, so it is silent by construction. Skipped on the very
    // first render because refreshTick starts at 0 and the initial
    // load effect above already fetched everything.
    useEffect(() => {
        if (refreshTick === 0) return;

        const ref = { cancelled: false };

        void loadPlayers(ref, true);

        return () => {
            ref.cancelled = true;
        };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [refreshTick]);

    if (teamId == null) return null;

    if (loading) {
        return (
            <div className='mt-1 text-center text-sm text-muted-foreground'>
                {config.loadingMessage}
            </div>
        );
    }

    if (error) {
        return (
            <div className='mt-1 text-center text-sm text-destructive'>
                {error}
            </div>
        );
    }

    return (
        <div className='mt-1'>
            <h3 className='text-center'>
                <NeonTitle variant='subsection' keepPulseOnMobile>
                    {config.title}
                </NeonTitle>
            </h3>

            {players.length === 0 ? (
                <p className='mt-2 rounded-lg border border-border bg-card px-3 py-4 text-center text-sm text-muted-foreground'>
                    {config.emptyMessage}
                </p>
            ) : (
                <div className='relative mt-2'>
                    {/* ---- Header row (same chrome as the standings
                        table's header) ---- */}
                        <div
                            className='grid items-center rounded-t-lg border-b px-2 py-2.5 text-[0.7rem] sm:text-[0.8rem]'
                            style={{
                                gridTemplateColumns: MY_PLAYERS_GRID_COLUMNS,
                                borderColor: 'rgba(51, 187, 255, 0.35)',
                                borderTop: '1px solid #33BBFF',
                                borderLeft: '1px solid #33BBFF',
                                borderRight: '1px solid #33BBFF',
                                background:
                                    'linear-gradient(180deg, rgba(0, 136, 255, 0.18), rgba(0, 136, 255, 0.02))',
                                backgroundColor: '#050A16',
                            }}
                        >
                            <div />
                            <div className='pl-0.5 font-bold uppercase tracking-wider text-[#33BBFF]'>
                                Joueur
                            </div>
                            <div className='text-center font-bold uppercase tracking-wider text-[#33BBFF]'>
                                Temps
                            </div>
                            <div className='text-center font-bold uppercase tracking-wider text-[#33BBFF]'>
                                G
                            </div>
                            <div className='text-center font-bold uppercase tracking-wider text-[#33BBFF]'>
                                A
                            </div>
                            <div
                                className='text-center font-bold uppercase tracking-wider'
                                style={{ color: PTS_HIGHLIGHT }}
                            >
                                PTS
                            </div>
                            <div className='text-center font-bold uppercase tracking-wider text-[#33BBFF]'>
                                TOI
                            </div>
                            <div
                                className='text-center font-bold uppercase tracking-wider'
                                style={{ color: GOLD }}
                            >
                                FP
                            </div>
                        </div>

                    {/* ---- Data rows wrapper (same chrome as the
                        standings table's row wrapper) ---- */}
                    <div
                        className='relative overflow-hidden rounded-b-lg'
                        style={{
                            borderRight: '1px solid #33BBFF',
                            borderBottom: '1px solid #33BBFF',
                            backgroundColor: '#050A16',
                        }}
                    >
                            {players.map((p) => (
                                <div
                                    key={p.entry.id}
                                    className='relative grid items-center border-b px-2 py-1.5 text-[0.85rem] tabular-nums transition-colors last:border-b-0 hover:bg-[#0088FF]/5 sm:py-2 sm:text-[0.95rem]'
                                    style={{
                                        gridTemplateColumns:
                                            MY_PLAYERS_GRID_COLUMNS,
                                        backgroundImage: leftBarGradient(
                                            PLAYER_ROW_ACCENT.accent,
                                            PLAYER_ROW_ACCENT.mid,
                                            PLAYER_ROW_ACCENT.core,
                                        ),
                                        borderLeft: '6px solid transparent',
                                        backgroundOrigin: 'border-box',
                                        backgroundClip: 'border-box',
                                        borderBottomColor:
                                            'rgba(51, 187, 255, 0.12)',
                                    }}
                                >
                                    <div
                                        className='flex items-center justify-center'
                                        style={{ height: 20 }}
                                    >
                                        <NhlTeamLogo
                                            abbreviation={p.entry.nhlTeamAbbreviation}
                                            size={32}
                                        />
                                    </div>

                                    <Link
                                        to={`/joueurs/${p.entry.nhlPlayerId}`}
                                        className={cn(
                                            'truncate pl-0.5 text-left font-semibold transition-colors',
                                            isGoaliePosition(p.entry.position)
                                                ? 'text-[#22C55E] hover:brightness-125'
                                                : 'text-foreground hover:text-[#33BBFF]',
                                        )}
                                    >
                                        {shortName(
                                            p.entry.firstName,
                                            p.entry.lastName,
                                        )}
                                    </Link>

                                    <div
                                        className='text-center text-[0.7rem] font-semibold tabular-nums'
                                        style={{ color: GOLD }}
                                    >
                                        {p.gameClockLabel}
                                    </div>

                                    <div className='text-center text-[#7DD3FC]'>
                                        {formatStat(p.goals)}
                                    </div>
                                    <div className='text-center text-[#7DD3FC]'>
                                        {formatStat(p.assists)}
                                    </div>
                                    <div
                                        className='text-center font-semibold'
                                        style={{ color: PTS_HIGHLIGHT }}
                                    >
                                        {formatStat(p.points)}
                                    </div>
                                    <div className='text-center text-[#7DD3FC]'>
                                        {p.timeOnIce ?? '—'}
                                    </div>
                                    <div
                                        className='text-center font-semibold'
                                        style={{ color: GOLD }}
                                    >
                                        {formatStat(p.fantasyPoints)}
                                    </div>
                                </div>
                            ))}
                    </div>
                </div>
            )}
        </div>
    );
}

// ---------------------------------------------------------------------
// Small helpers used by the sections above
// ---------------------------------------------------------------------

/**
 * Formats a Date as a local ISO date (yyyy-MM-dd). Same logic the
 * GameDay page uses for its date picker.
 */
function toIsoDate(d: Date): string {
    const yyyy = d.getFullYear();
    const mm = String(d.getMonth() + 1).padStart(2, '0');
    const dd = String(d.getDate()).padStart(2, '0');
    return `${yyyy}-${mm}-${dd}`;
}

/**
 * True when the given UTC instant falls on the user's local
 * calendar day. Mirrors the helper in GameDayPage so both pages
 * agree on what "today" means.
 */
function isTodayLocal(iso: string): boolean {
    const start = new Date(iso);

    if (Number.isNaN(start.getTime())) {
        return false;
    }

    const now = new Date();

    const startOfToday = new Date(
        now.getFullYear(),
        now.getMonth(),
        now.getDate(),
    );

    const startOfTomorrow = new Date(startOfToday);
    startOfTomorrow.setDate(startOfTomorrow.getDate() + 1);

    return start >= startOfToday && start < startOfTomorrow;
}

function isLive(g: GameDayGameSummary): boolean {
    return g.gameState === 'LIVE' || g.gameState === 'CRIT';
}

function shortName(firstName: string, lastName: string): string {
    const initial = firstName.trim().charAt(0);

    return initial ? `${initial}. ${lastName}` : lastName;
}

function formatStat(v: number | null): string {
    return v == null ? '—' : String(v);
}

/**
 * Short French label for a period: "1re", "2e", "3e", "Prol." (OT),
 * "TAB" (shootout). Falls back to "Ne" for anything unexpected.
 */
function formatPeriodLabel(period: NhlPeriodDescriptor): string {
    if (period.periodType === 'OT') return 'Prol.';
    if (period.periodType === 'SO') return 'TAB';
    if (period.number === 1) return '1re';
    if (period.number === 2) return '2e';
    if (period.number === 3) return '3e';
    return `${period.number}e`;
}

/**
 * Formatter for NHL game start times, rendered in Eastern Time.
 * fr-CA with hour12:false produces "19:00"; we replace the colon
 * with an "h" to get the compact "19h00" that fits the narrow
 * "Temps" column.
 */
const GAME_TIME_FORMATTER = new Intl.DateTimeFormat('fr-CA', {
    hour: '2-digit',
    minute: '2-digit',
    timeZone: 'America/Toronto',
    hour12: false,
});

/**
 * Formats a UTC ISO instant as the game's start time in ET, e.g.
 * "19h00". Returns "—" when the instant cannot be parsed.
 */
function formatStartTimeEt(startTimeUtc: string): string {
    const d = new Date(startTimeUtc);
    if (Number.isNaN(d.getTime())) return '—';
    return GAME_TIME_FORMATTER.format(d).replace(':', 'h');
}

/**
 * Sort key for a player's position inside a team group.
 *   0 = Forward (or unknown)
 *   1 = Defense
 *   2 = Goalie
 *
 * Used by the "Mes joueurs" tables to keep forwards first, then
 * defensemen, then the goalie inside each team block.
 */
function positionOrder(position: string | null | undefined): number {
    const p = (position ?? '').trim().toUpperCase();

    if (
        p === 'G' ||
        p === 'GK' ||
        p === 'GOALIE' ||
        p === 'GOALTENDER' ||
        p === 'GARDIEN' ||
        p === 'GARDIEN DE BUT'
    ) {
        return 2;
    }

    if (
        p === 'D' ||
        p === 'LD' ||
        p === 'RD' ||
        p === 'DEFENSE' ||
        p === 'DEFENCE' ||
        p === 'DEFENSEMAN' ||
        p === 'DEFENCEMAN' ||
        p === 'DEFENSEUR' ||
        p === 'ARRIERE' ||
        p === 'LEFT DEFENSE' ||
        p === 'RIGHT DEFENSE'
    ) {
        return 1;
    }

    return 0;
}

/**
 * True when the raw position string denotes a goalie. Used to
 * render the player name in green in the "Mes joueurs" tables.
 */
function isGoaliePosition(
    position: string | null | undefined,
): boolean {
    return positionOrder(position) === 2;
}

/**
 * Human-readable state of the game the player is currently in.
 *
 *   - Not started (FUT / PRE)         -> "19h00" (start time, ET)
 *   - Live, in progress (LIVE / CRIT) -> "2e · 10:32"
 *   - Live, between periods           -> "2e · Entracte"
 *   - Finished (FINAL / OFF)          -> "Terminé"
 *   - Unknown state / no boxscore     -> "—"
 *
 * Falls back to the schedule summary's gameState when the boxscore
 * could not be fetched, so a row still gets a meaningful label.
 */
function gameClockLabel(
    box: NhlBoxscoreResponse | null,
    summary: GameDayGameSummary,
): string {
    const state = (box?.gameState ?? summary.gameState).toUpperCase();

    if (state === 'FUT' || state === 'PRE') {
        // Game has not started yet: show the scheduled start time
        // in Eastern Time instead of a generic label, so the user
        // knows exactly when the puck drops.
        return formatStartTimeEt(summary.startTimeUtc);
    }

    if (state === 'LIVE' || state === 'CRIT') {
        const period = box?.periodDescriptor ?? null;
        const clock = box?.clock ?? null;

        if (!period) {
            return 'En direct';
        }

        const periodText = formatPeriodLabel(period);

        if (clock?.inIntermission) {
            return `${periodText} · Entracte`;
        }

        if (clock?.timeRemaining) {
            return `${periodText} · ${clock.timeRemaining}`;
        }

        return periodText;
    }

    if (state === 'FINAL' || state === 'OFF') {
        return 'Terminé';
    }

    return '—';
}

function findSkater(
    box: NhlBoxscoreResponse,
    nhlPlayerId: number,
): NhlSkaterStats | null {
    const all = [
        ...box.playerByGameStats.awayTeam.forwards,
        ...box.playerByGameStats.awayTeam.defense,
        ...box.playerByGameStats.homeTeam.forwards,
        ...box.playerByGameStats.homeTeam.defense,
    ];

    return all.find((s) => s.playerId === nhlPlayerId) ?? null;
}

function findGoalie(
    box: NhlBoxscoreResponse,
    nhlPlayerId: number,
): NhlGoalieStats | null {
    const all = [
        ...box.playerByGameStats.awayTeam.goalies,
        ...box.playerByGameStats.homeTeam.goalies,
    ];

    return all.find((g) => g.playerId === nhlPlayerId) ?? null;
}

// ---------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------

export default function ClassementPage() {
    const { user } = useAuth();
    const myTeamId = user?.fantasyTeamId ?? null;

    const [rows, setRows] = useState<StandingsRow[]>([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);

    const [sortKey, setSortKey] =
        useState<SortKey>('totalFantasyPoints');
    const [sortDirection, setSortDirection] =
        useState<SortDirection>('desc');

    // Schedule-aware refresh tick. Every bump triggers a silent
    // re-fetch of both the standings table and the two "Mes joueurs"
    // tables, with no loading flash and no page reload.
    const refreshTick = useAutoRefreshTick();

    // Initial load. Runs once on mount.
    useEffect(() => {
        let cancelled = false;

        setLoading(true);
        setError(null);

        getStandings()
            .then((data) => {
                if (!cancelled) {
                    setRows(data);
                }
            })
            .catch(() => {
                if (!cancelled) {
                    setError('Vérifiez que le serveur API est démarré.');
                }
            })
            .finally(() => {
                if (!cancelled) {
                    setLoading(false);
                }
            });

        return () => {
            cancelled = true;
        };
    }, []);

    // Silent refresh on auto-refresh tick. Skipped on the first
    // render because refreshTick starts at 0 and the initial load
    // above already fetched everything.
    useEffect(() => {
        if (refreshTick === 0) return;

        let cancelled = false;

        getStandings()
            .then((data) => {
                if (!cancelled) {
                    setRows(data);
                }
            })
            .catch(() => {
                // Silent: the next tick will retry.
            });

        return () => {
            cancelled = true;
        };
    }, [refreshTick]);

    function getSortValue(row: StandingsRow, key: SortKey): number {
        switch (key) {
            case 'totalGames':
                return row.skaterGamesPlayed + row.goalieGamesPlayed;
            case 'skaterHatTricks':
                return row.skaterHatTricks;
            case 'goalieWins':
                return row.goalieWins;
            case 'goalieOvertimeLosses':
                return row.goalieOvertimeLosses;
            case 'goalieShutouts':
                return row.goalieShutouts;
            case 'totalPoints':
                return row.skaterPoints + row.goaliePoints;
            case 'yesterdayFantasyPoints':
                return row.yesterdayFantasyPoints;
            case 'todayFantasyPoints':
                return row.todayFantasyPoints;
            case 'totalFantasyPoints':
                return row.totalFantasyPoints;
        }
    }

    function handleSort(key: SortKey) {
        if (sortKey === key) {
            setSortDirection((d) => (d === 'asc' ? 'desc' : 'asc'));
        } else {
            setSortKey(key);
            setSortDirection('desc');
        }
    }

    const sortedRows = useMemo(() => {
        const copy = [...rows];

        copy.sort((a, b) => {
            const av = getSortValue(a, sortKey);
            const bv = getSortValue(b, sortKey);

            if (av === bv) {
                return a.fantasyTeamName.localeCompare(b.fantasyTeamName);
            }

            return sortDirection === 'asc' ? av - bv : bv - av;
        });

        return copy;
    }, [rows, sortKey, sortDirection]);

    if (loading) {
        return (
            <section className='-mt-4 flex min-h-full w-full flex-col gap-3 sm:-mt-6'>
                <div className='flex flex-col items-center gap-1 pb-1'>
                    <Crown
                        className='h-6 w-6'
                        strokeWidth={2.2}
                        style={{ color: GOLD }}
                    />
                    <div className='flex w-full max-w-3xl items-center gap-3 px-4'>
                        <div
                            className='h-px flex-1'
                            style={{
                                background:
                                    'linear-gradient(to right, transparent, rgba(0, 168, 255, 0.9))',
                                boxShadow:
                                    '0 0 6px rgba(0, 168, 255, 0.7)',
                            }}
                        />
                        <h2 className='shrink-0 text-center'>
                            <NeonTitle keepPulseOnMobile>
                                Classement
                            </NeonTitle>
                        </h2>
                        <div
                            className='h-px flex-1'
                            style={{
                                background:
                                    'linear-gradient(to left, transparent, rgba(0, 168, 255, 0.9))',
                                boxShadow:
                                    '0 0 6px rgba(0, 168, 255, 0.7)',
                            }}
                        />
                    </div>
                </div>
                <p className='text-center text-muted-foreground'>
                    Chargement...
                </p>
            </section>
        );
    }

    if (error) {
        return (
            <section className='-mt-4 flex min-h-full w-full flex-col gap-3 sm:-mt-6'>
                <div className='flex flex-col items-center gap-1 pb-1'>
                    <Crown
                        className='h-6 w-6'
                        strokeWidth={2.2}
                        style={{ color: GOLD }}
                    />
                    <div className='flex w-full max-w-3xl items-center gap-3 px-4'>
                        <div
                            className='h-px flex-1'
                            style={{
                                background:
                                    'linear-gradient(to right, transparent, rgba(0, 168, 255, 0.9))',
                                boxShadow:
                                    '0 0 6px rgba(0, 168, 255, 0.7)',
                            }}
                        />
                        <h2 className='shrink-0 text-center'>
                            <NeonTitle keepPulseOnMobile>
                                Classement
                            </NeonTitle>
                        </h2>
                        <div
                            className='h-px flex-1'
                            style={{
                                background:
                                    'linear-gradient(to left, transparent, rgba(0, 168, 255, 0.9))',
                                boxShadow:
                                    '0 0 6px rgba(0, 168, 255, 0.7)',
                            }}
                        />
                    </div>
                </div>
                <p className='text-center text-destructive'>{error}</p>
            </section>
        );
    }

    return (
        <section className='-mt-4 flex min-h-full w-full flex-col gap-3 sm:-mt-6'>
            {/* ============================================================
                Header: crown above, Classement title flanked by the
                cyan hairlines. No red aura behind the crown.
                ============================================================ */}
            <div className='flex flex-col items-center gap-1 pb-1'>
                <Crown
                    className='h-6 w-6'
                    strokeWidth={2.2}
                    style={{ color: GOLD }}
                />
                <div className='flex w-full max-w-3xl items-center gap-3 px-4'>
                    <div
                        className='h-px flex-1'
                        style={{
                            background:
                                'linear-gradient(to right, transparent, rgba(0, 168, 255, 0.9))',
                            boxShadow:
                                '0 0 6px rgba(0, 168, 255, 0.7)',
                        }}
                    />
                    <h2 className='shrink-0 text-center'>
                        <NeonTitle keepPulseOnMobile>
                            Classement
                        </NeonTitle>
                    </h2>
                    <div
                        className='h-px flex-1'
                        style={{
                            background:
                                'linear-gradient(to left, transparent, rgba(0, 168, 255, 0.9))',
                            boxShadow:
                                '0 0 6px rgba(0, 168, 255, 0.7)',
                        }}
                    />
                </div>
            </div>

            {/* ============================================================
                Standings table
                ============================================================ */}
            {rows.length === 0 ? (
                <p className='flex-1 rounded-lg border border-border bg-card px-3 py-6 text-center text-sm text-muted-foreground'>
                    Aucune donnée de classement pour le moment.
                </p>
            ) : (
                <div className='relative'>
                    {/* ---- Header row ---- */}
                    <div
                        className='grid items-center rounded-t-lg border-b px-2 py-2.5 text-[0.6rem] sm:text-[0.7rem]'
                        style={{
                            gridTemplateColumns: GRID_COLUMNS,
                            borderColor: 'rgba(51, 187, 255, 0.35)',
                            borderTop: '1px solid #33BBFF',
                            borderLeft: '1px solid #33BBFF',
                            borderRight: '1px solid #33BBFF',
                            background:
                                'linear-gradient(180deg, rgba(0, 136, 255, 0.18), rgba(0, 136, 255, 0.02))',
                            backgroundColor: '#050A16',
                        }}
                    >
                        <div className='text-center font-bold uppercase tracking-wider text-[#33BBFF]'>
                            #
                        </div>
                        <div className='pl-1.5 font-bold uppercase tracking-wider text-[#33BBFF]'>
                            Équipe
                        </div>

                        <ColumnHeader
                            label='GP'
                            sortField='totalGames'
                            activeSortField={sortKey}
                            sortDirection={sortDirection}
                            onClick={handleSort}
                        />
                        <ColumnHeader
                            label='W'
                            sortField='goalieWins'
                            activeSortField={sortKey}
                            sortDirection={sortDirection}
                            onClick={handleSort}
                            color={ELECTRIC_BRIGHT}
                        />
                        <ColumnHeader
                            label='OTL'
                            sortField='goalieOvertimeLosses'
                            activeSortField={sortKey}
                            sortDirection={sortDirection}
                            onClick={handleSort}
                        />
                        <ColumnHeader
                            label='SO'
                            sortField='goalieShutouts'
                            activeSortField={sortKey}
                            sortDirection={sortDirection}
                            onClick={handleSort}
                        />
                        <ColumnHeader
                            label='3B'
                            sortField='skaterHatTricks'
                            activeSortField={sortKey}
                            sortDirection={sortDirection}
                            onClick={handleSort}
                        />
                        <ColumnHeader
                            label='PTS'
                            sortField='totalPoints'
                            activeSortField={sortKey}
                            sortDirection={sortDirection}
                            onClick={handleSort}
                            color={PTS_HIGHLIGHT}
                        />
                        <ColumnHeader
                            label='HIER'
                            sortField='yesterdayFantasyPoints'
                            activeSortField={sortKey}
                            sortDirection={sortDirection}
                            onClick={handleSort}
                        />
                        <ColumnHeader
                            label='AJD'
                            sortField='todayFantasyPoints'
                            activeSortField={sortKey}
                            sortDirection={sortDirection}
                            onClick={handleSort}
                        />
                        <ColumnHeader
                            label='FP'
                            sortField='totalFantasyPoints'
                            activeSortField={sortKey}
                            sortDirection={sortDirection}
                            onClick={handleSort}
                            color={GOLD}
                        />
                    </div>

                    {/* ---- Data rows wrapper ---- */}
                    <div
                        className='relative overflow-hidden rounded-b-lg'
                        style={{
                            borderRight: '1px solid #33BBFF',
                            borderBottom: '1px solid #33BBFF',
                            backgroundColor: '#050A16',
                        }}
                    >
                        {sortedRows.map((row) => {
                            const accent = rankAccent(row.rank);
                            const isMine =
                                myTeamId != null &&
                                row.fantasyTeamId === myTeamId;

                            return (
                                <div
                                    key={row.fantasyTeamId}
                                    className={cn(
                                        'relative grid items-center border-b px-2 py-1.5 text-[0.9rem] tabular-nums transition-colors last:border-b-0 sm:py-2 sm:text-[1.1rem]',
                                        isMine
                                            ? 'z-10'
                                            : 'hover:bg-[#0088FF]/5',
                                    )}
                                    style={{
                                        gridTemplateColumns: GRID_COLUMNS,
                                        ...(isMine
                                            ? {
                                                ...(accent.tint
                                                    ? {
                                                        backgroundImage: `${leftBarGradient(accent.accent, accent.mid, accent.core)}, linear-gradient(to right, ${accent.tint} 0%, transparent 60%)`,
                                                        borderLeft:
                                                            '6px solid transparent',
                                                        backgroundOrigin:
                                                            'border-box',
                                                        backgroundClip:
                                                            'border-box',
                                                    }
                                                    : {
                                                        backgroundColor:
                                                            'rgba(0, 136, 255, 0.12)',
                                                        borderLeft:
                                                            '3px solid #33BBFF',
                                                    }),
                                                borderTop:
                                                    '1px solid #33BBFF',
                                                borderBottom:
                                                    '1px solid #33BBFF',
                                                borderRight:
                                                    '1px solid #33BBFF',
                                                boxShadow:
                                                    '0 0 4px rgba(51, 187, 255, 0.75), inset 0 0 10px rgba(51, 187, 255, 0.45), inset 0 0 24px rgba(51, 187, 255, 0.18)',
                                            }
                                            : {
                                                backgroundImage:
                                                    accent.tint
                                                        ? `${leftBarGradient(accent.accent, accent.mid, accent.core)}, linear-gradient(to right, ${accent.tint} 0%, transparent 60%)`
                                                        : leftBarGradient(
                                                            accent.accent,
                                                            accent.mid,
                                                            accent.core,
                                                        ),
                                                borderLeft:
                                                    '6px solid transparent',
                                                backgroundOrigin:
                                                    'border-box',
                                                backgroundClip: 'border-box',
                                                borderBottomColor:
                                                    'rgba(51, 187, 255, 0.12)',
                                            }),
                                    }}
                                >
                                    <div className='flex items-center justify-center'>
                                        <RankCell
                                            rank={row.rank}
                                            isMine={isMine}
                                        />
                                    </div>

                                    <div className='flex min-w-0 items-center pl-1.5'>
                                        <Link
                                            to={`/mon-equipe?teamId=${row.fantasyTeamId}`}
                                            className={cn(
                                                'truncate transition-colors hover:text-[#33BBFF]',
                                                isMine
                                                    ? 'text-[0.9rem] font-bold text-white sm:text-[1.1rem]'
                                                    : 'text-[0.9rem] font-semibold text-foreground sm:text-[1.1rem]',
                                            )}
                                            style={
                                                accent.tint != null
                                                    ? { color: accent.accent }
                                                    : undefined
                                            }
                                        >
                                            {row.fantasyTeamName}
                                        </Link>
                                    </div>

                                    <div
                                        className={cn(
                                            'text-center',
                                            isMine
                                                ? 'text-white'
                                                : 'text-[#7DD3FC]',
                                        )}
                                    >
                                        {row.skaterGamesPlayed +
                                            row.goalieGamesPlayed}
                                    </div>

                                    <div
                                        className='text-center font-semibold'
                                        style={{ color: ELECTRIC_BRIGHT }}
                                    >
                                        {row.goalieWins}
                                    </div>

                                    <div
                                        className={cn(
                                            'text-center',
                                            isMine
                                                ? 'text-white'
                                                : 'text-[#7DD3FC]',
                                        )}
                                    >
                                        {row.goalieOvertimeLosses}
                                    </div>

                                    <div
                                        className={cn(
                                            'text-center',
                                            isMine
                                                ? 'text-white'
                                                : 'text-[#7DD3FC]',
                                        )}
                                    >
                                        {row.goalieShutouts}
                                    </div>

                                    <div
                                        className={cn(
                                            'text-center',
                                            isMine
                                                ? 'text-white'
                                                : 'text-[#7DD3FC]',
                                        )}
                                    >
                                        {row.skaterHatTricks}
                                    </div>

                                    <div
                                        className='text-center font-semibold'
                                        style={{ color: PTS_HIGHLIGHT }}
                                    >
                                        {row.skaterPoints +
                                            row.goaliePoints}
                                    </div>

                                    <div className='text-center'>
                                        {renderDailyTotal(
                                            row.yesterdayFantasyPoints,
                                        )}
                                    </div>

                                    <div className='text-center'>
                                        {renderDailyTotal(
                                            row.todayFantasyPoints,
                                        )}
                                    </div>

                                    <div className='flex items-center justify-center gap-1'>
                                        <span
                                            className='text-sm font-bold sm:text-base'
                                            style={{ color: GOLD }}
                                        >
                                            {row.totalFantasyPoints}
                                        </span>
                                        <TrendGlyph color={GOLD} />
                                    </div>
                                </div>
                            );
                        })}
                    </div>
                </div>
            )}

            {/* ============================================================
                Aujourd'hui
                ============================================================ */}
            <MyPlayersSection
                variant='today'
                refreshTick={refreshTick}
            />

            {/* ============================================================
                Hier
                ============================================================ */}
            <MyPlayersSection
                variant='yesterday'
                refreshTick={refreshTick}
            />
        </section>
    );
}