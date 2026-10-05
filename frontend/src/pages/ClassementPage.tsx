import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { Crown, TrendingUp } from 'lucide-react';
import {
    getStandings,
    type StandingsRow,
} from '@/api/client';
import { cn } from '@/lib/utils';
import { NeonTitle } from '@/components/ui/NeonTitle';

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
// Palette
// ---------------------------------------------------------------------

const GOLD = '#FFC72C';
const SILVER = '#C0C0C0';
const BRONZE = '#CD7F32';
const CYAN = '#00E5FF';
const CYAN_SOFT = '#7DD3FC';
const GREEN = '#22C55E';

const CYAN_BORDER = 'rgba(0, 168, 255, 0.6)';
const CYAN_GLOW = 'rgba(0, 168, 255, 0.35)';
const FRAME_BG = '#080D1A';

// 11 columns: 6% rank, 20% team, 9 equal stat columns.
// Identical to the previous implementation's colgroup proportions.
const GRID_COLUMNS = '6% 20% repeat(9, calc((100% - 26%) / 9))';

// ---------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------

interface RankAccent {
    accent: string;
    tint: string | undefined;
    glow: string;
}

function rankAccent(rank: number): RankAccent {
    if (rank === 1) {
        return {
            accent: GOLD,
            tint: 'rgba(255, 199, 44, 0.06)',
            glow: 'rgba(255, 199, 44, 0.55)',
        };
    }
    if (rank === 2) {
        return {
            accent: SILVER,
            tint: 'rgba(192, 192, 192, 0.05)',
            glow: 'rgba(192, 192, 192, 0.4)',
        };
    }
    if (rank === 3) {
        return {
            accent: BRONZE,
            tint: 'rgba(205, 127, 50, 0.06)',
            glow: 'rgba(205, 127, 50, 0.4)',
        };
    }
    return {
        accent: 'rgba(0, 168, 255, 0.45)',
        tint: undefined,
        glow: 'rgba(0, 168, 255, 0.3)',
    };
}

function renderDailyTotal(value: number) {
    if (value > 0) {
        return (
            <span
                className='font-semibold'
                style={{
                    color: GREEN,
                    textShadow: '0 0 6px rgba(34, 197, 94, 0.5)',
                }}
            >
                +{value}
            </span>
        );
    }
    return <span className='text-muted-foreground'>0</span>;
}

// ---------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------

export default function ClassementPage() {
    const [rows, setRows] = useState<StandingsRow[]>([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);

    const [sortKey, setSortKey] =
        useState<SortKey>('totalFantasyPoints');
    const [sortDirection, setSortDirection] =
        useState<SortDirection>('desc');

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

    // --- Sortable column header ---------------------------------------

    function ColumnHeader({
        label,
        key: sortField,
        color = CYAN_SOFT,
    }: {
        label: string;
        key: SortKey;
        color?: string;
    }) {
        const active = sortKey === sortField;

        return (
            <button
                type='button'
                onClick={() => handleSort(sortField)}
                className={cn(
                    'w-full cursor-pointer select-none text-center font-semibold uppercase tracking-wider transition-colors hover:text-white',
                    active ? '' : '',
                )}
                style={{
                    color: active ? CYAN : color,
                    textShadow: active
                        ? `0 0 8px ${CYAN}AA`
                        : undefined,
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

    // --- Loading / error states ---------------------------------------

    if (loading) {
        return (
            <section className='w-full space-y-4'>
                <h2 className='text-center'>
                    <NeonTitle keepPulseOnMobile>Classement</NeonTitle>
                </h2>
                <p className='text-center text-muted-foreground'>
                    Chargement...
                </p>
            </section>
        );
    }

    if (error) {
        return (
            <section className='w-full space-y-4'>
                <h2 className='text-center'>
                    <NeonTitle keepPulseOnMobile>Classement</NeonTitle>
                </h2>
                <p className='text-center text-destructive'>{error}</p>
            </section>
        );
    }

    return (
        <section className='flex min-h-full w-full flex-col gap-4'>
            {/* ---- Header: crown + title + decorative subtitle ---- */}
            <div className='flex flex-col items-center gap-1.5'>
                <Crown
                    className='h-7 w-7'
                    strokeWidth={2}
                    style={{
                        color: GOLD,
                        filter:
                            'drop-shadow(0 0 6px rgba(255, 199, 44, 0.85)) drop-shadow(0 0 14px rgba(255, 199, 44, 0.4))',
                    }}
                />

                <h2 className='text-center'>
                    <NeonTitle keepPulseOnMobile>Classement</NeonTitle>
                </h2>

                <div className='flex w-full max-w-3xl items-center gap-3 px-4'>
                    <div
                        className='h-px flex-1'
                        style={{
                            background:
                                'linear-gradient(to right, transparent, rgba(0, 168, 255, 0.9))',
                            boxShadow: '0 0 6px rgba(0, 168, 255, 0.6)',
                        }}
                    />
                    <span
                        className='text-[0.65rem] uppercase tracking-[0.3em] text-[#00E5FF]'
                        style={{
                            textShadow: '0 0 8px rgba(0, 229, 255, 0.6)',
                        }}
                    >
                        Ligue de Mousse
                    </span>
                    <div
                        className='h-px flex-1'
                        style={{
                            background:
                                'linear-gradient(to left, transparent, rgba(0, 168, 255, 0.9))',
                            boxShadow: '0 0 6px rgba(0, 168, 255, 0.6)',
                        }}
                    />
                </div>
            </div>

            {/* ---- Standings table ---- */}
            {rows.length === 0 ? (
                <p className='flex-1 rounded-lg border border-border bg-card px-3 py-6 text-center text-sm text-muted-foreground'>
                    Aucune donnée de classement pour le moment.
                </p>
            ) : (
                <div
                    className='flex-1 overflow-hidden rounded-lg border'
                    style={{
                        borderColor: CYAN_BORDER,
                        backgroundColor: FRAME_BG,
                        boxShadow: `0 0 22px ${CYAN_GLOW}, inset 0 0 18px rgba(0, 168, 255, 0.08)`,
                    }}
                >
                    {/* ---- Header row ---- */}
                    <div
                        className='grid items-center border-b px-2 py-2.5 text-[0.6rem] sm:text-[0.7rem]'
                        style={{
                            gridTemplateColumns: GRID_COLUMNS,
                            borderColor: 'rgba(0, 168, 255, 0.35)',
                            background:
                                'linear-gradient(180deg, rgba(0, 168, 255, 0.12), rgba(0, 168, 255, 0.02))',
                        }}
                    >
                        <div className='text-center font-semibold uppercase tracking-wider text-[#00E5FF]'>
                            #
                        </div>
                        <div className='pl-1.5 font-semibold uppercase tracking-wider text-[#00E5FF]'>
                            Équipe
                        </div>

                        <ColumnHeader label='GP' key='totalGames' />
                        <ColumnHeader label='3B' key='skaterHatTricks' />
                        <ColumnHeader
                            label='W'
                            key='goalieWins'
                            color={CYAN}
                        />
                        <ColumnHeader
                            label='OTL'
                            key='goalieOvertimeLosses'
                        />
                        <ColumnHeader label='SO' key='goalieShutouts' />
                        <ColumnHeader
                            label='PTS'
                            key='totalPoints'
                            color={CYAN}
                        />
                        <ColumnHeader
                            label='HIER'
                            key='yesterdayFantasyPoints'
                        />
                        <ColumnHeader
                            label='AJD'
                            key='todayFantasyPoints'
                        />
                        <ColumnHeader
                            label='FP'
                            key='totalFantasyPoints'
                            color={GOLD}
                        />
                    </div>

                    {/* ---- Data rows ---- */}
                    <div>
                        {sortedRows.map((row) => {
                            const accent = rankAccent(row.rank);

                            return (
                                <div
                                    key={row.fantasyTeamId}
                                    className='grid items-center border-b border-[#00A8FF]/10 px-2 py-2 text-xs tabular-nums transition-colors last:border-b-0 hover:bg-[#00A8FF]/5 sm:text-sm'
                                    style={{
                                        gridTemplateColumns: GRID_COLUMNS,
                                        borderLeft: `3px solid ${accent.accent}`,
                                        backgroundColor: accent.tint,
                                        boxShadow: `inset 4px 0 10px -6px ${accent.glow}`,
                                    }}
                                >
                                    {/* Rank */}
                                    <div className='text-center'>
                                        <span
                                            className='inline-block text-sm font-bold'
                                            style={{
                                                color: accent.accent,
                                                textShadow: `0 0 8px ${accent.glow}`,
                                            }}
                                        >
                                            {row.rank}
                                        </span>
                                    </div>

                                    {/* Team name */}
                                    <div className='flex min-w-0 items-center pl-1.5'>
                                        <Link
                                            to={`/mon-equipe?teamId=${row.fantasyTeamId}`}
                                            className='truncate text-xs font-semibold text-foreground transition-colors hover:text-[#00E5FF] sm:text-sm'
                                        >
                                            {row.fantasyTeamName}
                                        </Link>
                                    </div>

                                    {/* Stats */}
                                    <div className='text-center text-[#7DD3FC]'>
                                        {row.skaterGamesPlayed +
                                            row.goalieGamesPlayed}
                                    </div>
                                    <div className='text-center text-[#7DD3FC]'>
                                        {row.skaterHatTricks}
                                    </div>
                                    <div
                                        className='text-center font-semibold'
                                        style={{ color: CYAN }}
                                    >
                                        {row.goalieWins}
                                    </div>
                                    <div className='text-center text-[#7DD3FC]'>
                                        {row.goalieOvertimeLosses}
                                    </div>
                                    <div className='text-center text-[#7DD3FC]'>
                                        {row.goalieShutouts}
                                    </div>
                                    <div
                                        className='text-center font-semibold'
                                        style={{ color: CYAN }}
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
                                    <div className='flex items-center justify-center gap-0.5'>
                                        <span
                                            className='text-sm font-bold sm:text-base'
                                            style={{
                                                color: GOLD,
                                                textShadow:
                                                    '0 0 8px rgba(255, 199, 44, 0.6)',
                                            }}
                                        >
                                            {row.totalFantasyPoints}
                                        </span>
                                        <TrendingUp
                                            className='h-3 w-3 opacity-70'
                                            style={{ color: GOLD }}
                                            strokeWidth={2.5}
                                        />
                                    </div>
                                </div>
                            );
                        })}
                    </div>
                </div>
            )}
        </section>
    );
}