import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import {
    getPlayerDetail,
    type CareerRow,
    type GameLogRow,
    type PlayerDetail,
} from '@/api/client';

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
// Shared table styles
// ---------------------------------------------------------------------

const thClass = 'border border-[#1B3A5C] px-2 py-1 text-left';
const thRightClass = 'border border-[#1B3A5C] px-2 py-1 text-right';
const tdClass = 'border border-[#C9D9EC] px-2 py-1 text-left';
const tdRightClass = 'border border-[#C9D9EC] px-2 py-1 text-right';

function rowBg(index: number): string {
    return index % 2 === 0 ? 'bg-[#EDF3FB]' : 'bg-[#F7FAFD]';
}

// ---------------------------------------------------------------------
// Small components
// ---------------------------------------------------------------------

function SectionTitle({ children }: { children: React.ReactNode }) {
    return (
        <h2 className='mt-6 mb-2 text-xl font-bold text-[#1B3A5C]'>
            {children}
        </h2>
    );
}

function SkaterCareerTable({ rows }: { rows: CareerRow[] }) {
    if (rows.length === 0) {
        return (
            <p className='text-sm text-muted-foreground'>
                Aucune donnée.
            </p>
        );
    }

    return (
        <table className='w-full border-collapse text-xs tabular-nums'>
            <thead>
                <tr className='bg-[#1B3A5C] text-white'>
                    <th className={thClass}>Season</th>
                    <th className={thClass}>Team</th>
                    <th className={thClass}>Lge</th>
                    <th className={thRightClass}>GP</th>
                    <th className={thRightClass}>G</th>
                    <th className={thRightClass}>A</th>
                    <th className={thRightClass}>Pts</th>
                    <th className={thRightClass}>PIM</th>
                    <th className={thRightClass}>+/-</th>
                    <th className={thRightClass}>PPP</th>
                    <th className={thRightClass}>SOG</th>
                    <th className={thRightClass}>GWG</th>
                    <th className={thRightClass}>ATOI</th>
                </tr>
            </thead>

            <tbody>
                {rows.map((row, index) => (
                    <tr
                        key={`${row.season}-${row.leagueAbbreviation}-${row.teamName}-${index}`}
                        className={rowBg(index)}
                    >
                        <td className={tdClass}>{row.seasonLabel}</td>
                        <td className={tdClass}>{teamDisplay(row)}</td>
                        <td className={tdClass}>{row.leagueAbbreviation}</td>
                        <td className={tdRightClass}>{row.gamesPlayed}</td>
                        <td className={tdRightClass}>{row.goals}</td>
                        <td className={tdRightClass}>{row.assists}</td>
                        <td className={tdRightClass}>{row.points}</td>
                        <td className={tdRightClass}>{row.penaltyMinutes}</td>
                        <td className={tdRightClass}>
                            {row.plusMinus > 0 ? `+${row.plusMinus}` : row.plusMinus}
                        </td>
                        <td className={tdRightClass}>{row.powerPlayPoints}</td>
                        <td className={tdRightClass}>{row.shots}</td>
                        <td className={tdRightClass}>{row.gameWinningGoals}</td>
                        <td className={tdRightClass}>
                            {row.averageTimeOnIce ?? '—'}
                        </td>
                    </tr>
                ))}
            </tbody>
        </table>
    );
}

function GoalieCareerTable({ rows }: { rows: CareerRow[] }) {
    if (rows.length === 0) {
        return (
            <p className='text-sm text-muted-foreground'>
                Aucune donnée.
            </p>
        );
    }

    return (
        <table className='w-full border-collapse text-xs tabular-nums'>
            <thead>
                <tr className='bg-[#1B3A5C] text-white'>
                    <th className={thClass}>Season</th>
                    <th className={thClass}>Team</th>
                    <th className={thClass}>Lge</th>
                    <th className={thRightClass}>GP</th>
                    <th className={thRightClass}>W</th>
                    <th className={thRightClass}>L</th>
                    <th className={thRightClass}>OTL</th>
                    <th className={thRightClass}>SO</th>
                    <th className={thRightClass}>SV%</th>
                    <th className={thRightClass}>GAA</th>
                    <th className={thRightClass}>SV</th>
                    <th className={thRightClass}>SA</th>
                </tr>
            </thead>

            <tbody>
                {rows.map((row, index) => (
                    <tr
                        key={`${row.season}-${row.leagueAbbreviation}-${row.teamName}-${index}`}
                        className={rowBg(index)}
                    >
                        <td className={tdClass}>{row.seasonLabel}</td>
                        <td className={tdClass}>{teamDisplay(row)}</td>
                        <td className={tdClass}>{row.leagueAbbreviation}</td>
                        <td className={tdRightClass}>{row.gamesPlayed}</td>
                        <td className={tdRightClass}>{row.wins}</td>
                        <td className={tdRightClass}>{row.losses}</td>
                        <td className={tdRightClass}>{row.overtimeLosses}</td>
                        <td className={tdRightClass}>{row.shutouts}</td>
                        <td className={tdRightClass}>
                            {formatDecimal(row.savePercentage, 3)}
                        </td>
                        <td className={tdRightClass}>
                            {formatDecimal(row.goalsAgainstAverage, 2)}
                        </td>
                        <td className={tdRightClass}>{row.saves}</td>
                        <td className={tdRightClass}>{row.shotsAgainst}</td>
                    </tr>
                ))}
            </tbody>
        </table>
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
            <p className='text-sm text-muted-foreground'>
                Aucune partie récente.
            </p>
        );
    }

    return (
        <table className='w-full border-collapse text-xs tabular-nums'>
            <thead>
                <tr className='bg-[#1B3A5C] text-white'>
                    <th className={thClass}>Date</th>
                    <th className={thClass}>Opp</th>
                    <th className={thClass}>Loc</th>
                    {isGoalie ? (
                        <>
                            <th className={thRightClass}>Déc.</th>
                            <th className={thRightClass}>BA</th>
                            <th className={thRightClass}>AR</th>
                            <th className={thRightClass}>Pts</th>
                        </>
                    ) : (
                        <>
                            <th className={thRightClass}>B</th>
                            <th className={thRightClass}>A</th>
                            <th className={thRightClass}>Pts</th>
                            <th className={thRightClass}>FP</th>
                        </>
                    )}
                </tr>
            </thead>

            <tbody>
                {rows.map((game, index) => {
                    const result = isGoalie
                        ? game.goalieWin
                            ? 'W'
                            : game.goalieOvertimeLoss
                                ? 'OTL'
                                : 'L'
                        : null;

                    return (
                        <tr key={game.nhlGameId} className={rowBg(index)}>
                            <td className={tdClass}>
                                {shortGameDate(game.gameDate)}
                            </td>
                            <td className={tdClass}>
                                {game.opponentAbbreviation}
                            </td>
                            <td className={tdClass}>
                                {game.isHomeGame ? 'H' : 'R'}
                            </td>

                            {isGoalie ? (
                                <>
                                    <td className={tdRightClass}>
                                        {result}
                                        {game.shutout ? ' (SO)' : ''}
                                    </td>
                                    <td className={tdRightClass}>
                                        {game.goalsAgainst}
                                    </td>
                                    <td className={tdRightClass}>
                                        {game.saves}
                                    </td>
                                    <td className={tdRightClass}>
                                        {game.fantasyPoints}
                                    </td>
                                </>
                            ) : (
                                <>
                                    <td className={tdRightClass}>
                                        {game.goals}
                                    </td>
                                    <td className={tdRightClass}>
                                        {game.assists}
                                    </td>
                                    <td className={tdRightClass}>
                                        {game.points}
                                    </td>
                                    <td className={tdRightClass}>
                                        {game.fantasyPoints}
                                    </td>
                                </>
                            )}
                        </tr>
                    );
                })}
            </tbody>
        </table>
    );
}

// ---------------------------------------------------------------------
// The page
// ---------------------------------------------------------------------

export default function PlayerPage() {
    const { nhlPlayerId } = useParams<{ nhlPlayerId: string }>();

    const [player, setPlayer] = useState<PlayerDetail | null>(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [showYouthMinor, setShowYouthMinor] = useState(false);

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

    if (loading) {
        return <p className='text-muted-foreground'>Chargement...</p>;
    }

    if (error || !player) {
        return (
            <div>
                <p className='text-destructive'>
                    {error ?? 'Joueur introuvable.'}
                </p>
                <Link
                    to='/joueurs'
                    className='mt-2 inline-block text-sm text-primary hover:underline'
                >
                    ← Retour aux joueurs
                </Link>
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
        <section className='mx-auto max-w-5xl space-y-4'>
            <div>
                <Link
                    to='/joueurs'
                    className='text-sm text-primary hover:underline'
                >
                    ← Retour aux joueurs
                </Link>
            </div>

            {/* Hero banner (only when the API returned one) */}
            {player.heroImageUrl && (
                <div className='-mx-4 -mt-4 mb-2 h-40 overflow-hidden rounded-b-lg border-b border-border bg-black md:-mx-6'>
                    <img
                        src={player.heroImageUrl}
                        alt=''
                        className='h-full w-full object-cover opacity-80'
                        loading='lazy'
                    />
                </div>
            )}

            {/* Identity + headshot */}
            <div className='flex flex-wrap items-start justify-between gap-4'>
                <div className='min-w-0 flex-1'>
                    <div className='flex items-center gap-3'>
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
                            <br />
                            - {draftLine}
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
                        className='h-32 w-32 rounded-md bg-white object-cover'
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

            {/* Career */}
            <SectionTitle>Career</SectionTitle>

            <div className='grid grid-cols-1 gap-4 md:grid-cols-2'>
                <div>
                    <h3 className='mb-1 text-sm font-semibold text-[#1B3A5C]'>
                        Regular Season
                    </h3>
                    {isGoalie ? (
                        <GoalieCareerTable rows={player.regularSeason} />
                    ) : (
                        <SkaterCareerTable rows={player.regularSeason} />
                    )}
                </div>

                <div>
                    <h3 className='mb-1 text-sm font-semibold text-[#1B3A5C]'>
                        Playoffs
                    </h3>
                    {isGoalie ? (
                        <GoalieCareerTable rows={player.playoffs} />
                    ) : (
                        <SkaterCareerTable rows={player.playoffs} />
                    )}
                </div>
            </div>

            {hasNhlTotals && (
                <div className='mt-2'>
                    <h3 className='mb-1 text-sm font-semibold text-[#1B3A5C]'>
                        NHL Totals
                    </h3>

                    {isGoalie ? (
                        <table className='w-full border-collapse text-xs tabular-nums'>
                            <thead>
                                <tr className='bg-[#1B3A5C] text-white'>
                                    <th className={thClass}>&nbsp;</th>
                                    <th className={thRightClass}>GP</th>
                                    <th className={thRightClass}>W</th>
                                    <th className={thRightClass}>L</th>
                                    <th className={thRightClass}>OTL</th>
                                    <th className={thRightClass}>SO</th>
                                    <th className={thRightClass}>SV</th>
                                    <th className={thRightClass}>SA</th>
                                    <th className={thRightClass}>GA</th>
                                </tr>
                            </thead>
                            <tbody>
                                <tr className={rowBg(0)}>
                                    <td className={`${tdClass} font-semibold`}>
                                        Regular Season
                                    </td>
                                    <td className={`${tdRightClass} font-semibold`}>
                                        {player.nhlTotals.gamesPlayed}
                                    </td>
                                    <td className={`${tdRightClass} font-semibold`}>
                                        {player.nhlTotals.wins}
                                    </td>
                                    <td className={`${tdRightClass} font-semibold`}>
                                        {player.nhlTotals.losses}
                                    </td>
                                    <td className={`${tdRightClass} font-semibold`}>
                                        {player.nhlTotals.overtimeLosses}
                                    </td>
                                    <td className={`${tdRightClass} font-semibold`}>
                                        {player.nhlTotals.shutouts}
                                    </td>
                                    <td className={`${tdRightClass} font-semibold`}>
                                        {player.nhlTotals.saves}
                                    </td>
                                    <td className={`${tdRightClass} font-semibold`}>
                                        {player.nhlTotals.shotsAgainst}
                                    </td>
                                    <td className={`${tdRightClass} font-semibold`}>
                                        {player.nhlTotals.goalsAgainst}
                                    </td>
                                </tr>
                                <tr className={rowBg(1)}>
                                    <td className={`${tdClass} font-semibold`}>
                                        Playoffs
                                    </td>
                                    <td className={`${tdRightClass} font-semibold`}>
                                        {player.nhlTotals.playoffGamesPlayed}
                                    </td>
                                    <td className={`${tdRightClass} font-semibold`}>
                                        {player.nhlTotals.playoffWins}
                                    </td>
                                    <td className={`${tdRightClass} font-semibold`}>
                                        {player.nhlTotals.playoffLosses}
                                    </td>
                                    <td className={`${tdRightClass} font-semibold`}>
                                        {player.nhlTotals.playoffOvertimeLosses}
                                    </td>
                                    <td className={`${tdRightClass} font-semibold`}>
                                        {player.nhlTotals.playoffShutouts}
                                    </td>
                                    <td className={`${tdRightClass} font-semibold`}>
                                        —
                                    </td>
                                    <td className={`${tdRightClass} font-semibold`}>
                                        —
                                    </td>
                                    <td className={`${tdRightClass} font-semibold`}>
                                        —
                                    </td>
                                </tr>
                            </tbody>
                        </table>
                    ) : (
                        <table className='w-full border-collapse text-xs tabular-nums'>
                            <thead>
                                <tr className='bg-[#1B3A5C] text-white'>
                                    <th className={thClass}>&nbsp;</th>
                                    <th className={thRightClass}>GP</th>
                                    <th className={thRightClass}>G</th>
                                    <th className={thRightClass}>A</th>
                                    <th className={thRightClass}>Pts</th>
                                    <th className={thRightClass}>PIM</th>
                                    <th className={thRightClass}>+/-</th>
                                    <th className={thRightClass}>PPP</th>
                                    <th className={thRightClass}>SOG</th>
                                    <th className={thRightClass}>GWG</th>
                                </tr>
                            </thead>
                            <tbody>
                                <tr className={rowBg(0)}>
                                    <td className={`${tdClass} font-semibold`}>
                                        Regular Season
                                    </td>
                                    <td className={`${tdRightClass} font-semibold`}>
                                        {player.nhlTotals.gamesPlayed}
                                    </td>
                                    <td className={`${tdRightClass} font-semibold`}>
                                        {player.nhlTotals.goals}
                                    </td>
                                    <td className={`${tdRightClass} font-semibold`}>
                                        {player.nhlTotals.assists}
                                    </td>
                                    <td className={`${tdRightClass} font-semibold`}>
                                        {player.nhlTotals.points}
                                    </td>
                                    <td className={`${tdRightClass} font-semibold`}>
                                        {player.nhlTotals.penaltyMinutes}
                                    </td>
                                    <td className={`${tdRightClass} font-semibold`}>
                                        {player.nhlTotals.plusMinus > 0
                                            ? `+${player.nhlTotals.plusMinus}`
                                            : player.nhlTotals.plusMinus}
                                    </td>
                                    <td className={`${tdRightClass} font-semibold`}>
                                        {player.nhlTotals.powerPlayPoints}
                                    </td>
                                    <td className={`${tdRightClass} font-semibold`}>
                                        {player.nhlTotals.shots}
                                    </td>
                                    <td className={`${tdRightClass} font-semibold`}>
                                        {player.nhlTotals.gameWinningGoals}
                                    </td>
                                </tr>
                                <tr className={rowBg(1)}>
                                    <td className={`${tdClass} font-semibold`}>
                                        Playoffs
                                    </td>
                                    <td className={`${tdRightClass} font-semibold`}>
                                        {player.nhlTotals.playoffGamesPlayed}
                                    </td>
                                    <td className={`${tdRightClass} font-semibold`}>
                                        {player.nhlTotals.playoffGoals}
                                    </td>
                                    <td className={`${tdRightClass} font-semibold`}>
                                        {player.nhlTotals.playoffAssists}
                                    </td>
                                    <td className={`${tdRightClass} font-semibold`}>
                                        {player.nhlTotals.playoffPoints}
                                    </td>
                                    <td className={`${tdRightClass} font-semibold`}>
                                        {player.nhlTotals.playoffPenaltyMinutes}
                                    </td>
                                    <td className={`${tdRightClass} font-semibold`}>
                                        —
                                    </td>
                                    <td className={`${tdRightClass} font-semibold`}>
                                        {player.nhlTotals.playoffPowerPlayPoints}
                                    </td>
                                    <td className={`${tdRightClass} font-semibold`}>
                                        {player.nhlTotals.playoffShots}
                                    </td>
                                    <td className={`${tdRightClass} font-semibold`}>
                                        {player.nhlTotals.playoffGameWinningGoals}
                                    </td>
                                </tr>
                            </tbody>
                        </table>
                    )}
                </div>
            )}

            {/* Recent games */}
            <SectionTitle>Dernières parties</SectionTitle>
            <GameLogTable rows={player.recentGames} isGoalie={isGoalie} />

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
                    {showYouthMinor ? '▼' : '▶'} Youth / Minor ({player.youthMinor.length})
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
                <table className='w-full border-collapse text-xs tabular-nums'>
                    <thead>
                        <tr className='bg-[#1B3A5C] text-white'>
                            <th className={thClass}>Salaire annuel</th>
                            <th className={thClass}>Début</th>
                            <th className={thClass}>Fin</th>
                            <th className={thRightClass}>Années restantes</th>
                        </tr>
                    </thead>
                    <tbody>
                        {player.contracts.map((contract, index) => (
                            <tr
                                key={`${contract.startSeason}-${contract.endSeason}`}
                                className={rowBg(index)}
                            >
                                <td className={tdClass}>
                                    {salaryFormatter.format(contract.salary)} $
                                    <span className='ml-2 text-[0.7rem] text-muted-foreground'>
                                        ({compactMillions(contract.salary)})
                                    </span>
                                </td>
                                <td className={tdClass}>
                                    {String(contract.startSeason).slice(0, 4)}
                                </td>
                                <td className={tdClass}>
                                    {String(contract.endSeason).slice(4, 8)}
                                </td>
                                <td className={tdRightClass}>
                                    {contract.yearsRemaining}
                                </td>
                            </tr>
                        ))}
                    </tbody>
                </table>
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
                            {player.rosterSlot != null && ` · Slot ${player.rosterSlot}`}
                        </p>
                        {player.fantasySalary != null && (
                            <p className='text-muted-foreground'>
                                Salaire fantasy :{' '}
                                {salaryFormatter.format(player.fantasySalary)} $
                            </p>
                        )}
                        {player.seasonFantasyPoints != null && (
                            <p className='text-muted-foreground'>
                                Points fantasy (saison) : {player.seasonFantasyPoints}
                                {player.seasonHatTricks != null && (
                                    <> · Tour du chapeau : {player.seasonHatTricks}</>
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
                <table className='w-full border-collapse text-xs tabular-nums'>
                    <thead>
                        <tr className='bg-[#1B3A5C] text-white'>
                            <th className={thClass}>Statut</th>
                            <th className={thClass}>Équipe</th>
                            <th className={thClass}>Vue le</th>
                            <th className={thClass}>Dernière vue</th>
                            <th className={thClass}>Résolue le</th>
                            <th className={thClass}>Note</th>
                        </tr>
                    </thead>
                    <tbody>
                        {player.injuryHistory.map((spell, index) => (
                            <tr
                                key={`${spell.firstSeenAt}-${index}`}
                                className={rowBg(index)}
                            >
                                <td className={tdClass}>{spell.injuryStatus}</td>
                                <td className={tdClass}>
                                    {spell.teamAbbreviation}
                                </td>
                                <td className={tdClass}>
                                    {shortDate(spell.firstSeenAt)}
                                </td>
                                <td className={tdClass}>
                                    {shortDate(spell.lastSeenAt)}
                                </td>
                                <td className={tdClass}>
                                    {spell.resolvedAt
                                        ? shortDate(spell.resolvedAt)
                                        : 'En cours'}
                                </td>
                                <td className={`${tdClass} text-[0.7rem] text-muted-foreground`}>
                                    {spell.injuryDescription ?? '—'}
                                </td>
                            </tr>
                        ))}
                    </tbody>
                </table>
            )}

            <div className='pt-4'>
                <Link
                    to='/joueurs'
                    className='text-sm text-primary hover:underline'
                >
                    ← Retour aux joueurs
                </Link>
            </div>
        </section>
    );
}