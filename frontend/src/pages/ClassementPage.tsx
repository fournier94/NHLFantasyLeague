import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { Crown } from 'lucide-react';
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
// Palette — electric blue
// ---------------------------------------------------------------------

const GOLD = '#FFC72C';
const SILVER = '#C0C0C0';
const BRONZE = '#CD7F32';

const ELECTRIC = '#0088FF';
const ELECTRIC_BRIGHT = '#33BBFF';
const ELECTRIC_SOFT = '#7DD3FC';

const GREEN = '#22C55E';
const RED_NEON = '#FF0F3D';
const PINK_NEON = '#FF0066';

const GRID_COLUMNS = '6% 20% repeat(9, calc((100% - 26%) / 9))';

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
// Decorative SVG — jagged red wings flanking the title
// ---------------------------------------------------------------------

function WingRight() {
    return (
        <svg
            viewBox='0 0 140 44'
            width='130'
            height='42'
            aria-hidden='true'
            className='pointer-events-none'
        >
            <defs>
                <linearGradient id='wingR' x1='0' y1='0' x2='1' y2='0'>
                    <stop offset='0%' stopColor={PINK_NEON} stopOpacity='1' />
                    <stop offset='55%' stopColor={RED_NEON} stopOpacity='0.9' />
                    <stop offset='100%' stopColor={RED_NEON} stopOpacity='0.1' />
                </linearGradient>
            </defs>
            <polygon
                points='0,22 16,14 26,24 38,12 48,26 62,10 74,26 86,14 96,24 110,16 140,22 110,28 96,20 86,30 74,16 62,32 48,16 38,30 26,20 16,30 0,22'
                fill='url(#wingR)'
                style={{
                    filter: `drop-shadow(0 0 3px ${PINK_NEON}) drop-shadow(0 0 6px ${RED_NEON})`,
                }}
            />
        </svg>
    );
}

function WingLeft() {
    return (
        <svg
            viewBox='0 0 140 44'
            width='130'
            height='42'
            aria-hidden='true'
            className='pointer-events-none'
            style={{ transform: 'scaleX(-1)' }}
        >
            <defs>
                <linearGradient id='wingL' x1='0' y1='0' x2='1' y2='0'>
                    <stop offset='0%' stopColor={PINK_NEON} stopOpacity='1' />
                    <stop offset='55%' stopColor={RED_NEON} stopOpacity='0.9' />
                    <stop offset='100%' stopColor={RED_NEON} stopOpacity='0.1' />
                </linearGradient>
            </defs>
            <polygon
                points='0,22 16,14 26,24 38,12 48,26 62,10 74,26 86,14 96,24 110,16 140,22 110,28 96,20 86,30 74,16 62,32 48,16 38,30 26,20 16,30 0,22'
                fill='url(#wingL)'
                style={{
                    filter: `drop-shadow(0 0 3px ${PINK_NEON}) drop-shadow(0 0 6px ${RED_NEON})`,
                }}
            />
        </svg>
    );
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
    accent,
    isMine,
}: {
    rank: number;
    accent: string;
    isMine: boolean;
}) {
    if (rank === 1) {
        return (
            <div
                className='relative h-4 w-4 shrink-0'
                aria-label='Première place'
            >
                <Crown
                    className='absolute inset-0 h-4 w-4'
                    strokeWidth={3}
                    style={{ color: GOLD }}
                    fill='none'
                    aria-hidden='true'
                />
                <Crown
                    className='absolute inset-0 h-4 w-4'
                    strokeWidth={1.2}
                    style={{ color: '#FFF4C9' }}
                    fill='none'
                    aria-hidden='true'
                />
            </div>
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
        <section className='flex min-h-full w-full flex-col gap-3'>
            {/* ============================================================
                Header: red wings + crown + neon title + divider
                ============================================================ */}
            <div className='relative flex flex-col items-center gap-1 pb-1'>
                <div className='pointer-events-none absolute inset-x-0 top-[46px] flex items-center justify-center gap-1'>
                    <WingLeft />
                    <WingRight />
                </div>

                <div className='relative z-10'>
                    <span
                        aria-hidden='true'
                        className='pointer-events-none absolute left-1/2 top-1/2 h-12 w-12 -translate-x-1/2 -translate-y-1/2 rounded-full'
                        style={{
                            background: `radial-gradient(circle, rgba(255, 15, 61, 0.45) 0%, rgba(255, 0, 102, 0.15) 55%, transparent 80%)`,
                        }}
                    />
                    <Crown
                        className='relative h-6 w-6'
                        strokeWidth={2.2}
                        style={{
                            color: GOLD,
                            filter: `drop-shadow(0 0 4px rgba(255, 199, 44, 0.9))`,
                        }}
                    />
                </div>

                <h2 className='relative z-10 text-center'>
                    <NeonTitle keepPulseOnMobile>Classement</NeonTitle>
                </h2>

                {/* Divider — matches the reference styling: softer
                    cyan-blue lines with a soft outer glow, and a
                    brighter cyan for the text with a stronger
                    matching text-shadow. */}
                <div className='relative z-10 mt-8 flex w-full max-w-3xl items-center gap-3 px-4'>
                    <div
                        className='h-px flex-1'
                        style={{
                            background:
                                'linear-gradient(to right, transparent, rgba(0, 168, 255, 0.9))',
                            boxShadow: '0 0 6px rgba(0, 168, 255, 0.7)',
                        }}
                    />
                    <span
                        className='text-[0.65rem] uppercase tracking-[0.3em] text-[#00E5FF]'
                        style={{
                            textShadow:
                                '0 0 8px rgba(0, 229, 255, 0.7)',
                        }}
                    >
                        Ligue de Mousse
                    </span>
                    <div
                        className='h-px flex-1'
                        style={{
                            background:
                                'linear-gradient(to left, transparent, rgba(0, 168, 255, 0.9))',
                            boxShadow: '0 0 6px rgba(0, 168, 255, 0.7)',
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
                            color={ELECTRIC_BRIGHT}
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
                                            accent={accent.accent}
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
                                        style={{ color: ELECTRIC_BRIGHT }}
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
        </section>
    );
}