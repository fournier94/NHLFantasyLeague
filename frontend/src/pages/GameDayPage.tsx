import { useCallback, useEffect, useRef, useState } from 'react';
import {
    CalendarDays,
    ChevronDown,
    ChevronUp,
    RefreshCw,
} from 'lucide-react';
import {
    getGameBoxscore,
    getTodayGames,
    type GameDayGameSummary,
    type GameDayScheduleResponse,
    type NhlBoxscoreResponse,
    type NhlGoalieStats,
    type NhlSkaterStats,
    type NhlTeamPlayerStats,
} from '@/api/client';
import { NeonTitle } from '@/components/ui/NeonTitle';
import { NhlTeamLogo } from '@/components/nhl/NhlTeamLogo';
import { cn } from '@/lib/utils';

// ---------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------

const POLL_INTERVAL_MS = 2 * 60_000;

const TIME_FORMATTER = new Intl.DateTimeFormat('fr-CA', {
    hour: 'numeric',
    minute: '2-digit',
    timeZone: 'America/Toronto',
});

const DATE_FORMATTER = new Intl.DateTimeFormat('fr-CA', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    timeZone: 'America/Toronto',
});

// ---------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------

function isLive(game: GameDayGameSummary): boolean {
    return game.gameState === 'LIVE' || game.gameState === 'CRIT';
}

function isScheduled(game: GameDayGameSummary): boolean {
    return game.gameState === 'FUT' || game.gameState === 'PRE';
}

/**
 * A game is "finished" when its state is neither live nor scheduled.
 * The NHL API uses FINAL right after the game ends, then flips to OFF
 * once the game is fully wrapped up. Both mean the same thing to us.
 */
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

function relativeTimeLabel(iso: string | null): string {
    if (!iso) return 'jamais mis à jour';

    const date = new Date(iso);
    const seconds = Math.floor((Date.now() - date.getTime()) / 1000);

    if (seconds < 30) return "à l'instant";
    if (seconds < 60) return `il y a ${seconds}s`;

    const minutes = Math.floor(seconds / 60);
    if (minutes < 60) return `il y a ${minutes} min`;

    const hours = Math.floor(minutes / 60);
    return `il y a ${hours} h`;
}

function goalieDecisionLabel(decision: string | null): string {
    if (!decision) return '';
    if (decision === 'W') return 'V';
    if (decision === 'L') return 'D';
    if (decision === 'O') return 'DP';
    return decision;
}

// ---------------------------------------------------------------------
// Boxscore subcomponents
// ---------------------------------------------------------------------

function SkaterRow({ skater }: { skater: NhlSkaterStats }) {
    const hasPoints = skater.points > 0;
    const name = skater.name.default;

    return (
        <div className='flex items-center justify-between gap-2 py-0.5 text-xs'>
            <div className='min-w-0 flex-1 truncate text-foreground'>
                {name}
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
        </div>
    );
}

function GoalieRow({ goalie }: { goalie: NhlGoalieStats }) {
    const decision = goalieDecisionLabel(goalie.decision);
    const name = goalie.name.default;

    return (
        <div className='flex items-center justify-between gap-2 py-0.5 text-xs'>
            <div className='min-w-0 flex-1 truncate text-foreground'>
                {name}
            </div>

            <div className='flex shrink-0 gap-2 tabular-nums'>
                <span className='w-6 text-center font-bold text-[#22C55E]'>
                    {decision || '—'}
                </span>
                <span className='w-14 text-center text-muted-foreground'>
                    {goalie.saves}/{goalie.shotsAgainst}
                </span>
            </div>
        </div>
    );
}

function TeamBoxscore({
    team,
    abbreviation,
    label,
}: {
    team: NhlTeamPlayerStats;
    abbreviation: string;
    label: string;
}) {
    const skaters = [...team.forwards, ...team.defense];
    const goalies = team.goalies.filter(
        (g) =>
            g.decision != null ||
            g.shotsAgainst > 0 ||
            g.saves > 0 ||
            g.goalsAgainst > 0,
    );

    return (
        <div className='space-y-2'>
            <div className='flex items-center gap-2 border-b border-border/40 pb-1'>
                <NhlTeamLogo abbreviation={abbreviation} size={20} />
                <span className='text-sm font-semibold text-foreground'>
                    {abbreviation}
                </span>
                <span className='text-[0.65rem] uppercase tracking-wide text-muted-foreground'>
                    {label}
                </span>
            </div>

            {skaters.length > 0 && (
                <div>
                    <div className='mb-1 flex items-center justify-between gap-2 text-[0.6rem] uppercase tracking-wide text-muted-foreground'>
                        <span className='flex-1'>Joueur</span>
                        <div className='flex shrink-0 gap-2'>
                            <span className='w-6 text-center'>B</span>
                            <span className='w-6 text-center'>A</span>
                            <span className='w-8 text-center'>PTS</span>
                        </div>
                    </div>
                    {skaters.map((s) => (
                        <SkaterRow key={s.playerId} skater={s} />
                    ))}
                </div>
            )}

            {goalies.length > 0 && (
                <div>
                    <div className='mb-1 flex items-center justify-between gap-2 text-[0.6rem] uppercase tracking-wide text-muted-foreground'>
                        <span className='flex-1'>Gardien</span>
                        <div className='flex shrink-0 gap-2'>
                            <span className='w-6 text-center'>Déc.</span>
                            <span className='w-14 text-center'>Arrêts</span>
                        </div>
                    </div>
                    {goalies.map((g) => (
                        <GoalieRow key={g.playerId} goalie={g} />
                    ))}
                </div>
            )}
        </div>
    );
}

function BoxscorePanel({
    boxscore,
    loading,
}: {
    boxscore: NhlBoxscoreResponse | null;
    loading: boolean;
}) {
    if (loading) {
        return (
            <div className='border-t border-border/40 px-3 py-4 text-center text-xs text-muted-foreground'>
                Chargement du sommaire...
            </div>
        );
    }

    if (!boxscore) return null;

    return (
        <div className='max-h-[28rem] space-y-4 overflow-y-auto border-t border-border/40 px-3 py-3 md:max-h-none'>
            <TeamBoxscore
                team={boxscore.playerByGameStats.awayTeam}
                abbreviation={boxscore.awayTeam.abbrev}
                label='Visiteurs'
            />

            <TeamBoxscore
                team={boxscore.playerByGameStats.homeTeam}
                abbreviation={boxscore.homeTeam.abbrev}
                label='Locaux'
            />
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
    onToggle,
}: {
    game: GameDayGameSummary;
    expanded: boolean;
    boxscore: NhlBoxscoreResponse | null;
    boxscoreLoading: boolean;
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
                'overflow-hidden rounded-lg border border-border bg-card transition-colors',
                clickable && 'cursor-pointer hover:border-[#00A8FF]/40',
            )}
            onClick={handleClick}
        >
            <div className='flex items-center justify-between gap-2 border-b border-border/40 px-3 py-2 text-xs'>
                <div className='flex items-center gap-2'>
                    {live && (
                        <span className='relative inline-flex h-2 w-2'>
                            <span className='absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-75' />
                            <span className='relative inline-flex h-2 w-2 rounded-full bg-emerald-500' />
                        </span>
                    )}

                    <span
                        className={cn(
                            'font-bold uppercase tracking-wide',
                            live && 'text-emerald-400',
                            final && 'text-muted-foreground',
                            scheduled && 'text-muted-foreground',
                        )}
                    >
                        {live
                            ? `En direct${periodLabel(game) ? ` · ${periodLabel(game)}` : ''}`
                            : final
                                ? 'Terminé'
                                : startTimeLabel(game.startTimeUtc)}
                    </span>
                </div>

                <div className='flex items-center gap-2 text-muted-foreground'>
                    {clickable && (
                        <span className='text-[0.65rem] uppercase'>
                            {expanded ? 'Réduire' : 'Détails'}
                        </span>
                    )}
                    {clickable && (
                        expanded ? (
                            <ChevronUp className='h-4 w-4' />
                        ) : (
                            <ChevronDown className='h-4 w-4' />
                        )
                    )}
                </div>
            </div>

            <div className='space-y-2 px-3 py-2.5'>
                <div className='flex items-center justify-between gap-3'>
                    <div className='flex min-w-0 flex-1 items-center gap-2'>
                        <NhlTeamLogo
                            abbreviation={game.awayAbbreviation}
                            size={24}
                        />
                        <span
                            className={cn(
                                'truncate text-base font-bold',
                                awayWinning
                                    ? 'text-foreground'
                                    : 'text-muted-foreground',
                            )}
                        >
                            {game.awayAbbreviation}
                        </span>
                    </div>

                    <span
                        className={cn(
                            'shrink-0 text-lg font-bold tabular-nums',
                            awayWinning
                                ? 'text-foreground'
                                : 'text-muted-foreground',
                        )}
                    >
                        {scheduled ? '—' : awayScore}
                    </span>
                </div>

                <div className='flex items-center justify-between gap-3'>
                    <div className='flex min-w-0 flex-1 items-center gap-2'>
                        <NhlTeamLogo
                            abbreviation={game.homeAbbreviation}
                            size={24}
                        />
                        <span
                            className={cn(
                                'truncate text-base font-bold',
                                homeWinning
                                    ? 'text-foreground'
                                    : 'text-muted-foreground',
                            )}
                        >
                            {game.homeAbbreviation}
                        </span>
                    </div>

                    <span
                        className={cn(
                            'shrink-0 text-lg font-bold tabular-nums',
                            homeWinning
                                ? 'text-foreground'
                                : 'text-muted-foreground',
                        )}
                    >
                        {scheduled ? '—' : homeScore}
                    </span>
                </div>
            </div>

            {expanded && (
                <BoxscorePanel
                    boxscore={boxscore}
                    loading={boxscoreLoading}
                />
            )}
        </div>
    );
}

// ---------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------

export default function GameDayPage() {
    const [data, setData] = useState<GameDayScheduleResponse | null>(null);
    const [loading, setLoading] = useState(true);
    const [refreshing, setRefreshing] = useState(false);
    const [error, setError] = useState<string | null>(null);

    const [pollKey, setPollKey] = useState(0);

    const [expandedGameId, setExpandedGameId] = useState<number | null>(null);
    const [boxscore, setBoxscore] = useState<NhlBoxscoreResponse | null>(null);
    const [boxscoreLoading, setBoxscoreLoading] = useState(false);

    const isMountedRef = useRef(true);
    const boxscoreRequestIdRef = useRef(0);

    useEffect(() => {
        isMountedRef.current = true;
        return () => {
            isMountedRef.current = false;
        };
    }, []);

    const fetchGames = useCallback(
        async (force: boolean): Promise<GameDayScheduleResponse | null> => {
            if (force) setRefreshing(true);

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
                if (isMountedRef.current) {
                    setLoading(false);
                    setRefreshing(false);
                }
            }
        },
        [],
    );

    useEffect(() => {
        let cancelled = false;
        let timeoutId: number | null = null;

        const tick = async (force: boolean) => {
            const result = await fetchGames(force);
            if (cancelled) return;

            const hasLive =
                result?.games.some(isLive) ?? false;

            const needsForce =
                !result?.isFresh || (result?.games.length ?? 0) === 0;

            const shouldContinue =
                hasLive || needsForce || result === null;

            if (shouldContinue) {
                timeoutId = window.setTimeout(
                    () => tick(needsForce),
                    POLL_INTERVAL_MS,
                );
            }
        };

        void tick(true);

        return () => {
            cancelled = true;
            if (timeoutId != null) window.clearTimeout(timeoutId);
        };
    }, [pollKey, fetchGames]);

    const handleManualRefresh = () => {
        setPollKey((k) => k + 1);
    };

    const handleToggleExpand = async (gameId: number) => {
        if (expandedGameId === gameId) {
            boxscoreRequestIdRef.current += 1;
            setExpandedGameId(null);
            setBoxscore(null);
            return;
        }

        const requestId = ++boxscoreRequestIdRef.current;

        setExpandedGameId(gameId);
        setBoxscore(null);
        setBoxscoreLoading(true);

        try {
            const result = await getGameBoxscore(gameId);

            if (
                isMountedRef.current &&
                requestId === boxscoreRequestIdRef.current
            ) {
                setBoxscore(result);
            }
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

    const games = data?.games ?? [];
    const hasLiveGames = games.some(isLive);

    if (loading && !data) {
        return (
            <section className='w-full space-y-4'>
                <h2 className='text-center'>
                    <NeonTitle keepPulseOnMobile>Game Day</NeonTitle>
                </h2>
                <p className='text-center text-muted-foreground'>
                    Chargement...
                </p>
            </section>
        );
    }

    return (
        <section className='w-full space-y-4'>
            <div className='space-y-1 text-center'>
                <h2>
                    <NeonTitle keepPulseOnMobile>Game Day</NeonTitle>
                </h2>
                <p className='text-xs capitalize text-muted-foreground'>
                    {DATE_FORMATTER.format(new Date())}
                </p>
            </div>

            <div className='flex items-center justify-between gap-2 rounded-lg border border-border bg-card px-3 py-2 text-xs'>
                <div className='flex items-center gap-2'>
                    <CalendarDays className='h-4 w-4 text-muted-foreground' />

                    <span className='text-muted-foreground'>
                        {relativeTimeLabel(data?.lastRefreshUtc ?? null)}
                    </span>

                    {hasLiveGames && (
                        <span className='font-bold uppercase tracking-wide text-emerald-400'>
                            · En direct
                        </span>
                    )}
                </div>

                <button
                    type='button'
                    onClick={handleManualRefresh}
                    disabled={refreshing}
                    className='flex cursor-pointer items-center gap-1.5 rounded-md border border-border px-2 py-1 text-xs font-medium text-foreground transition-colors hover:bg-secondary disabled:cursor-not-allowed disabled:opacity-50'
                >
                    <RefreshCw
                        className={cn(
                            'h-3.5 w-3.5',
                            refreshing && 'animate-spin',
                        )}
                    />
                    <span>Actualiser</span>
                </button>
            </div>

            {error && (
                <p className='rounded-lg border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive'>
                    {error}
                </p>
            )}

            {games.length === 0 && !error && (
                <p className='rounded-lg border border-border bg-card px-3 py-6 text-center text-sm text-muted-foreground'>
                    Aucun match prévu aujourd'hui.
                </p>
            )}

            {games.length > 0 && (
                <div className='grid grid-cols-1 gap-3 md:grid-cols-2'>
                    {games.map((game) => (
                        <GameCard
                            key={game.gameId}
                            game={game}
                            expanded={expandedGameId === game.gameId}
                            boxscore={
                                expandedGameId === game.gameId
                                    ? boxscore
                                    : null
                            }
                            boxscoreLoading={
                                expandedGameId === game.gameId &&
                                boxscoreLoading
                            }
                            onToggle={handleToggleExpand}
                        />
                    ))}
                </div>
            )}
        </section>
    );
}