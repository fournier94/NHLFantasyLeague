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
// Palette
// ---------------------------------------------------------------------

const GOLD = '#FFC72C';
const SILVER = '#C0C0C0';
const BRONZE = '#CD7F32';
const CYAN = '#00E5FF';
const CYAN_DEEP = '#00A8FF';
const CYAN_SOFT = '#7DD3FC';
const GREEN = '#22C55E';
const RED_NEON = '#FF0F3D';
const PINK_NEON = '#FF0066';

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
            tint: 'rgba(255, 199, 44, 0.08)',
            glow: 'rgba(255, 199, 44, 0.6)',
        };
    }
    if (rank === 2) {
        return {
            accent: SILVER,
            tint: 'rgba(192, 192, 192, 0.06)',
            glow: 'rgba(192, 192, 192, 0.45)',
        };
    }
    if (rank === 3) {
        return {
            accent: BRONZE,
            tint: 'rgba(205, 127, 50, 0.07)',
            glow: 'rgba(205, 127, 50, 0.45)',
        };
    }
    return {
        accent: CYAN_DEEP,
        tint: undefined,
        glow: 'rgba(0, 168, 255, 0.35)',
    };
}

function renderDailyTotal(value: number) {
    if (value > 0) {
        return (
            <span
                className='font-semibold'
                style={{
                    color: GREEN,
                    textShadow: '0 0 6px rgba(34, 197, 94, 0.6)',
                }}
            >
                +{value}
            </span>
        );
    }
    return <span className='text-muted-foreground'>0</span>;
}

// ---------------------------------------------------------------------
// Decorative SVG — jagged red "wings" flanking the title
// ---------------------------------------------------------------------

function WingRight() {
    return (
        <svg
            viewBox='0 0 120 40'
            width='110'
            height='38'
            aria-hidden='true'
            className='pointer-events-none'
        >
            <defs>
                <linearGradient id='wingR' x1='0' y1='0' x2='1' y2='0'>
                    <stop offset='0%' stopColor={PINK_NEON} stopOpacity='1' />
                    <stop offset='60%' stopColor={RED_NEON} stopOpacity='0.85' />
                    <stop offset='100%' stopColor={RED_NEON} stopOpacity='0.1' />
                </linearGradient>
            </defs>
            <polygon
                points='0,20 14,14 22,22 32,12 40,24 52,10 62,24 72,14 82,22 96,16 120,20 96,24 82,18 72,26 62,16 52,30 40,16 32,28 22,18 14,26 0,20'
                fill='url(#wingR)'
                style={{
                    filter: `drop-shadow(0 0 4px ${PINK_NEON}) drop-shadow(0 0 10px ${RED_NEON})`,
                }}
            />
        </svg>
    );
}

function WingLeft() {
    return (
        <svg
            viewBox='0 0 120 40'
            width='110'
            height='38'
            aria-hidden='true'
            className='pointer-events-none'
            style={{ transform: 'scaleX(-1)' }}
        >
            <defs>
                <linearGradient id='wingL' x1='0' y1='0' x2='1' y2='0'>
                    <stop offset='0%' stopColor={PINK_NEON} stopOpacity='1' />
                    <stop offset='60%' stopColor={RED_NEON} stopOpacity='0.85' />
                    <stop offset='100%' stopColor={RED_NEON} stopOpacity='0.1' />
                </linearGradient>
            </defs>
            <polygon
                points='0,20 14,14 22,22 32,12 40,24 52,10 62,24 72,14 82,22 96,16 120,20 96,24 82,18 72,26 62,16 52,30 40,16 32,28 22,18 14,26 0,20'
                fill='url(#wingL)'
                style={{
                    filter: `drop-shadow(0 0 4px ${PINK_NEON}) drop-shadow(0 0 10px ${RED_NEON})`,
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
            style={{ filter: `drop-shadow(0 0 3px ${color})` }}
        >
            <path d='M3 17 L9 11 L13 15 L21 6' />
            <path d='M15 6 L21 6 L21 12' />
        </svg>
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
            className='w-full cursor-pointer select-none text-center font-bold uppercase tracking-wider transition-colors hover:text-white'
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
// Corner accent for the table frame
// ---------------------------------------------------------------------

function CornerAccent({
    position,
}: {
    position: 'tl' | 'tr' | 'bl' | 'br';
}) {
    const map: Record<
        typeof position,
        { top?: number; bottom?: number; left?: number; right?: number; rotate: number }
    > = {
        tl: { top: -1, left: -1, rotate: 0 },
        tr: { top: -1, right: -1, rotate: 90 },
        bl: { bottom: -1, left: -1, rotate: -90 },
        br: { bottom: -1, right: -1, rotate: 180 },
    };

    const p = map[position];

    return (
        <span
            aria-hidden='true'
            className='pointer-events-none absolute block'
            style={{
                width: 14,
                height: 14,
                top: p.top,
                bottom: p.bottom,
                left: p.left,
                right: p.right,
                transform: `rotate(${p.rotate}deg)`,
            }}
        >
            <svg viewBox='0 0 14 14' width='14' height='14'>
                <path
                    d='M0 0 L14 0 L14 2 L2 2 L2 14 L0 14 Z'
                    fill={CYAN}
                    style={{
                        filter: `drop-shadow(0 0 4px ${CYAN})`,
                    }}
                />
            </svg>
        </span>
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
                {/* Red jagged wings flanking the title. Visible on
                    every screen size — the left one is offset to keep
                    the layout balanced under the crown. */}
                <div className='pointer-events-none absolute inset-x-0 top-[44px] flex items-center justify-center gap-2'>
                    <WingLeft />
                    <WingRight />
                </div>

                {/* Crown with a red radial glow behind it */}
                <div className='relative z-10'>
                    <span
                        aria-hidden='true'
                        className='pointer-events-none absolute left-1/2 top-1/2 h-14 w-14 -translate-x-1/2 -translate-y-1/2 rounded-full'
                        style={{
                            background: `radial-gradient(circle, rgba(255, 15, 61, 0.55) 0%, rgba(255, 0, 102, 0.25) 45%, transparent 75%)`,
                            filter: 'blur(4px)',
                        }}
                    />
                    <Crown
                        className='relative h-6 w-6'
                        strokeWidth={2.2}
                        style={{
                            color: GOLD,
                            filter:
                                `drop-shadow(0 0 5px ${GOLD}) ` +
                                `drop-shadow(0 0 12px rgba(255, 199, 44, 0.6)) ` +
                                `drop-shadow(0 0 20px rgba(255, 15, 61, 0.5))`,
                        }}
                    />
                </div>

                <h2 className='relative z-10 text-center'>
                    <NeonTitle keepPulseOnMobile>Classement</NeonTitle>
                </h2>

                {/* Divider */}
                <div className='relative z-10 flex w-full max-w-3xl items-center gap-3 px-4'>
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
                            textShadow: '0 0 8px rgba(0, 229, 255, 0.7)',
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
                    {/* Red streaks behind the table frame, extending
                        out to the sides. Purely decorative. */}
                    <span
                        aria-hidden='true'
                        className='pointer-events-none absolute left-0 top-1/3 h-8 w-6 rounded-r-full opacity-70'
                        style={{
                            background: `linear-gradient(to right, ${RED_NEON}, transparent)`,
                            filter: `blur(6px)`,
                        }}
                    />
                    <span
                        aria-hidden='true'
                        className='pointer-events-none absolute right-0 top-1/2 h-8 w-6 rounded-l-full opacity-70'
                        style={{
                            background: `linear-gradient(to left, ${RED_NEON}, transparent)`,
                            filter: `blur(6px)`,
                        }}
                    />

                    <div
                        className='relative overflow-hidden rounded-lg border-2'
                        style={{
                            borderColor: CYAN,
                            backgroundColor: '#05080F',
                            boxShadow:
                                `0 0 12px ${CYAN}, ` +
                                `0 0 32px ${CYAN_DEEP}, ` +
                                `0 0 64px rgba(0, 168, 255, 0.35), ` +
                                `inset 0 0 24px rgba(0, 168, 255, 0.15)`,
                        }}
                    >
                        {/* Corner accents — small triangles that
                            read as decorative mounting brackets. */}
                        <CornerAccent position='tl' />
                        <CornerAccent position='tr' />
                        <CornerAccent position='bl' />
                        <CornerAccent position='br' />

                        {/* ---- Header row ---- */}
                        <div
                            className='grid items-center border-b px-2 py-2.5 text-[0.6rem] sm:text-[0.7rem]'
                            style={{
                                gridTemplateColumns: GRID_COLUMNS,
                                borderColor:
                                    'rgba(0, 168, 255, 0.5)',
                                background:
                                    'linear-gradient(180deg, rgba(0, 168, 255, 0.18), rgba(0, 168, 255, 0.02))',
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
                                            'relative grid items-center border-b px-2 py-1.5 text-xs tabular-nums transition-colors last:border-b-0 sm:py-2 sm:text-sm',
                                            isMine
                                                ? 'z-10 border-[#00E5FF]'
                                                : 'border-[rgba(255,0,102,0.15)]',
                                        )}
                                        style={{
                                            gridTemplateColumns:
                                                GRID_COLUMNS,
                                            ...(isMine
                                                ? {
                                                    backgroundColor:
                                                        'rgba(0, 229, 255, 0.12)',
                                                    borderTop:
                                                        '1px solid rgba(0, 229, 255, 0.85)',
                                                    borderBottom:
                                                        '1px solid rgba(0, 229, 255, 0.85)',
                                                    borderLeft:
                                                        '3px solid #00E5FF',
                                                    borderRight:
                                                        '1px solid rgba(0, 229, 255, 0.85)',
                                                    boxShadow:
                                                        '0 0 14px rgba(0, 229, 255, 0.8), 0 0 28px rgba(0, 229, 255, 0.4), inset 0 0 24px rgba(0, 229, 255, 0.15)',
                                                }
                                                : {
                                                    background:
                                                        accent.tint
                                                            ? `linear-gradient(to right, ${accent.tint} 0%, transparent 60%)`
                                                            : undefined,
                                                    borderLeft: `4px solid ${accent.accent}`,
                                                    boxShadow: `inset 6px 0 12px -8px ${accent.glow}`,
                                                }),
                                        }}
                                    >
                                        {/* Rank cell */}
                                        <div className='flex items-center justify-center'>
                                            {isFirstPlace ? (
                                                <Crown
                                                    className='h-4 w-4 shrink-0'
                                                    strokeWidth={2.5}
                                                    style={{
                                                        color: GOLD,
                                                        filter:
                                                            `drop-shadow(0 0 5px rgba(255, 199, 44, 0.95)) ` +
                                                            `drop-shadow(0 0 10px rgba(255, 199, 44, 0.55))`,
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

                                        {/* Team cell: name only */}
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
                                                                '0 0 8px rgba(0, 229, 255, 0.8)',
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
                                                style={{
                                                    color: GOLD,
                                                    textShadow:
                                                        '0 0 8px rgba(255, 199, 44, 0.7)',
                                                }}
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
                </div>
            )}
        </section>
    );
}