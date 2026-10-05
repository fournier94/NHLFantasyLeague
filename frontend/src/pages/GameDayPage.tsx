import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ChevronDown, ChevronUp } from 'lucide-react';
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
const CYAN = '#00E5FF';
const CYAN_SOFT = '#7DD3FC';
const GREEN = '#22C55E';

// ---------------------------------------------------------------------
// Helpers
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

/**
 * Sorts games by start time ascending, earliest first. Ties are
 * broken by gameId ascending so the order is stable across renders.
 */
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
                        <SkaterRow key={s.playerId} skater={s} />
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
            <div
                className='border-t px-3 py-4 text-center text-xs text-muted-foreground'
                style={{ borderColor: 'rgba(0, 168, 255, 0.2)' }}
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
        >
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
        <div className='flex items-center justify-between gap-3 px-4 py-1.5'>
            <div className='flex min-w-0 flex-1 items-center gap-2.5'>
                <NhlTeamLogo abbreviation={abbreviation} size={26} />
                <span
                    className={cn(
                        'truncate text-base font-bold tracking-wide',
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
                    'shrink-0 text-xl font-bold tabular-nums',
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
            {/* ---- Header bar: time / status / expand hint ---- */}
            <div
                className='flex items-center justify-between gap-2 border-b px-4 py-2'
                style={{
                    borderColor: 'rgba(0, 168, 255, 0.35)',
                    background: HEADER_GRADIENT,
                }}
            >
                <div className='flex items-center gap-2'>
                    {live && (
                        <span className='relative inline-flex h-2 w-2'>
                            <span className='absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-75' />
                            <span className='relative inline-flex h-2 w-2 rounded-full bg-emerald-500' />
                        </span>
                    )}

                    <span
                        className={cn(
                            'text-xs font-bold uppercase tracking-wider',
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

                <div className='flex items-center gap-2 text-muted-foreground'>
                    {clickable && (
                        <span className='text-[0.65rem] uppercase tracking-wider'>
                            {expanded ? 'Réduire' : 'Détails'}
                        </span>
                    )}
                    {clickable &&
                        (expanded ? (
                            <ChevronUp className='h-4 w-4' />
                        ) : (
                            <ChevronDown className='h-4 w-4' />
                        ))}
                </div>
            </div>

            {/* ---- Team rows ---- */}
            <div className='space-y-1 py-2'>
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
    const [error, setError] = useState<string | null>(null);

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

            const delay = hasLive ? POLL_LIVE_MS : POLL_IDLE_MS;

            timeoutId = window.setTimeout(
                () => tick(needsForce),
                delay,
            );
        };

        void tick(true);

        return () => {
            cancelled = true;
            if (timeoutId != null) window.clearTimeout(timeoutId);
        };
    }, [fetchGames]);

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

    /**
     * Today's games, sorted by start time ascending (earliest first).
     * The backend returns the whole NHL game week, so we filter it
     * on the client against the user's local calendar day. A game
     * that started late yesterday and is still LIVE or CRIT is
     * kept, so a West Coast game running past midnight ET does not
     * disappear from the page.
     */
    const games = useMemo(() => {
        const today = (data?.games ?? []).filter(
            (g) => isTodayLocal(g.startTimeUtc) || isLive(g),
        );

        return sortGamesByStartTime(today);
    }, [data?.games]);

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
            <h2 className='text-center'>
                <NeonTitle keepPulseOnMobile>Game Day</NeonTitle>
            </h2>

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