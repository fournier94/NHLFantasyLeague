import { useEffect, useMemo, useState } from 'react';
import { Link, useLocation, useParams } from 'react-router-dom';
import { ArrowLeft } from 'lucide-react';
import {
    getNhlStandings,
    type NhlTeamStandingsRow,
} from '@/api/client';
import { NhlTeamLogo } from '@/components/nhl/NhlTeamLogo';
import {
    getNhlTeamColor,
    getNhlTeamTextColor,
} from '@/lib/nhlTeamColors';

// ---------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------

function formatPct(val: number): string {
    if (val === 0) return '0.0%';
    return (val <= 1 ? val * 100 : val).toFixed(1) + '%';
}

function formatDiff(diff: number): string {
    if (diff > 0) return `+${diff}`;
    return String(diff);
}

function streakRankValue(row: NhlTeamStandingsRow): number {
    if (!row.streakCode) return 0;
    if (row.streakCode === 'W') return row.streakCount;
    if (row.streakCode === 'L') return -row.streakCount;
    return 0; // OT
}

function ordinalFr(n: number): string {
    if (n === 1) return '1er';
    return `${n}e`;
}

// ---------------------------------------------------------------------
// Stat definitions
// ---------------------------------------------------------------------

type Direction = 'asc' | 'desc';

interface StatDefinition {
    label: string;
    direction: Direction;
    format: (row: NhlTeamStandingsRow) => string;
    value: (row: NhlTeamStandingsRow) => number;
}

const statsConfig = {
    V: { label: 'V', direction: 'desc', format: (r: NhlTeamStandingsRow) => String(r.wins), value: (r: NhlTeamStandingsRow) => r.wins },
    D: { label: 'D', direction: 'asc', format: (r: NhlTeamStandingsRow) => String(r.losses), value: (r: NhlTeamStandingsRow) => r.losses },
    DP: { label: 'DP', direction: 'asc', format: (r: NhlTeamStandingsRow) => String(r.otLosses), value: (r: NhlTeamStandingsRow) => r.otLosses },
    PTS: { label: 'PTS', direction: 'desc', format: (r: NhlTeamStandingsRow) => String(r.points), value: (r: NhlTeamStandingsRow) => r.points },
    PCT: { label: '%', direction: 'desc', format: (r: NhlTeamStandingsRow) => formatPct(r.pointPctg), value: (r: NhlTeamStandingsRow) => r.pointPctg },
    DIFF: { label: 'DIFF', direction: 'desc', format: (r: NhlTeamStandingsRow) => formatDiff(r.goalDifferential), value: (r: NhlTeamStandingsRow) => r.goalDifferential },
    BP: { label: 'BP', direction: 'desc', format: (r: NhlTeamStandingsRow) => String(r.goalsFor), value: (r: NhlTeamStandingsRow) => r.goalsFor },
    BC: { label: 'BC', direction: 'asc', format: (r: NhlTeamStandingsRow) => String(r.goalsAgainst), value: (r: NhlTeamStandingsRow) => r.goalsAgainst },
    MJ: { label: 'MJ%', direction: 'desc', format: (r: NhlTeamStandingsRow) => formatPct(r.faceoffWinPct), value: (r: NhlTeamStandingsRow) => r.faceoffWinPct },
    AN: { label: 'AN%', direction: 'desc', format: (r: NhlTeamStandingsRow) => formatPct(r.powerPlayPct), value: (r: NhlTeamStandingsRow) => r.powerPlayPct },
    DN: { label: 'DN%', direction: 'desc', format: (r: NhlTeamStandingsRow) => formatPct(r.penaltyKillPct), value: (r: NhlTeamStandingsRow) => r.penaltyKillPct },
    SEQ: { label: 'SÉQ', direction: 'desc', format: (r: NhlTeamStandingsRow) => r.streakCode ? `${r.streakCode}${r.streakCount}` : '—', value: (r: NhlTeamStandingsRow) => streakRankValue(r) },
    L10: { label: '10D', direction: 'desc', format: (r: NhlTeamStandingsRow) => `${r.l10Wins}-${r.l10Losses}-${r.l10OtLosses}`, value: (r: NhlTeamStandingsRow) => r.l10Wins * 2 + r.l10OtLosses }
} as const;

function computeRank(
    teams: NhlTeamStandingsRow[],
    stat: StatDefinition,
    team: NhlTeamStandingsRow,
): number {
    const sorted = [...teams].sort((a, b) => {
        const av = stat.value(a);
        const bv = stat.value(b);

        if (av === bv) {
            return a.teamAbbreviation.localeCompare(b.teamAbbreviation);
        }

        return stat.direction === 'asc' ? av - bv : bv - av;
    });

    return sorted.findIndex(t => t.nhlTeamId === team.nhlTeamId) + 1;
}

// ---------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------

export default function NhlEquipePage() {
    const { nhlTeamId } = useParams<{ nhlTeamId: string }>();

    const location = useLocation();

    // When GameDay navigates here via a team-logo click on an
    // unstarted game, it passes state.returnTo = '/game-day'. In
    // that case the "Retour" button must return the user to the
    // GameDay page (where the snapshot will be restored). For every
    // other entry point (Statistiques standings table, direct
    // URL, etc.), the fallback stays Statistiques with the teams
    // tab selected, which is the pre-existing behaviour.
    const returnTo =
        (location.state as { returnTo?: string } | null)?.returnTo;

    const backTo = returnTo || '/statistiques';
    const backState = returnTo ? undefined : { initialTab: 'teams' as const };

    const [rows, setRows] = useState<NhlTeamStandingsRow[]>([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);

    useEffect(() => {
        let cancelled = false;

        setLoading(true);
        setError(null);

        getNhlStandings()
            .then(data => {
                if (!cancelled) setRows(data);
            })
            .catch(() => {
                if (!cancelled) {
                    setError(
                        "Impossible de charger les statistiques de l'équipe.",
                    );
                }
            })
            .finally(() => {
                if (!cancelled) setLoading(false);
            });

        return () => {
            cancelled = true;
        };
    }, []);

    const team = useMemo(() => {
        const id = Number(nhlTeamId);
        if (!Number.isFinite(id)) return null;
        return rows.find(t => t.nhlTeamId === id) ?? null;
    }, [rows, nhlTeamId]);

    if (loading) {
        return (
            <section className='-mt-4 flex min-h-full w-full flex-col items-center gap-3 pt-2.5 sm:-mt-6'>
                <p className='text-base text-muted-foreground'>Chargement...</p>
            </section>
        );
    }

    if (error || !team) {
        return (
            <section className='-mt-4 flex min-h-full w-full flex-col items-center gap-3 pt-2.5 sm:-mt-6'>
                <div className='w-full max-w-5xl'>
                    <Link
                        to={backTo}
                        state={backState}
                        className='inline-flex items-center gap-2 text-base text-muted-foreground transition-colors hover:text-white'
                    >
                        <ArrowLeft className='h-5 w-5' />
                        <span>Retour</span>
                    </Link>
                </div>
                <p className='text-base text-destructive'>
                    {error ?? 'Équipe introuvable.'}
                </p>
            </section>
        );
    }

    const primaryColor = getNhlTeamColor(team.teamAbbreviation);
    const secondaryColor = getNhlTeamTextColor(team.teamAbbreviation);

    // Rendering helper for stats that have no rank (V-D-DP)
    const renderNoRank = (key: keyof typeof statsConfig) => {
        const conf = statsConfig[key];
        return <span className='font-bold'>{conf.format(team)}</span>;
    };

    // Rendering helper for stats that have a label but no rank (SÉQ)
    const renderLabelNoRank = (key: keyof typeof statsConfig) => {
        const conf = statsConfig[key];
        return (
            <span className='inline-flex items-baseline gap-1'>
                <span className='font-bold text-xs sm:text-sm uppercase'>{conf.label}:</span>
                <span className='font-semibold'>{conf.format(team)}</span>
            </span>
        );
    };

    // Rendering helper for stats that have a rank
    const renderStat = (key: keyof typeof statsConfig) => {
        const conf = statsConfig[key];
        const val = conf.format(team);
        const rank = computeRank(rows, conf, team);
        return (
            <span className='inline-flex items-baseline gap-1'>
                <span className='font-bold text-xs sm:text-sm uppercase'>{conf.label}:</span>
                <span className='font-semibold'>{val}</span>
                <span className='text-[10px] sm:text-xs opacity-80 whitespace-nowrap'>({ordinalFr(rank)})</span>
            </span>
        );
    };

    return (
        <section className='-mt-4 flex min-h-full w-full flex-col items-center gap-3 pt-2.5 sm:-mt-6'>
            {/* Back link */}
            <div className='w-full max-w-5xl'>
                <Link
                    to={backTo}
                    state={backState}
                    className='inline-flex items-center gap-2 text-base text-muted-foreground transition-colors hover:text-white'
                >
                    <ArrowLeft className='h-5 w-5' />
                    <span>Retour</span>
                </Link>
            </div>

            {/* Header card */}
            <div
                className='w-full max-w-5xl overflow-hidden rounded-lg shadow-lg'
                style={{
                    backgroundColor: primaryColor,
                    color: secondaryColor,
                }}
            >
                {/* Top Row: Logo + Sections 1 & 2 */}
                <div className='flex flex-row items-stretch p-4 sm:p-6 gap-4'>
                    {/* Logo (uses 1/4 of the width on mobile, less on larger screens) */}
                    <div className='shrink-0 flex items-center justify-center w-1/4 sm:w-1/5 max-w-[100px]'>
                        <div style={{ transform: 'scale(2)' }}>
                            <NhlTeamLogo
                                abbreviation={team.teamAbbreviation}
                                size={72}
                            />
                        </div>
                    </div>

                    {/* Right Side (takes remaining 3/4 of the width) */}
                    <div className='flex flex-col flex-1 justify-center gap-1.5 sm:gap-2 min-w-0'>
                        {/* Team Name */}
                        <h1 className='truncate text-xl sm:text-2xl md:text-3xl font-bold leading-tight mb-1'>
                            {team.teamName}
                        </h1>

                        {/* Section 1 */}
                        <div className='flex flex-wrap items-center gap-x-3 gap-y-1 text-sm sm:text-base'>
                            <span className='inline-flex items-baseline gap-1 font-bold text-sm sm:text-base'>
                                {renderNoRank('V')} - {renderNoRank('D')} - {renderNoRank('DP')}
                            </span>
                            {renderStat('PTS')}
                            {renderStat('PCT')}
                            {renderLabelNoRank('SEQ')}
                            {renderStat('L10')}
                        </div>

                        {/* Section 2 */}
                        <div className='flex flex-wrap items-center gap-x-3 gap-y-1 text-sm sm:text-base'>
                            {renderStat('DIFF')}
                            {renderStat('BP')}
                            {renderStat('BC')}
                        </div>
                    </div>
                </div>

                {/* Bottom Row: Section 3 */}
                <div className='flex flex-wrap items-center justify-center gap-x-4 gap-y-1 px-4 pb-4 sm:px-6 sm:pb-6 text-sm sm:text-base'>
                    {renderStat('MJ')}
                    {renderStat('AN')}
                    {renderStat('DN')}
                </div>
            </div>

            {/* Table of players placeholder */}
            <div className='w-full max-w-5xl mt-4 rounded-lg border-2 border-red-500 bg-[#050A18] p-6 sm:p-12 text-center'>
                <p className='text-lg sm:text-2xl font-bold text-red-500'>
                    Tableau des joueurs de l'équipe
                </p>
                <p className='text-sm sm:text-lg mt-2 text-red-400/70'>
                    Sera ajouté dans une prochaine étape.
                </p>
            </div>
        </section>
    );
}