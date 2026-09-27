import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import {
    getPlayerDetail,
    type CareerRow,
    type GameLogRow,
    type PlayerDetail,
    type Quarter,
} from '@/api/client';
import { cn } from '@/lib/utils';

// ---------------------------------------------------------------------
// Formatters
// ---------------------------------------------------------------------

const salaryFormatter = new Intl.NumberFormat('fr-CA', {
    maximumFractionDigits: 0,
});

const dateFormatter = new Intl.DateTimeFormat('fr-CA', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
});

const shortDateFormatter = new Intl.DateTimeFormat('fr-CA', {
    day: 'numeric',
    month: 'short',
});

function compactMillions(value: number): string {
    const millions = value / 1_000_000;
    const rounded = millions.toFixed(2).replace(/\.?0+$/, '');
    return `${rounded}M`;
}

function shortDate(value: string | null): string {
    if (!value) return '—';
    return dateFormatter.format(new Date(value));
}

function shortGameDate(value: string): string {
    return shortDateFormatter.format(new Date(value));
}

function teamDisplay(row: CareerRow): string {
    if (row.teamName && row.teamName.trim().length > 0) {
        return row.teamName;
    }
    return '—';
}

function formatDecimal(value: number, digits = 2): string {
    return value.toFixed(digits);
}

// ---------------------------------------------------------------------
// Table primitives (dark theme, matching MonÉquipe)
// ---------------------------------------------------------------------

const thBase = 'px-2 py-1.5 font-medium whitespace-nowrap';
const thLeft = `${thBase} text-left`;
const thRight = `${thBase} text-right`;
const tdBase = 'px-2 py-1 whitespace-nowrap';
const tdLeft = `${tdBase} text-left`;
const tdRight = `${tdBase} text-right`;

function TableShell({ children }: { children: React.ReactNode }) {
    // overflow-x-auto lets the table scroll horizontally on narrow
    // screens instead of squashing or wrapping.
    return (
        <div className='w-full overflow-x-auto rounded-lg border border-border bg-card'>
            {children}
        </div>
    );
}

function TableHead({ children }: { children: React.ReactNode }) {
    return (
        <thead className='border-b border-border text-[0.65rem] uppercase tracking-wide text-muted-foreground'>
            {children}
        </thead>
    );
}

function rowClass(index: number): string {
    return cn(
        'border-b border-border/40 last:border-b-0',
        index % 2 === 0 ? 'bg-transparent' : 'bg-secondary/20',
    );
}

// ---------------------------------------------------------------------
// Small components
// ---------------------------------------------------------------------

function SectionTitle({ children }: { children: React.ReactNode }) {
    return (
        <h2 className='mt-6 mb-2 text-lg font-semibold text-foreground md:text-xl'>
            {children}
        </h2>
    );
}

function SubSectionTitle({ children }: { children: React.ReactNode }) {
    return (
        <h3 className='mb-1 text-sm font-medium text-muted-foreground'>
            {children}
        </h3>
    );
}

function SkaterCareerTable({ rows }: { rows: CareerRow[] }) {
    if (rows.length === 0) {
        return (
            <TableShell>
                <div className='p-3 text-sm text-muted-foreground'>
                    Aucune donnée.
                </div>
            </TableShell>
        );
    }

    return (
        <TableShell>
            <table className='w-full min-w-[640px] text-xs tabular-nums'>
                <TableHead>
                    <tr>
                        <th className={thLeft}>Season</th>
                        <th className={thLeft}>Team</th>
                        <th className={thLeft}>Lge</th>
                        <th className={thRight}>GP</th>
                        <th className={thRight}>G</th>
                        <th className={thRight}>A</th>
                        <th className={thRight}>Pts</th>
                        <th className={thRight}>PIM</th>
                        <th className={thRight}>+/-</th>
                        <th className={thRight}>PPP</th>
                        <th className={thRight}>SOG</th>
                        <th className={thRight}>GWG</th>
                        <th className={thRight}>ATOI</th>
                    </tr>
                </TableHead>
                <tbody className='text-foreground'>
                    {rows.map((row, index) => (
                        <tr
                            key={`${row.season}-${row.leagueAbbreviation}-${row.teamName}-${index}`}
                            className={rowClass(index)}
                        >
                            <td className={tdLeft}>{row.seasonLabel}</td>
                            <td className={tdLeft}>{teamDisplay(row)}</td>
                            <td className={tdLeft}>{row.leagueAbbreviation}</td>
                            <td className={tdRight}>{row.gamesPlayed}</td>
                            <td className={tdRight}>{row.goals}</td>
                            <td className={tdRight}>{row.assists}</td>
                            <td className={tdRight}>{row.points}</td>
                            <td className={tdRight}>{row.penaltyMinutes}</td>
                            <td className={tdRight}>
                                {row.plusMinus > 0 ? `+${row.plusMinus}` : row.plusMinus}
                            </td>
                            <td className={tdRight}>{row.powerPlayPoints}</td>
                            <td className={tdRight}>{row.shots}</td>
                            <td className={tdRight}>{row.gameWinningGoals}</td>
                            <td className={tdRight}>{row.averageTimeOnIce ?? '—'}</td>
                        </tr>
                    ))}
                </tbody>
            </table>
        </TableShell>
    );
}

function GoalieCareerTable({ rows }: { rows: CareerRow[] }) {
    if (rows.length === 0) {
        return (
            <TableShell>
                <div className='p-3 text-sm text-muted-foreground'>
                    Aucune donnée.
                </div>
            </TableShell>
        );
    }

    return (
        <TableShell>
            <table className='w-full min-w-[600px] text-xs tabular-nums'>
                <TableHead>
                    <tr>
                        <th className={thLeft}>Season</th>
                        <th className={thLeft}>Team</th>
                        <th className={thLeft}>Lge</th>
                        <th className={thRight}>GP</th>
                        <th className={thRight}>W</th>
                        <th className={thRight}>L</th>
                        <th className={thRight}>OTL</th>
                        <th className={thRight}>SO</th>
                        <th className={thRight}>SV%</th>
                        <th className={thRight}>GAA</th>
                        <th className={thRight}>SV</th>
                        <th className={thRight}>SA</th>
                    </tr>
                </TableHead>
                <tbody className='text-foreground'>
                    {rows.map((row, index) => (
                        <tr
                            key={`${row.season}-${row.leagueAbbreviation}-${row.teamName}-${index}`}
                            className={rowClass(index)}
                        >
                            <td className={tdLeft}>{row.seasonLabel}</td>
                            <td className={tdLeft}>{teamDisplay(row)}</td>
                            <td className={tdLeft}>{row.leagueAbbreviation}</td>
                            <td className={tdRight}>{row.gamesPlayed}</td>
                            <td className={tdRight}>{row.wins}</td>
                            <td className={tdRight}>{row.losses}</td>
                            <td className={tdRight}>{row.overtimeLosses}</td>
                            <td className={tdRight}>{row.shutouts}</td>
                            <td className={tdRight}>
                                {formatDecimal(row.savePercentage, 3)}
                            </td>
                            <td className={tdRight}>
                                {formatDecimal(row.goalsAgainstAverage, 2)}
                            </td>
                            <td className={tdRight}>{row.saves}</td>
                            <td className={tdRight}>{row.shotsAgainst}</td>
                        </tr>
                    ))}
                </tbody>
            </table>
        </TableShell>
    );
}

function GameLogTable({
    rows,
    isGoalie,
}: {
    rows: GameLogRow[];
    isGoalie: boolean;
}) {
    if (rows.length === 0) {
        return (
            <TableShell>
                <div className='p-3 text-sm text-muted-foreground'>
                    Aucune partie récente.
                </div>
            </TableShell>
        );
    }

    return (
        <TableShell>
            <table className='w-full min-w-[560px] text-xs tabular-nums'>
                <TableHead>
                    <tr>
                        <th className={thLeft}>Date</th>
                        <th className={thLeft}>Opp</th>
                        <th className={thLeft}>Loc</th>
                        {isGoalie ? (
                            <>
                                <th className={thRight}>Déc.</th>
                                <th className={thRight}>BA</th>
                                <th className={thRight}>AR</th>
                                <th className={thRight}>FP</th>
                            </>
                        ) : (
                            <>
                                <th className={thRight}>B</th>
                                <th className={thRight}>A</th>
                                <th className={thRight}>Pts</th>
                                <th className={thRight}>PIM</th>
                                <th className={thRight}>+/-</th>
                                <th className={thRight}>SOG</th>
                                <th className={thRight}>FP</th>
                            </>
                        )}
                    </tr>
                </TableHead>
                <tbody className='text-foreground'>
                    {rows.map((game, index) => {
                        const result = isGoalie
                            ? game.goalieWin
                                ? 'W'
                                : game.goalieOvertimeLoss
                                    ? 'OTL'
                                    : 'L'
                            : null;

                        return (
                            <tr key={game.nhlGameId} className={rowClass(index)}>
                                <td className={tdLeft}>
                                    {shortGameDate(game.gameDate)}
                                </td>
                                <td className={tdLeft}>
                                    {game.opponentAbbreviation}
                                </td>
                                <td className={tdLeft}>
                                    {game.isHomeGame ? 'H' : 'R'}
                                </td>
                                {isGoalie ? (
                                    <>
                                        <td className={tdRight}>
                                            {result}
                                            {game.shutout ? ' (SO)' : ''}
                                        </td>
                                        <td className={tdRight}>
                                            {game.goalsAgainst}
                                        </td>
                                        <td className={tdRight}>{game.saves}</td>
                                        <td className={tdRight}>
                                            {game.fantasyPoints}
                                        </td>
                                    </>
                                ) : (
                                    <>
                                        <td className={tdRight}>{game.goals}</td>
                                        <td className={tdRight}>{game.assists}</td>
                                        <td className={tdRight}>{game.points}</td>
                                        <td className={tdRight}>
                                            {game.penaltyMinutes}
                                        </td>
                                        <td className={tdRight}>
                                            {game.plusMinus > 0
                                                ? `+${game.plusMinus}`
                                                : game.plusMinus}
                                        </td>
                                        <td className={tdRight}>{game.shots}</td>
                                        <td className={tdRight}>
                                            {game.fantasyPoints}
                                        </td>
                                    </>
                                )}
                            </tr>
                        );
                    })}
                </tbody>
            </table>
        </TableShell>
    );
}

function QuarterTable({
    quarters,
    isGoalie,
}: {
    quarters: Quarter[];
    isGoalie: boolean;
}) {
    // Always four rows; quarters with no games show dashes.
    const rows = quarters.length === 4 ? quarters : [];

    if (rows.length === 0) {
        return null;
    }

    // Every cell goes through this. It returns the number when there
    // are games, a dash otherwise, so the return type is `number | "—"`
    // and every call site passes the same union.
    const cell = (value: number, hasGames: boolean): number | '—' =>
        hasGames ? value : '—';

    return (
        <TableShell>
            <table className='w-full min-w-[480px] text-xs tabular-nums'>
                <TableHead>
                    <tr>
                        <th className={thLeft}>Quart</th>
                        <th className={thLeft}>Dates</th>
                        {isGoalie ? (
                            <>
                                <th className={thRight}>GP</th>
                                <th className={thRight}>W</th>
                                <th className={thRight}>L</th>
                                <th className={thRight}>OTL</th>
                                <th className={thRight}>SO</th>
                                <th className={thRight}>AR</th>
                                <th className={thRight}>FP</th>
                            </>
                        ) : (
                            <>
                                <th className={thRight}>GP</th>
                                <th className={thRight}>B</th>
                                <th className={thRight}>A</th>
                                <th className={thRight}>Pts</th>
                                <th className={thRight}>PIM</th>
                                <th className={thRight}>+/-</th>
                                <th className={thRight}>SOG</th>
                                <th className={thRight}>FP</th>
                            </>
                        )}
                    </tr>
                </TableHead>
                <tbody className='text-foreground'>
                    {rows.map((q, index) => {
                        const hasGames = q.gamesPlayed > 0;

                        const dates =
                            q.startDate && q.endDate
                                ? `${shortGameDate(q.startDate)} – ${shortGameDate(q.endDate)}`
                                : '—';

                        return (
                            <tr key={q.label} className={rowClass(index)}>
                                <td className={tdLeft}>{q.label}</td>
                                <td className={`${tdLeft} text-muted-foreground`}>
                                    {dates}
                                </td>
                                {isGoalie ? (
                                    <>
                                        <td className={tdRight}>
                                            {cell(q.gamesPlayed, hasGames)}
                                        </td>
                                        <td className={tdRight}>
                                            {cell(q.wins, hasGames)}
                                        </td>
                                        <td className={tdRight}>
                                            {cell(q.losses, hasGames)}
                                        </td>
                                        <td className={tdRight}>
                                            {cell(q.overtimeLosses, hasGames)}
                                        </td>
                                        <td className={tdRight}>
                                            {cell(q.shutouts, hasGames)}
                                        </td>
                                        <td className={tdRight}>
                                            {cell(q.saves, hasGames)}
                                        </td>
                                        <td className={tdRight}>
                                            {cell(q.fantasyPoints, hasGames)}
                                        </td>
                                    </>
                                ) : (
                                    <>
                                        <td className={tdRight}>
                                            {cell(q.gamesPlayed, hasGames)}
                                        </td>
                                        <td className={tdRight}>
                                            {cell(q.goals, hasGames)}
                                        </td>
                                        <td className={tdRight}>
                                            {cell(q.assists, hasGames)}
                                        </td>
                                        <td className={tdRight}>
                                            {cell(q.points, hasGames)}
                                        </td>
                                        <td className={tdRight}>
                                            {cell(q.penaltyMinutes, hasGames)}
                                        </td>
                                        <td className={tdRight}>
                                            {hasGames
                                                ? q.plusMinus > 0
                                                    ? `+${q.plusMinus}`
                                                    : q.plusMinus
                                                : '—'}
                                        </td>
                                        <td className={tdRight}>
                                            {cell(q.shots, hasGames)}
                                        </td>
                                        <td className={tdRight}>
                                            {cell(q.fantasyPoints, hasGames)}
                                        </td>
                                    </>
                                )}
                            </tr>
                        );
                    })}
                </tbody>
            </table>
        </TableShell>
    );
}

// ---------------------------------------------------------------------
// The page
// ---------------------------------------------------------------------

export default function PlayerPage() {
    const navigate = useNavigate();
    const { nhlPlayerId } = useParams<{ nhlPlayerId: string }>();

    const [player, setPlayer] = useState<PlayerDetail | null>(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [showYouthMinor, setShowYouthMinor] = useState(false);
    const [showGameLog, setShowGameLog] = useState(false);

    useEffect(() => {
        if (!nhlPlayerId) {
            setError('Identifiant de joueur manquant.');
            setLoading(false);
            return;
        }

        let cancelled = false;

        getPlayerDetail(Number(nhlPlayerId))
            .then((data) => {
                if (!cancelled) {
                    setPlayer(data);
                }
            })
            .catch((err) => {
                if (!cancelled) {
                    setError(
                        err instanceof Error
                            ? err.message
                            : 'Impossible de charger ce joueur.',
                    );
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
    }, [nhlPlayerId]);

    // Close button: go back to wherever the user came from. If there is
    // no history (e.g. the page was opened directly), fall back to
    // /joueurs so we never leave the user stuck.
    function handleClose() {
        if (window.history.length > 1) {
            navigate(-1);
        } else {
            navigate('/joueurs');
        }
    }

    if (loading) {
        return <p className='text-muted-foreground'>Chargement...</p>;
    }

    if (error || !player) {
        return (
            <div className='space-y-3'>
                <p className='text-destructive'>
                    {error ?? 'Joueur introuvable.'}
                </p>
                <button
                    type='button'
                    onClick={handleClose}
                    className='cursor-pointer rounded-md border border-border px-3 py-1.5 text-sm text-foreground transition-colors hover:bg-secondary'
                >
                    Fermer
                </button>
            </div>
        );
    }

    const isGoalie = player.position === 'G';

    const shootsDisplay =
        player.shootsCatches === 'L'
            ? 'shoots L'
            : player.shootsCatches === 'R'
                ? 'shoots R'
                : null;

    const positionLine = [player.position || null, shootsDisplay]
        .filter((v): v is string => Boolean(v))
        .join(' -- ');

    const heightLine =
        player.heightInInches != null && player.heightInCentimeters != null
            ? `${Math.floor(player.heightInInches / 12)}.${player.heightInInches % 12} -- ${player.heightInCentimeters} cm`
            : null;

    const weightLine =
        player.weightInPounds != null && player.weightInKilograms != null
            ? `${player.weightInPounds} -- ${player.weightInKilograms} kg`
            : null;

    const fullHeightWeight = [heightLine, weightLine]
        .filter((v): v is string => Boolean(v))
        .join(' / ');

    const birthLine = [
        player.birthDate ? shortDate(player.birthDate) : null,
        player.birthCity,
        player.birthCountry,
    ]
        .filter((v): v is string => Boolean(v))
        .join(' -- ');

    const draftLine =
        player.draftYear && player.draftOverallPick
            ? `round ${player.draftRound} #${player.draftOverallPick} overall ${player.draftYear} NHL Entry Draft`
            : null;

    const hasNhlTotals =
        player.nhlTotals.gamesPlayed > 0 ||
        player.nhlTotals.playoffGamesPlayed > 0;

    return (
        <section className='mx-auto w-full max-w-5xl space-y-4'>
            {/* Top bar: Close button only. Back link removed on purpose. */}
            <div className='flex items-center justify-between gap-2'>
                <button
                    type='button'
                    onClick={handleClose}
                    className='cursor-pointer rounded-md border border-border px-3 py-1.5 text-sm text-foreground transition-colors hover:bg-secondary'
                >
                    ✕ Fermer
                </button>
            </div>

            {/* Hero banner (only when the API returned one) */}
            {player.heroImageUrl && (
                <div className='-mx-3 -mt-3 mb-2 h-40 overflow-hidden rounded-b-lg border-b border-border bg-black sm:-mx-4 sm:-mt-4 md:-mx-6 md:-mt-6'>
                    <img
                        src={player.heroImageUrl}
                        alt=''
                        className='h-full w-full object-cover opacity-80'
                        loading='lazy'
                    />
                </div>
            )}

            {/* Identity + headshot.
                Stacks vertically on phones, side-by-side from sm up. */}
            <div className='flex flex-col items-start gap-4 sm:flex-row sm:items-start sm:justify-between'>
                <div className='w-full min-w-0 sm:flex-1'>
                    <div className='flex flex-wrap items-center gap-x-3 gap-y-1'>
                        <h1 className='text-2xl font-bold text-foreground'>
                            {player.firstName} {player.lastName}
                        </h1>

                        {player.nhlTeamLogoUrl && (
                            <img
                                src={player.nhlTeamLogoUrl}
                                alt={player.nhlTeamAbbreviation ?? ''}
                                className='h-6 w-6'
                            />
                        )}

                        <span className='rounded border border-border px-2 py-0.5 text-xs uppercase tracking-wide text-muted-foreground'>
                            {player.status}
                        </span>
                    </div>

                    {positionLine && (
                        <p className='mt-1 text-sm text-foreground'>
                            {positionLine}
                        </p>
                    )}

                    {birthLine && (
                        <p className='text-sm text-foreground'>{birthLine}</p>
                    )}

                    {player.age != null && (
                        <p className='text-sm text-foreground'>
                            [{player.age} ans]
                        </p>
                    )}

                    {fullHeightWeight && (
                        <p className='text-sm text-foreground'>
                            Height {fullHeightWeight}
                        </p>
                    )}

                    {draftLine && (
                        <p className='mt-2 text-sm text-foreground'>
                            Drafted by{' '}
                            <span className='font-semibold text-primary'>
                                {player.draftTeamAbbreviation}
                            </span>
                            <br />- {draftLine}
                        </p>
                    )}

                    {player.previousNhlTeamName && (
                        <p className='mt-1 text-xs text-muted-foreground'>
                            Ancienne équipe : {player.previousNhlTeamName}{' '}
                            ({player.previousNhlTeamAbbreviation})
                        </p>
                    )}
                </div>

                {player.headshotUrl && (
                    <img
                        src={player.headshotUrl}
                        alt={`${player.firstName} ${player.lastName}`}
                        className='h-24 w-24 shrink-0 rounded-md bg-white object-cover sm:h-32 sm:w-32'
                        loading='lazy'
                    />
                )}
            </div>

            {/* Current injury panel */}
            {player.isInjured && (
                <div className='rounded-lg border border-destructive/40 bg-destructive/10 p-3 text-sm'>
                    <p className='font-semibold text-destructive'>
                        {player.injuryKind === 'Suspension'
                            ? 'Suspension'
                            : 'Blessé'}{' '}
                        — {player.injuryStatus ?? 'Statut inconnu'}
                    </p>

                    {player.injuryShortDescription && (
                        <p className='mt-1 text-foreground'>
                            {player.injuryShortDescription}
                        </p>
                    )}

                    {player.injuryLongDescription && (
                        <p className='mt-1 text-muted-foreground'>
                            {player.injuryLongDescription}
                        </p>
                    )}

                    <p className='mt-1 text-xs text-muted-foreground'>
                        Dernière mise à jour : {shortDate(player.injuryUpdatedAt)}
                    </p>
                </div>
            )}

            {/* Quarter-by-quarter stats for the current season */}
            {player.seasonQuarters.length === 4 && (
                <>
                    <SectionTitle>Par quart (saison courante)</SectionTitle>
                    <QuarterTable
                        quarters={player.seasonQuarters}
                        isGoalie={isGoalie}
                    />
                </>
            )}

            {/* Career */}
            <SectionTitle>Career</SectionTitle>

            <div className='grid grid-cols-1 gap-4 md:grid-cols-2'>
                <div>
                    <SubSectionTitle>Regular Season</SubSectionTitle>
                    {isGoalie ? (
                        <GoalieCareerTable rows={player.regularSeason} />
                    ) : (
                        <SkaterCareerTable rows={player.regularSeason} />
                    )}
                </div>

                <div>
                    <SubSectionTitle>Playoffs</SubSectionTitle>
                    {isGoalie ? (
                        <GoalieCareerTable rows={player.playoffs} />
                    ) : (
                        <SkaterCareerTable rows={player.playoffs} />
                    )}
                </div>
            </div>

            {hasNhlTotals && (
                <div className='mt-2'>
                    <SubSectionTitle>NHL Totals</SubSectionTitle>

                    {isGoalie ? (
                        <TableShell>
                            <table className='w-full min-w-[640px] text-xs tabular-nums'>
                                <TableHead>
                                    <tr>
                                        <th className={thLeft}>&nbsp;</th>
                                        <th className={thRight}>GP</th>
                                        <th className={thRight}>W</th>
                                        <th className={thRight}>L</th>
                                        <th className={thRight}>OTL</th>
                                        <th className={thRight}>SO</th>
                                        <th className={thRight}>SV%</th>
                                        <th className={thRight}>SV</th>
                                        <th className={thRight}>SA</th>
                                        <th className={thRight}>GA</th>
                                    </tr>
                                </TableHead>
                                <tbody className='text-foreground'>
                                    <tr className={rowClass(0)}>
                                        <td className={`${tdLeft} font-semibold`}>
                                            Regular Season
                                        </td>
                                        <td className={`${tdRight} font-semibold`}>
                                            {player.nhlTotals.gamesPlayed}
                                        </td>
                                        <td className={`${tdRight} font-semibold`}>
                                            {player.nhlTotals.wins}
                                        </td>
                                        <td className={`${tdRight} font-semibold`}>
                                            {player.nhlTotals.losses}
                                        </td>
                                        <td className={`${tdRight} font-semibold`}>
                                            {player.nhlTotals.overtimeLosses}
                                        </td>
                                        <td className={`${tdRight} font-semibold`}>
                                            {player.nhlTotals.shutouts}
                                        </td>
                                        <td className={`${tdRight} font-semibold`}>
                                            {player.nhlTotals.shotsAgainst > 0
                                                ? formatDecimal(
                                                    player.nhlTotals.savePercentage,
                                                    3,
                                                )
                                                : '—'}
                                        </td>
                                        <td className={`${tdRight} font-semibold`}>
                                            {player.nhlTotals.saves}
                                        </td>
                                        <td className={`${tdRight} font-semibold`}>
                                            {player.nhlTotals.shotsAgainst}
                                        </td>
                                        <td className={`${tdRight} font-semibold`}>
                                            {player.nhlTotals.goalsAgainst}
                                        </td>
                                    </tr>
                                    <tr className={rowClass(1)}>
                                        <td className={`${tdLeft} font-semibold`}>
                                            Playoffs
                                        </td>
                                        <td className={`${tdRight} font-semibold`}>
                                            {player.nhlTotals.playoffGamesPlayed}
                                        </td>
                                        <td className={`${tdRight} font-semibold`}>
                                            {player.nhlTotals.playoffWins}
                                        </td>
                                        <td className={`${tdRight} font-semibold`}>
                                            {player.nhlTotals.playoffLosses}
                                        </td>
                                        <td className={`${tdRight} font-semibold`}>
                                            {player.nhlTotals.playoffOvertimeLosses}
                                        </td>
                                        <td className={`${tdRight} font-semibold`}>
                                            {player.nhlTotals.playoffShutouts}
                                        </td>
                                        <td className={`${tdRight} font-semibold`}>
                                            —
                                        </td>
                                        <td className={`${tdRight} font-semibold`}>
                                            —
                                        </td>
                                        <td className={`${tdRight} font-semibold`}>
                                            —
                                        </td>
                                        <td className={`${tdRight} font-semibold`}>
                                            —
                                        </td>
                                    </tr>
                                </tbody>
                            </table>
                        </TableShell>
                    ) : (
                        <TableShell>
                            <table className='w-full min-w-[640px] text-xs tabular-nums'>
                                <TableHead>
                                    <tr>
                                        <th className={thLeft}>&nbsp;</th>
                                        <th className={thRight}>GP</th>
                                        <th className={thRight}>G</th>
                                        <th className={thRight}>A</th>
                                        <th className={thRight}>Pts</th>
                                        <th className={thRight}>PIM</th>
                                        <th className={thRight}>+/-</th>
                                        <th className={thRight}>PPP</th>
                                        <th className={thRight}>SOG</th>
                                        <th className={thRight}>GWG</th>
                                    </tr>
                                </TableHead>
                                <tbody className='text-foreground'>
                                    <tr className={rowClass(0)}>
                                        <td className={`${tdLeft} font-semibold`}>
                                            Regular Season
                                        </td>
                                        <td className={`${tdRight} font-semibold`}>
                                            {player.nhlTotals.gamesPlayed}
                                        </td>
                                        <td className={`${tdRight} font-semibold`}>
                                            {player.nhlTotals.goals}
                                        </td>
                                        <td className={`${tdRight} font-semibold`}>
                                            {player.nhlTotals.assists}
                                        </td>
                                        <td className={`${tdRight} font-semibold`}>
                                            {player.nhlTotals.points}
                                        </td>
                                        <td className={`${tdRight} font-semibold`}>
                                            {player.nhlTotals.penaltyMinutes}
                                        </td>
                                        <td className={`${tdRight} font-semibold`}>
                                            {player.nhlTotals.plusMinus > 0
                                                ? `+${player.nhlTotals.plusMinus}`
                                                : player.nhlTotals.plusMinus}
                                        </td>
                                        <td className={`${tdRight} font-semibold`}>
                                            {player.nhlTotals.powerPlayPoints}
                                        </td>
                                        <td className={`${tdRight} font-semibold`}>
                                            {player.nhlTotals.shots}
                                        </td>
                                        <td className={`${tdRight} font-semibold`}>
                                            {player.nhlTotals.gameWinningGoals}
                                        </td>
                                    </tr>
                                    <tr className={rowClass(1)}>
                                        <td className={`${tdLeft} font-semibold`}>
                                            Playoffs
                                        </td>
                                        <td className={`${tdRight} font-semibold`}>
                                            {player.nhlTotals.playoffGamesPlayed}
                                        </td>
                                        <td className={`${tdRight} font-semibold`}>
                                            {player.nhlTotals.playoffGoals}
                                        </td>
                                        <td className={`${tdRight} font-semibold`}>
                                            {player.nhlTotals.playoffAssists}
                                        </td>
                                        <td className={`${tdRight} font-semibold`}>
                                            {player.nhlTotals.playoffPoints}
                                        </td>
                                        <td className={`${tdRight} font-semibold`}>
                                            {player.nhlTotals.playoffPenaltyMinutes}
                                        </td>
                                        <td className={`${tdRight} font-semibold`}>
                                            —
                                        </td>
                                        <td className={`${tdRight} font-semibold`}>
                                            {player.nhlTotals.playoffPowerPlayPoints}
                                        </td>
                                        <td className={`${tdRight} font-semibold`}>
                                            {player.nhlTotals.playoffShots}
                                        </td>
                                        <td className={`${tdRight} font-semibold`}>
                                            {player.nhlTotals.playoffGameWinningGoals}
                                        </td>
                                    </tr>
                                </tbody>
                            </table>
                        </TableShell>
                    )}
                </div>
            )}

            {/* Game logs (hidden until the user clicks) */}
            <SectionTitle>Fiches de match</SectionTitle>
            <button
                type='button'
                onClick={() => setShowGameLog((v) => !v)}
                className='cursor-pointer rounded-md border border-border px-3 py-1.5 text-sm text-foreground transition-colors hover:bg-secondary'
            >
                {showGameLog ? '▼ Masquer' : '▶ Afficher'} les fiches de match
            </button>

            {showGameLog && (
                <div className='mt-3'>
                    <GameLogTable
                        rows={player.recentGames}
                        isGoalie={isGoalie}
                    />
                </div>
            )}

            {/* Tournaments */}
            <SectionTitle>Tournaments</SectionTitle>
            {isGoalie ? (
                <GoalieCareerTable rows={player.tournaments} />
            ) : (
                <SkaterCareerTable rows={player.tournaments} />
            )}

            {/* Youth / minor (collapsed) */}
            <div className='mt-6'>
                <button
                    type='button'
                    onClick={() => setShowYouthMinor((v) => !v)}
                    className='cursor-pointer text-sm font-semibold text-primary hover:underline'
                >
                    {showYouthMinor ? '▼' : '▶'} Youth / Minor (
                    {player.youthMinor.length})
                </button>

                {showYouthMinor && (
                    <div className='mt-2'>
                        {isGoalie ? (
                            <GoalieCareerTable rows={player.youthMinor} />
                        ) : (
                            <SkaterCareerTable rows={player.youthMinor} />
                        )}
                    </div>
                )}
            </div>

            {/* Contracts */}
            <SectionTitle>Contracts</SectionTitle>

            {player.contracts.length === 0 ? (
                <p className='text-sm text-muted-foreground'>
                    Aucun contrat enregistré.
                </p>
            ) : (
                <TableShell>
                    <table className='w-full min-w-[560px] text-xs tabular-nums'>
                        <TableHead>
                            <tr>
                                <th className={thLeft}>Salaire annuel</th>
                                <th className={thLeft}>Début</th>
                                <th className={thLeft}>Fin</th>
                                <th className={thRight}>Années restantes</th>
                            </tr>
                        </TableHead>
                        <tbody className='text-foreground'>
                            {player.contracts.map((contract, index) => (
                                <tr
                                    key={`${contract.startSeason}-${contract.endSeason}`}
                                    className={rowClass(index)}
                                >
                                    <td className={tdLeft}>
                                        {salaryFormatter.format(contract.salary)} $
                                        <span className='ml-2 text-[0.7rem] text-muted-foreground'>
                                            ({compactMillions(contract.salary)})
                                        </span>
                                    </td>
                                    <td className={tdLeft}>
                                        {String(contract.startSeason).slice(0, 4)}
                                    </td>
                                    <td className={tdLeft}>
                                        {String(contract.endSeason).slice(4, 8)}
                                    </td>
                                    <td className={tdRight}>
                                        {contract.yearsRemaining}
                                    </td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </TableShell>
            )}

            {player.currentCapHit != null && (
                <p className='text-sm text-foreground'>
                    Cap hit (saison courante) :{' '}
                    <span className='font-semibold'>
                        {salaryFormatter.format(player.currentCapHit)} $
                    </span>
                    <span className='ml-2 text-xs text-muted-foreground'>
                        ({compactMillions(player.currentCapHit)})
                    </span>
                </p>
            )}

            {/* Fantasy */}
            {player.fantasyTeamName && (
                <>
                    <SectionTitle>Fantasy</SectionTitle>
                    <div className='rounded-lg border border-border bg-card p-3 text-sm'>
                        <p className='text-foreground'>
                            Équipe :{' '}
                            <span className='font-semibold'>
                                {player.fantasyTeamName}
                            </span>
                        </p>
                        <p className='text-muted-foreground'>
                            Statut : {player.rosterStatus ?? '—'}
                            {player.rosterSlot != null &&
                                ` · Slot ${player.rosterSlot}`}
                        </p>
                        {player.fantasySalary != null && (
                            <p className='text-muted-foreground'>
                                Salaire fantasy :{' '}
                                {salaryFormatter.format(player.fantasySalary)} $
                            </p>
                        )}
                        {player.seasonFantasyPoints != null && (
                            <p className='text-muted-foreground'>
                                Points fantasy (saison) :{' '}
                                {player.seasonFantasyPoints}
                                {player.seasonHatTricks != null && (
                                    <>
                                        {' '}
                                        · Tour du chapeau :{' '}
                                        {player.seasonHatTricks}
                                    </>
                                )}
                            </p>
                        )}
                    </div>
                </>
            )}

            {/* Injury history */}
            <SectionTitle>Historique des blessures</SectionTitle>

            {player.injuryHistory.length === 0 ? (
                <p className='text-sm text-muted-foreground'>
                    Aucune blessure enregistrée.
                </p>
            ) : (
                <TableShell>
                    <table className='w-full min-w-[640px] text-xs tabular-nums'>
                        <TableHead>
                            <tr>
                                <th className={thLeft}>Statut</th>
                                <th className={thLeft}>Équipe</th>
                                <th className={thLeft}>Vue le</th>
                                <th className={thLeft}>Dernière vue</th>
                                <th className={thLeft}>Résolue le</th>
                                <th className={thLeft}>Note</th>
                            </tr>
                        </TableHead>
                        <tbody className='text-foreground'>
                            {player.injuryHistory.map((spell, index) => (
                                <tr
                                    key={`${spell.firstSeenAt}-${index}`}
                                    className={rowClass(index)}
                                >
                                    <td className={tdLeft}>
                                        {spell.injuryStatus}
                                    </td>
                                    <td className={tdLeft}>
                                        {spell.teamAbbreviation}
                                    </td>
                                    <td className={tdLeft}>
                                        {shortDate(spell.firstSeenAt)}
                                    </td>
                                    <td className={tdLeft}>
                                        {shortDate(spell.lastSeenAt)}
                                    </td>
                                    <td className={tdLeft}>
                                        {spell.resolvedAt
                                            ? shortDate(spell.resolvedAt)
                                            : 'En cours'}
                                    </td>
                                    <td
                                        className={`${tdLeft} max-w-md whitespace-normal text-[0.7rem] text-muted-foreground`}
                                    >
                                        {spell.injuryDescription ?? '—'}
                                    </td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </TableShell>
            )}

            {/* Bottom close for long pages */}
            <div className='pt-4'>
                <button
                    type='button'
                    onClick={handleClose}
                    className='cursor-pointer rounded-md border border-border px-3 py-1.5 text-sm text-foreground transition-colors hover:bg-secondary'
                >
                    ✕ Fermer
                </button>
            </div>
        </section>
    );
}