import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { ChevronDown, ChevronUp } from 'lucide-react';
import {
    getGameBoxscore,
    getGamesByDate,
    getPlayerOwnership,
    getTodayGames,
    type GameDayGameSummary,
    type GameDayScheduleResponse,
    type NhlBoxscoreResponse,
    type NhlGoalieStats,
    type NhlSkaterStats,
    type NhlTeamPlayerStats,
    type PlayerOwnership,
} from '@/api/client';
import { NhlTeamLogo } from '@/components/nhl/NhlTeamLogo';
import { useAura } from '@/lib/auraContext';
import {
    auraPulseClass,
    auraPulseStyle,
    auraRangeFor,
    isAuraOff,
} from '@/lib/auraConfig';
import { cn } from '@/lib/utils';

// ---------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------

const POLL_LIVE_MS = 2 * 60_000;
const POLL_IDLE_MS = 10 * 60_000;

const TIME_FORMATTER = new Intl.DateTimeFormat('fr-CA', {
    hour: 'numeric',
    minute: '2-digit',
    timeZone: 'America/Toronto',
});

// Shared frame style, matching the Classement page.
const FRAME_BG = '#080D1A';
const FRAME_BORDER = 'rgba(0, 168, 255, 0.6)';
const FRAME_GLOW =
    '0 0 22px rgba(0, 168, 255, 0.35), inset 0 0 18px rgba(0, 168, 255, 0.08)';
const HEADER_GRADIENT =
    'linear-gradient(180deg, rgba(0, 168, 255, 0.12), rgba(0, 168, 255, 0.02))';

// ---------------------------------------------------------------------
// Date helpers
// ---------------------------------------------------------------------

/** Formats a Date as a local ISO date (yyyy-MM-dd). */
function toIsoDate(d: Date): string {
    const yyyy = d.getFullYear();
    const mm = String(d.getMonth() + 1).padStart(2, '0');
    const dd = String(d.getDate()).padStart(2, '0');
    return `${yyyy}-${mm}-${dd}`;
}

const LONG_DATE_FORMATTER = new Intl.DateTimeFormat('fr-CA', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
});

const SHORT_DATE_FORMATTER = new Intl.DateTimeFormat('fr-CA', {
    day: 'numeric',
    month: 'short',
});

// ---------------------------------------------------------------------
// Game state helpers
// ---------------------------------------------------------------------

function isLive(game: GameDayGameSummary): boolean {
    return game.gameState === 'LIVE' || game.gameState === 'CRIT';
}

function isScheduled(game: GameDayGameSummary): boolean {
    return game.gameState === 'FUT' || game.gameState === 'PRE';
}

function isFinal(game: GameDayGameSummary): boolean {
    return !isLive(game) && !isScheduled(game);
}

function periodLabel(game: GameDayGameSummary): string {
    if (game.periodType === 'OT') return 'Prol.';
    if (game.periodType === 'SO') return 'TAB';
    if (game.periodNumber) return `${game.periodNumber}e`;
    return '';
}

function startTimeLabel(iso: string): string {
    try {
        return TIME_FORMATTER.format(new Date(iso));
    } catch {
        return '';
    }
}

/**
 * True when the given UTC instant falls on the user's local
 * calendar day (from local midnight to local midnight). This is
 * what "today" means to the user, and it matches the arena date
 * the NHL uses in ET for the vast majority of games.
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

function sortGamesByStartTime(
    games: GameDayGameSummary[],
): GameDayGameSummary[] {
    return [...games].sort((a, b) => {
        const ta = new Date(a.startTimeUtc).getTime();
        const tb = new Date(b.startTimeUtc).getTime();

        if (ta !== tb) return ta - tb;

        return a.gameId - b.gameId;
    });
}

function sortSkatersByProduction(
    skaters: NhlSkaterStats[],
): NhlSkaterStats[] {
    return [...skaters].sort((a, b) => {
        if (b.points !== a.points) return b.points - a.points;
        if (b.goals !== a.goals) return b.goals - a.goals;
        if (b.assists !== a.assists) return b.assists - a.assists;

        return a.name.default.localeCompare(b.name.default);
    });
}

/**
 * Collects every distinct NHL player id appearing in a boxscore
 * (skaters and goalies, both teams). Used to fetch the fantasy
 * team ownership for the whole boxscore in one request.
 */
function collectBoxscorePlayerIds(
    box: NhlBoxscoreResponse,
): number[] {
    const ids = new Set<number>();

    const away = box.playerByGameStats.awayTeam;
    const home = box.playerByGameStats.homeTeam;

    for (const s of [
        ...away.forwards,
        ...away.defense,
        ...home.forwards,
        ...home.defense,
    ]) {
        ids.add(s.playerId);
    }

    for (const g of [...away.goalies, ...home.goalies]) {
        ids.add(g.playerId);
    }

    return Array.from(ids);
}

function goalieDecisionLabel(decision: string | null): string {
    if (!decision) return '';
    if (decision === 'W') return 'W';
    if (decision === 'L') return 'L';
    if (decision === 'O') return 'OTL';
    return decision;
}

// ---------------------------------------------------------------------
// Boxscore subcomponents
// ---------------------------------------------------------------------

function SkaterRow({
    skater,
    ownership,
}: {
    skater: NhlSkaterStats;
    ownership: PlayerOwnership | null;
}) {
    const hasPoints = skater.points > 0;
    const name = skater.name.default;

    return (
        <Link
            to={`/joueurs/${skater.playerId}`}
            onClick={(event) => event.stopPropagation()}
            className='flex items-center justify-between gap-2 rounded px-1 py-0.5 text-xs transition-colors hover:bg-[#00A8FF]/10'
        >
            <div className='flex min-w-0 flex-1 items-center gap-1.5'>
                <span className='truncate text-foreground'>
                    {name}
                </span>
                {ownership && (
                    <span className='max-w-[6rem] shrink-0 truncate rounded border border-[#00A8FF]/40 bg-[#00A8FF]/10 px-1 text-[0.55rem] font-semibold uppercase tracking-wider text-[#7DD3FC]'>
                        {ownership.fantasyTeamName}
                    </span>
                )}
            </div>

            <div className='flex shrink-0 gap-2 tabular-nums'>
                <span className='w-6 text-center text-muted-foreground'>
                    {skater.goals}
                </span>
                <span className='w-6 text-center text-muted-foreground'>
                    {skater.assists}
                </span>
                <span
                    className={cn(
                        'w-8 text-center font-bold',
                        hasPoints ? 'text-[#00F0FF]' : 'text-muted-foreground',
                    )}
                >
                    {skater.points}
                </span>
            </div>
        </Link>
    );
}

function GoalieRow({
    goalie,
    ownership,
}: {
    goalie: NhlGoalieStats;
    ownership: PlayerOwnership | null;
}) {
    const decision = goalieDecisionLabel(goalie.decision);
    const name = goalie.name.default;

    return (
        <Link
            to={`/joueurs/${goalie.playerId}`}
            onClick={(event) => event.stopPropagation()}
            className='flex items-center justify-between gap-2 rounded px-1 py-0.5 text-xs transition-colors hover:bg-[#00A8FF]/10'
        >
            <div className='flex min-w-0 flex-1 items-center gap-1.5'>
                <span className='truncate text-foreground'>
                    {name}
                </span>
                {ownership && (
                    <span className='max-w-[6rem] shrink-0 truncate rounded border border-[#00A8FF]/40 bg-[#00A8FF]/10 px-1 text-[0.55rem] font-semibold uppercase tracking-wider text-[#7DD3FC]'>
                        {ownership.fantasyTeamName}
                    </span>
                )}
            </div>

            <div className='flex shrink-0 gap-2 tabular-nums'>
                <span className='w-6 text-center font-bold text-[#22C55E]'>
                    {decision || '—'}
                </span>
                <span className='w-14 text-center text-muted-foreground'>
                    {goalie.saves}/{goalie.shotsAgainst}
                </span>
            </div>
        </Link>
    );
}

function TeamBoxscore({
    team,
    abbreviation,
    label,
    ownershipByPlayerId,
}: {
    team: NhlTeamPlayerStats;
    abbreviation: string;
    label: string;
    ownershipByPlayerId: Map<number, PlayerOwnership>;
}) {
    const skaters = sortSkatersByProduction([
        ...team.forwards,
        ...team.defense,
    ]);

    const goalies = team.goalies.filter(
        (g) =>
            g.decision != null ||
            g.shotsAgainst > 0 ||
            g.saves > 0 ||
            g.goalsAgainst > 0,
    );

    return (
        <div className='space-y-2'>
            <div className='flex items-center gap-2 border-b border-[#00A8FF]/20 pb-1'>
                <NhlTeamLogo abbreviation={abbreviation} size={20} />
                <span className='text-sm font-semibold text-foreground'>
                    {abbreviation}
                </span>
                <span className='text-[0.65rem] uppercase tracking-wider text-[#7DD3FC]'>
                    {label}
                </span>
            </div>

            {skaters.length > 0 && (
                <div>
                    <div className='mb-1 flex items-center justify-between gap-2 text-[0.6rem] uppercase tracking-wider text-[#7DD3FC]'>
                        <span className='flex-1'>Joueur</span>
                        <div className='flex shrink-0 gap-2'>
                            <span className='w-6 text-center'>B</span>
                            <span className='w-6 text-center'>A</span>
                            <span className='w-8 text-center'>PTS</span>
                        </div>
                    </div>
                    {skaters.map((s) => (
                        <SkaterRow
                            key={s.playerId}
                            skater={s}
                            ownership={
                                ownershipByPlayerId.get(s.playerId) ?? null
                            }
                        />
                    ))}
                </div>
            )}

            {goalies.length > 0 && (
                <div>
                    <div className='mb-1 flex items-center justify-between gap-2 text-[0.6rem] uppercase tracking-wider text-[#7DD3FC]'>
                        <span className='flex-1'>Gardien</span>
                        <div className='flex shrink-0 gap-2'>
                            <span className='w-6 text-center'>Déc.</span>
                            <span className='w-14 text-center'>Arrêts</span>
                        </div>
                    </div>
                    {goalies.map((g) => (
                        <GoalieRow
                            key={g.playerId}
                            goalie={g}
                            ownership={
                                ownershipByPlayerId.get(g.playerId) ?? null
                            }
                        />
                    ))}
                </div>
            )}
        </div>
    );
}

function BoxscorePanel({
    boxscore,
    loading,
    ownershipByPlayerId,
}: {
    boxscore: NhlBoxscoreResponse | null;
    loading: boolean;
    ownershipByPlayerId: Map<number, PlayerOwnership>;
}) {
    if (loading) {
        return (
            <div
                className='border-t px-3 py-4 text-center text-xs text-muted-foreground'
                style={{ borderColor: 'rgba(0, 168, 255, 0.2)' }}
                onClick={(event) => event.stopPropagation()}
            >
                Chargement du sommaire...
            </div>
        );
    }

    if (!boxscore) return null;

    return (
        <div
            className='max-h-[28rem] space-y-4 overflow-y-auto border-t px-3 py-3 md:max-h-none'
            style={{ borderColor: 'rgba(0, 168, 255, 0.2)' }}
            onClick={(event) => event.stopPropagation()}
        >
            <TeamBoxscore
                team={boxscore.playerByGameStats.awayTeam}
                abbreviation={boxscore.awayTeam.abbrev}
                label='Visiteurs'
                ownershipByPlayerId={ownershipByPlayerId}
            />

            <TeamBoxscore
                team={boxscore.playerByGameStats.homeTeam}
                abbreviation={boxscore.homeTeam.abbrev}
                label='Locaux'
                ownershipByPlayerId={ownershipByPlayerId}
            />
        </div>
    );
}

// ---------------------------------------------------------------------
// Team row inside a game card
// ---------------------------------------------------------------------

function TeamRow({
    abbreviation,
    score,
    isWinning,
    isScheduled,
}: {
    abbreviation: string;
    score: number;
    isWinning: boolean;
    isScheduled: boolean;
}) {
    return (
        <div className='flex items-center justify-between gap-2 px-3 py-[3px]'>
            <div className='flex min-w-0 flex-1 items-center gap-2'>
                <NhlTeamLogo abbreviation={abbreviation} size={22} />
                <span
                    className={cn(
                        'truncate text-sm font-bold tracking-wide',
                        isScheduled || !isWinning
                            ? 'text-[#7DD3FC]'
                            : 'text-white',
                    )}
                    style={
                        !isScheduled && isWinning
                            ? {
                                textShadow:
                                    '0 0 8px rgba(125, 211, 252, 0.5)',
                            }
                            : undefined
                    }
                >
                    {abbreviation}
                </span>
            </div>

            <span
                className={cn(
                    'shrink-0 text-base font-bold tabular-nums',
                    isScheduled
                        ? 'text-[#00A8FF]/50'
                        : isWinning
                            ? 'text-white'
                            : 'text-[#7DD3FC]',
                )}
                style={
                    !isScheduled && isWinning
                        ? {
                            textShadow:
                                '0 0 10px rgba(125, 211, 252, 0.6)',
                        }
                        : undefined
                }
            >
                {isScheduled ? '—' : score}
            </span>
        </div>
    );
}

// ---------------------------------------------------------------------
// Game card
// ---------------------------------------------------------------------

function GameCard({
    game,
    expanded,
    boxscore,
    boxscoreLoading,
    ownershipByPlayerId,
    onToggle,
}: {
    game: GameDayGameSummary;
    expanded: boolean;
    boxscore: NhlBoxscoreResponse | null;
    boxscoreLoading: boolean;
    ownershipByPlayerId: Map<number, PlayerOwnership>;
    onToggle: (gameId: number) => void;
}) {
    const live = isLive(game);
    const final = isFinal(game);
    const scheduled = isScheduled(game);
    const clickable = game.hasBoxscore;

    const awayScore = game.awayScore ?? 0;
    const homeScore = game.homeScore ?? 0;
    const awayWinning = live || final ? awayScore > homeScore : false;
    const homeWinning = live || final ? homeScore > awayScore : false;

    const handleClick = () => {
        if (clickable) {
            onToggle(game.gameId);
        }
    };

    return (
        <div
            className={cn(
                'overflow-hidden rounded-lg border transition-shadow',
                clickable && 'cursor-pointer hover:brightness-110',
            )}
            onClick={handleClick}
            style={{
                borderColor: FRAME_BORDER,
                backgroundColor: FRAME_BG,
                boxShadow: live
                    ? '0 0 22px rgba(34, 197, 94, 0.35), inset 0 0 18px rgba(34, 197, 94, 0.08)'
                    : FRAME_GLOW,
            }}
        >
            <div
                className='flex items-center justify-between gap-2 border-b px-3 py-1'
                style={{
                    borderColor: 'rgba(0, 168, 255, 0.35)',
                    background: HEADER_GRADIENT,
                }}
            >
                <div className='flex items-center gap-2'>
                    {live && (
                        <span className='relative inline-flex h-1.5 w-1.5'>
                            <span className='absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-75' />
                            <span className='relative inline-flex h-1.5 w-1.5 rounded-full bg-emerald-500' />
                        </span>
                    )}

                    <span
                        className={cn(
                            'text-[0.65rem] font-bold uppercase tracking-wider',
                            live && 'text-emerald-400',
                            final && 'text-muted-foreground',
                            scheduled && 'text-[#00E5FF]',
                        )}
                        style={
                            scheduled
                                ? {
                                    textShadow:
                                        '0 0 8px rgba(0, 229, 255, 0.4)',
                                }
                                : live
                                    ? {
                                        textShadow:
                                            '0 0 8px rgba(34, 197, 94, 0.5)',
                                    }
                                    : undefined
                        }
                    >
                        {live
                            ? `En direct${periodLabel(game) ? ` · ${periodLabel(game)}` : ''}`
                            : final
                                ? 'Terminé'
                                : startTimeLabel(game.startTimeUtc)}
                    </span>
                </div>

                <div className='flex items-center gap-1 text-muted-foreground'>
                    {clickable && (
                        <span className='text-[0.6rem] uppercase tracking-wider'>
                            {expanded ? 'Réduire' : 'Détails'}
                        </span>
                    )}
                    {clickable &&
                        (expanded ? (
                            <ChevronUp className='h-3.5 w-3.5' />
                        ) : (
                            <ChevronDown className='h-3.5 w-3.5' />
                        ))}
                </div>
            </div>

            <div className='py-[3px]'>
                <TeamRow
                    abbreviation={game.awayAbbreviation}
                    score={awayScore}
                    isWinning={awayWinning}
                    isScheduled={scheduled}
                />
                <TeamRow
                    abbreviation={game.homeAbbreviation}
                    score={homeScore}
                    isWinning={homeWinning}
                    isScheduled={scheduled}
                />
            </div>

            {expanded && (
                <BoxscorePanel
                    boxscore={boxscore}
                    loading={boxscoreLoading}
                    ownershipByPlayerId={ownershipByPlayerId}
                />
            )}
        </div>
    );
}

// ---------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------

export default function GameDayPage() {
    const todayIso = toIsoDate(new Date());

    const [selectedDate, setSelectedDate] = useState<string>(todayIso);
    const [isDatePickerOpen, setIsDatePickerOpen] = useState(false);
    const datePickerRef = useRef<HTMLDivElement>(null);

    const [data, setData] = useState<GameDayScheduleResponse | null>(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);

    const [expandedGameId, setExpandedGameId] = useState<number | null>(null);
    const [boxscore, setBoxscore] = useState<NhlBoxscoreResponse | null>(null);
    const [boxscoreLoading, setBoxscoreLoading] = useState(false);

    /**
     * Maps each NHL player id in the currently expanded boxscore to
     * the fantasy team that owns him, if any. Populated alongside
     * the boxscore fetch; cleared when the boxscore is collapsed,
     * when the date changes, or when a different game is expanded.
     */
    const [ownershipByPlayerId, setOwnershipByPlayerId] = useState<
        Map<number, PlayerOwnership>
    >(new Map());

    const isMountedRef = useRef(true);
    const boxscoreRequestIdRef = useRef(0);

    // Same aura channel as the MonEquipePage team picker, so the
    // admin appearance slider drives both at once.
    const neonAura = useAura('teamPickerLabel');

    useEffect(() => {
        isMountedRef.current = true;
        return () => {
            isMountedRef.current = false;
        };
    }, []);

    // --- Neon label strings (mirror MonEquipePage) --------------------
    const neonRest = useMemo(
        () =>
            [
                `0 0 ${auraRangeFor(neonAura, 'teamPickerLabel', 0).toFixed(2)}px #F2F5FA`,
                `0 0 ${auraRangeFor(neonAura, 'teamPickerLabel', 1).toFixed(2)}px #00A8FF`,
                `0 0 ${auraRangeFor(neonAura, 'teamPickerLabel', 2).toFixed(2)}px rgba(0, 168, 255, 0.85)`,
                `0 0 ${auraRangeFor(neonAura, 'teamPickerLabel', 3).toFixed(2)}px rgba(0, 168, 255, 0.55)`,
            ].join(', '),
        [neonAura],
    );

    const neonPeak = useMemo(
        () =>
            [
                `0 0 ${auraRangeFor(neonAura, 'teamPickerLabel', 0).toFixed(2)}px #F2F5FA`,
                `0 0 ${auraRangeFor(neonAura, 'teamPickerLabel', 1).toFixed(2)}px #00A8FF`,
                `0 0 ${auraRangeFor(neonAura, 'teamPickerLabel', 2).toFixed(2)}px #00A8FF`,
                `0 0 ${auraRangeFor(neonAura, 'teamPickerLabel', 3).toFixed(2)}px rgba(0, 168, 255, 0.85)`,
            ].join(', '),
        [neonAura],
    );

    const neonAuraOn = !isAuraOff(neonAura);

    // --- Date options: today + previous 6 days ------------------------
    const dateOptions = useMemo(() => {
        const options: {
            iso: string;
            label: string;
            shortLabel: string;
        }[] = [];

        const now = new Date();

        for (let i = 0; i <= 6; i++) {
            const d = new Date(now);
            d.setDate(d.getDate() - i);

            const iso = toIsoDate(d);

            let label: string;
            let shortLabel: string;

            if (i === 0) {
                label = "Aujourd'hui";
                shortLabel = "Aujourd'hui";
            } else if (i === 1) {
                label = 'Hier';
                shortLabel = 'Hier';
            } else {
                label = LONG_DATE_FORMATTER.format(d);
                shortLabel = SHORT_DATE_FORMATTER.format(d);
            }

            options.push({ iso, label, shortLabel });
        }

        return options;
    }, []);

    const selectedOption =
        dateOptions.find((o) => o.iso === selectedDate) ?? dateOptions[0];

    // --- Close picker on outside click / Escape -----------------------
    useEffect(() => {
        if (!isDatePickerOpen) return;

        function onMouseDown(event: MouseEvent) {
            if (
                datePickerRef.current &&
                !datePickerRef.current.contains(event.target as Node)
            ) {
                setIsDatePickerOpen(false);
            }
        }

        function onKeyDown(event: KeyboardEvent) {
            if (event.key === 'Escape') {
                setIsDatePickerOpen(false);
            }
        }

        document.addEventListener('mousedown', onMouseDown);
        document.addEventListener('keydown', onKeyDown);

        return () => {
            document.removeEventListener('mousedown', onMouseDown);
            document.removeEventListener('keydown', onKeyDown);
        };
    }, [isDatePickerOpen]);

    // --- Reset expanded boxscore when the date changes ----------------
    useEffect(() => {
        boxscoreRequestIdRef.current += 1;
        setExpandedGameId(null);
        setBoxscore(null);
        setBoxscoreLoading(false);
        setOwnershipByPlayerId(new Map());
    }, [selectedDate]);

    // --- Fetchers -----------------------------------------------------
    const fetchTodayGames = useCallback(
        async (force: boolean): Promise<GameDayScheduleResponse | null> => {
            try {
                const result = await getTodayGames(force);
                if (!isMountedRef.current) return null;
                setData(result);
                setError(null);
                return result;
            } catch {
                if (!isMountedRef.current) return null;
                setError(
                    'Impossible de charger les matchs du jour. ' +
                    'Vérifiez la connexion au serveur API.',
                );
                return null;
            } finally {
                if (isMountedRef.current) setLoading(false);
            }
        },
        [],
    );

    const fetchGamesForDate = useCallback(
        async (
            date: string,
        ): Promise<GameDayScheduleResponse | null> => {
            try {
                const result = await getGamesByDate(date);
                if (!isMountedRef.current) return null;
                setData(result);
                setError(null);
                return result;
            } catch {
                if (!isMountedRef.current) return null;
                setError(
                    'Impossible de charger les matchs de cette date.',
                );
                return null;
            } finally {
                if (isMountedRef.current) setLoading(false);
            }
        },
        [],
    );

    // --- Fetch effect -------------------------------------------------
    useEffect(() => {
        let cancelled = false;
        let timeoutId: number | null = null;

        const isToday = selectedDate === todayIso;

        const tick = async (force: boolean) => {
            if (cancelled) return;

            if (isToday) {
                const result = await fetchTodayGames(force);
                if (cancelled) return;

                const hasLive = result?.games.some(isLive) ?? false;
                const needsForce =
                    !result?.isFresh ||
                    (result?.games.length ?? 0) === 0;

                // If the cached snapshot we just received is stale
                // AND we did not already force, fire a background
                // refresh right now. The page has already rendered
                // with the cached data; the fresh payload updates
                // state silently when it arrives. This avoids
                // waiting the full 2-10 min poll interval before
                // the user sees up-to-date scores.
                if (needsForce && !force) {
                    void fetchTodayGames(true).catch(() => {
                        // Non-fatal: the next scheduled tick retries.
                    });
                }

                const delay = hasLive ? POLL_LIVE_MS : POLL_IDLE_MS;

                timeoutId = window.setTimeout(
                    () => tick(needsForce),
                    delay,
                );
            } else {
                // Past dates are static — fetch once, no polling.
                setLoading(true);
                await fetchGamesForDate(selectedDate);
            }
        };

        // First pass on mount: DO NOT force a synchronous NHL
        // refresh. Serve whatever the backend already has in its
        // in-memory cache. During a live slate the backend keeps
        // that cache warm on its own 60 s loop, so this returns in
        // ~50 ms instead of ~2 s. If the snapshot turns out to be
        // stale, the block above fires a background refresh that
        // lands a moment later without blocking the initial paint.
        void tick(false);

        return () => {
            cancelled = true;
            if (timeoutId != null) window.clearTimeout(timeoutId);
        };
    }, [
        selectedDate,
        todayIso,
        fetchTodayGames,
        fetchGamesForDate,
    ]);

    // --- Boxscore expand handler --------------------------------------
    const handleToggleExpand = async (gameId: number) => {
        if (expandedGameId === gameId) {
            boxscoreRequestIdRef.current += 1;
            setExpandedGameId(null);
            setBoxscore(null);
            setOwnershipByPlayerId(new Map());
            return;
        }

        const requestId = ++boxscoreRequestIdRef.current;

        setExpandedGameId(gameId);
        setBoxscore(null);
        setOwnershipByPlayerId(new Map());
        setBoxscoreLoading(true);

        try {
            const result = await getGameBoxscore(gameId);

            if (
                !isMountedRef.current ||
                requestId !== boxscoreRequestIdRef.current
            ) {
                return;
            }

            setBoxscore(result);

            // Fetch the fantasy team ownership for every player in
            // this boxscore. One batch call, not one per player.
            const playerIds = collectBoxscorePlayerIds(result);

            const ownershipRows =
                await getPlayerOwnership(playerIds);

            if (
                !isMountedRef.current ||
                requestId !== boxscoreRequestIdRef.current
            ) {
                return;
            }

            const map = new Map<number, PlayerOwnership>();
            for (const row of ownershipRows) {
                map.set(row.nhlPlayerId, row);
            }
            setOwnershipByPlayerId(map);
        } catch {
            // Non-fatal: the panel shows nothing.
        } finally {
            if (
                isMountedRef.current &&
                requestId === boxscoreRequestIdRef.current
            ) {
                setBoxscoreLoading(false);
            }
        }
    };

    // --- Games list ---------------------------------------------------
    //
    // The /Games/today endpoint returns the whole NHL game week
    // (Saturday through Friday), so when today is selected we must
    // filter to the user's local calendar day. The /Games/by-date
    // endpoint already returns a single day, so past dates skip the
    // filter. A game that started late yesterday and is still LIVE
    // is kept on today's view so a West Coast game running past
    // midnight ET does not disappear.
    const games = useMemo(() => {
        const raw = data?.games ?? [];

        const filtered =
            selectedDate === todayIso
                ? raw.filter(
                    (g) => isTodayLocal(g.startTimeUtc) || isLive(g),
                )
                : raw;

        return sortGamesByStartTime(filtered);
    }, [data?.games, selectedDate, todayIso]);

    if (loading && !data) {
        return (
            <section className='w-full space-y-4'>
                <div className='flex justify-center'>
                    <p className='text-muted-foreground'>Chargement...</p>
                </div>
            </section>
        );
    }

    return (
        <section className='w-full space-y-4'>
            {/* ---- Date picker (mimics MonEquipePage team picker) ---- */}
            <div className='flex flex-col items-center gap-2'>
                <div
                    ref={datePickerRef}
                    className='relative w-full'
                >
                    <button
                        type='button'
                        aria-haspopup='listbox'
                        aria-expanded={isDatePickerOpen}
                        aria-label='Choisir une date'
                        onClick={() =>
                            setIsDatePickerOpen((v) => !v)
                        }
                        className='relative z-[60] mx-auto flex cursor-pointer items-center justify-center px-3 py-0.5 focus:outline-none focus-visible:outline-none'
                    >
                        <span className='relative inline-block'>
                            <span
                                className={`text-2xl leading-none tracking-[0.02em] capitalize ${neonAuraOn
                                        ? `${auraPulseClass('text')} aura-mobile-keep`
                                        : ''
                                    }`}
                                style={{
                                    fontFamily:
                                        "'Grindy Brush', sans-serif",
                                    fontWeight: 400,
                                    color: '#FFFFFF',
                                    WebkitTextStrokeWidth: '3.5px',
                                    WebkitTextStrokeColor: '#AF1E2D',
                                    paintOrder: 'stroke fill',
                                    ...(neonAuraOn
                                        ? auraPulseStyle(
                                            neonRest,
                                            neonPeak,
                                        )
                                        : {}),
                                } as React.CSSProperties}
                            >
                                {selectedOption.shortLabel}
                            </span>

                            <span
                                aria-hidden='true'
                                className={`pointer-events-none absolute left-full top-1/2 ml-2 inline-block text-sm leading-none transition-transform duration-200 ${neonAuraOn
                                        ? `${auraPulseClass('text')} aura-mobile-keep`
                                        : ''
                                    }`}
                                style={{
                                    transform: isDatePickerOpen
                                        ? 'translateY(-50%) rotate(180deg)'
                                        : 'translateY(-50%) rotate(0deg)',
                                    color: '#FFFFFF',
                                    WebkitTextStrokeWidth: '1px',
                                    WebkitTextStrokeColor: '#AF1E2D',
                                    paintOrder: 'stroke fill',
                                    ...(neonAuraOn
                                        ? auraPulseStyle(
                                            neonRest,
                                            neonPeak,
                                        )
                                        : {}),
                                } as React.CSSProperties}
                            >
                                ▼
                            </span>
                        </span>
                    </button>

                    {isDatePickerOpen && (
                        <ul
                            role='listbox'
                            className='absolute left-0 right-0 z-50 mt-1 max-h-72 overflow-y-auto rounded-lg border border-[#00E5FF]/50 bg-[#0F1626] shadow-[0_0_20px_rgba(0,229,255,0.35),0_8px_24px_rgba(0,0,0,0.6)] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden'
                        >
                            {dateOptions.map((opt) => {
                                const isSelected =
                                    opt.iso === selectedDate;

                                return (
                                    <li key={opt.iso}>
                                        <button
                                            type='button'
                                            role='option'
                                            aria-selected={isSelected}
                                            onClick={() => {
                                                setSelectedDate(opt.iso);
                                                setIsDatePickerOpen(false);
                                            }}
                                            className={`w-full cursor-pointer px-4 py-2.5 text-center text-lg font-semibold capitalize transition-colors ${isSelected
                                                    ? 'bg-[#00E5FF]/20 text-[#00E5FF]'
                                                    : 'text-foreground hover:bg-[#00E5FF]/10 hover:text-[#00E5FF]'
                                                }`}
                                        >
                                            {opt.label}
                                        </button>
                                    </li>
                                );
                            })}
                        </ul>
                    )}
                </div>
            </div>

            {error && (
                <p className='rounded-lg border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive'>
                    {error}
                </p>
            )}

            {games.length === 0 && !error && (
                <p className='rounded-lg border border-border bg-card px-3 py-6 text-center text-sm text-muted-foreground'>
                    {selectedDate === todayIso
                        ? "Aucun match prévu aujourd'hui."
                        : 'Aucun match prévu à cette date.'}
                </p>
            )}

            {games.length > 0 && (
                <div className='grid grid-cols-1 gap-2 md:grid-cols-2'>
                    {games.map((game) => (
                        <GameCard
                            key={game.gameId}
                            game={game}
                            expanded={
                                expandedGameId === game.gameId
                            }
                            boxscore={
                                expandedGameId === game.gameId
                                    ? boxscore
                                    : null
                            }
                            boxscoreLoading={
                                expandedGameId === game.gameId &&
                                boxscoreLoading
                            }
                            ownershipByPlayerId={
                                expandedGameId === game.gameId
                                    ? ownershipByPlayerId
                                    : new Map()
                            }
                            onToggle={handleToggleExpand}
                        />
                    ))}
                </div>
            )}
        </section>
    );
}