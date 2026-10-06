import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { Crown, TrendingUp } from 'lucide-react';
import {
    getStandings,
    type StandingsRow,
} from '@/api/client';
import { useAuth } from '@/lib/AuthContext';
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
// Sortable column header
//
// NOTE: the sort field is passed as `sortField`, NOT `key`. React
// reserves `key` for its own reconciliation and never forwards it to
// the component, so reading `props.key` inside a component always
// yields undefined.
// ---------------------------------------------------------------------

function ColumnHeader({
    label,
    sortField,
    activeSortField,
    sortDirection,
    onClick,
    color = CYAN_SOFT,
}: {
    label: string;
    sortField: SortKey;
    activeSortField: SortKey;
    sortDirection: SortDirection;
    onClick: (key: SortKey) => void;
    color?: string;
}) {
    const active = activeSortField === sortField;

    return (
        <button
            type='button'
            onClick={() => onClick(sortField)}
            className={cn(
                'w-full cursor-pointer select-none text-center font-bold uppercase tracking-wider transition-colors hover:text-white',
            )}
            style={{
                color: active ? CYAN : color,
                textShadow: active ? `0 0 8px ${CYAN}AA` : undefined,
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
// Page (Classic design)
// ---------------------------------------------------------------------

export default function ClassementPageClassic() {
    const { user } = useAuth();
    const myTeamId = user?.fantasyTeamId ?? null;

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
                        <div className='text-center font-bold uppercase tracking-wider text-[#00E5FF]'>
                            #
                        </div>
                        <div className='pl-1.5 font-bold uppercase tracking-wider text-[#00E5FF]'>
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
                            label='3B'
                            sortField='skaterHatTricks'
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
                            color={CYAN}
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
                            label='PTS'
                            sortField='totalPoints'
                            activeSortField={sortKey}
                            sortDirection={sortDirection}
                            onClick={handleSort}
                            color={CYAN}
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

                    {/* ---- Data rows ---- */}
                    <div>
                        {sortedRows.map((row) => {
                            const accent = rankAccent(row.rank);
                            const isMine =
                                myTeamId != null &&
                                row.fantasyTeamId === myTeamId;

                            const isFirstPlace = row.rank === 1;

                            return (
                                <div
                                    key={row.fantasyTeamId}
                                    className={cn(
                                        'grid items-center border-b px-2 py-2 text-xs tabular-nums transition-colors last:border-b-0 sm:text-sm',
                                        isMine
                                            ? 'relative z-10 border-[#00E5FF] bg-[#00E5FF]/10'
                                            : 'border-[#00A8FF]/10 hover:bg-[#00A8FF]/5',
                                    )}
                                    style={{
                                        gridTemplateColumns: GRID_COLUMNS,
                                        // Current user row: full cyan
                                        // neon contour on every side.
                                        // Other rows: rank accent left
                                        // border.
                                        ...(isMine
                                            ? {
                                                borderTop:
                                                    '1px solid rgba(0, 229, 255, 0.85)',
                                                borderBottom:
                                                    '1px solid rgba(0, 229, 255, 0.85)',
                                                borderLeft:
                                                    '3px solid #00E5FF',
                                                borderRight:
                                                    '1px solid rgba(0, 229, 255, 0.85)',
                                                boxShadow:
                                                    '0 0 14px rgba(0, 229, 255, 0.75), 0 0 28px rgba(0, 229, 255, 0.35), inset 0 0 24px rgba(0, 229, 255, 0.12)',
                                            }
                                            : {
                                                borderLeft: `3px solid ${accent.accent}`,
                                                backgroundColor:
                                                    accent.tint,
                                                boxShadow: `inset 4px 0 10px -6px ${accent.glow}`,
                                            }),
                                    }}
                                >
                                    {/* Rank cell.
                                        - Rank 1 : gold crown, no number.
                                        - Others : the rank number, in
                                          the cyan accent when the row
                                          belongs to the current user,
                                          otherwise in the rank accent
                                          color. */}
                                    <div className='flex items-center justify-center'>
                                        {isFirstPlace ? (
                                            <Crown
                                                className='h-4 w-4 shrink-0'
                                                strokeWidth={2.5}
                                                style={{
                                                    color: GOLD,
                                                    filter:
                                                        'drop-shadow(0 0 6px rgba(255, 199, 44, 0.9)) drop-shadow(0 0 12px rgba(255, 199, 44, 0.5))',
                                                }}
                                                aria-label='Première place'
                                            />
                                        ) : (
                                            <span
                                                className='inline-block text-sm font-bold'
                                                style={{
                                                    color: isMine
                                                        ? CYAN
                                                        : accent.accent,
                                                    textShadow: isMine
                                                        ? '0 0 10px rgba(0, 229, 255, 0.9)'
                                                        : `0 0 8px ${accent.glow}`,
                                                }}
                                            >
                                                {row.rank}
                                            </span>
                                        )}
                                    </div>

                                    <div className='flex min-w-0 items-center pl-1.5'>
                                        <Link
                                            to={`/mon-equipe?teamId=${row.fantasyTeamId}`}
                                            className={cn(
                                                'truncate transition-colors hover:text-[#00E5FF]',
                                                isMine
                                                    ? 'text-xs font-bold text-white sm:text-sm'
                                                    : 'text-xs font-semibold text-foreground sm:text-sm',
                                            )}
                                            style={
                                                isMine
                                                    ? {
                                                        textShadow:
                                                            '0 0 8px rgba(0, 229, 255, 0.75)',
                                                    }
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
                                        style={{ color: CYAN }}
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
                                        className='text-center font-semibold'
                                        style={{ color: CYAN }}
                                    >
                                        {row.skaterPoints + row.goaliePoints}
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