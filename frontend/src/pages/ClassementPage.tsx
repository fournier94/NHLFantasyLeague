import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { getStandings, type StandingsRow } from '@/api/client';
import { cn } from '@/lib/utils';
import { NeonTitle } from '@/components/ui/NeonTitle';

/**
 * Classement (standings) page.
 *
 * Read-only view of GET /api/Standings. Every number comes from the
 * backend; this page never computes anything except the sort order.
 *
 * HIER / AJD show the FP each team's Active-at-game-time players
 * produced in the games that started yesterday / today.
 *
 * Column order: Rank | Team | GP | 3B | W | OTL | SO | PTS | HIER | AJD | FP
 *
 * Every visible header is clickable and sorts the table. The rank
 * number next to each team does NOT change with the sort: it stays
 * as that team's official season rank (by total FP).
 */

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

export default function ClassementPage() {
    const [rows, setRows] = useState<StandingsRow[]>([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);

    const [sortKey, setSortKey] = useState<SortKey>('totalFantasyPoints');
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
        return <p className='text-muted-foreground'>Chargement...</p>;
    }

    if (error) {
        return <p className='text-destructive'>{error}</p>;
    }

    if (rows.length === 0) {
        return (
            <section className='w-full space-y-4'>
                <h2 className='text-center'>
                    <NeonTitle keepPulseOnMobile>Classement</NeonTitle>
                </h2>
                <p className='text-center text-muted-foreground'>
                    Aucune donnée de classement pour le moment.
                </p>
            </section>
        );
    }

    function renderDailyTotal(value: number) {
        if (value > 0) {
            return <span className='text-[#22C55E]'>+{value}</span>;
        }

        return <span className='text-muted-foreground'>0</span>;
    }

    function renderSortIndicator(key: SortKey) {
        if (sortKey !== key) return null;

        return (
            <span className='ml-1 inline-block text-[0.65rem] align-middle'>
                {sortDirection === 'asc' ? '▲' : '▼'}
            </span>
        );
    }

    const thSortable =
        'px-2 py-3 text-center font-medium cursor-pointer select-none transition-colors hover:text-[#00A8FF]';

    return (
        <section className='w-full space-y-4'>
            <h2 className='text-center'>
                <NeonTitle keepPulseOnMobile>Classement</NeonTitle>
            </h2>

            <div className='w-full rounded-lg border border-border bg-card'>
                <table className='w-full table-fixed text-sm tabular-nums md:text-base'>
                    {/*
                     * 11 columns total.
                     *   - Rank gets 6%.
                     *   - Team gets 20%.
                     *   - The remaining 9 columns share 74% equally
                     *     via calc((100% - 26%) / 9).
                     * This keeps GP, 3B, W, OTL, SO, PTS, HIER, AJD
                     * and FP all exactly the same width.
                     */}
                    <colgroup>
                        <col className='w-[6%]' />
                        <col className='w-[20%]' />
                        <col style={{ width: 'calc((100% - 26%) / 9)' }} />
                        <col style={{ width: 'calc((100% - 26%) / 9)' }} />
                        <col style={{ width: 'calc((100% - 26%) / 9)' }} />
                        <col style={{ width: 'calc((100% - 26%) / 9)' }} />
                        <col style={{ width: 'calc((100% - 26%) / 9)' }} />
                        <col style={{ width: 'calc((100% - 26%) / 9)' }} />
                        <col style={{ width: 'calc((100% - 26%) / 9)' }} />
                        <col style={{ width: 'calc((100% - 26%) / 9)' }} />
                        <col style={{ width: 'calc((100% - 26%) / 9)' }} />
                    </colgroup>

                    <thead className='border-b border-border text-xs uppercase tracking-wide text-foreground'>
                        <tr>
                            <th className='px-2 py-3 text-center' />
                            <th className='px-2 py-3 text-center' />

                            <th
                                className={thSortable}
                                onClick={() => handleSort('totalGames')}
                            >
                                GP
                                {renderSortIndicator('totalGames')}
                            </th>

                            <th
                                className={thSortable}
                                onClick={() => handleSort('skaterHatTricks')}
                            >
                                3B
                                {renderSortIndicator('skaterHatTricks')}
                            </th>

                            <th
                                className={cn(
                                    thSortable,
                                    'text-[#00F0FF] hover:text-white',
                                )}
                                onClick={() => handleSort('goalieWins')}
                            >
                                W
                                {renderSortIndicator('goalieWins')}
                            </th>

                            <th
                                className={thSortable}
                                onClick={() =>
                                    handleSort('goalieOvertimeLosses')
                                }
                            >
                                OTL
                                {renderSortIndicator('goalieOvertimeLosses')}
                            </th>

                            <th
                                className={thSortable}
                                onClick={() => handleSort('goalieShutouts')}
                            >
                                SO
                                {renderSortIndicator('goalieShutouts')}
                            </th>

                            <th
                                className={cn(
                                    thSortable,
                                    'text-[#00F0FF] hover:text-white',
                                )}
                                onClick={() => handleSort('totalPoints')}
                            >
                                PTS
                                {renderSortIndicator('totalPoints')}
                            </th>

                            <th
                                className={cn(
                                    thSortable,
                                    'text-[0.65rem]',
                                )}
                                onClick={() =>
                                    handleSort('yesterdayFantasyPoints')
                                }
                            >
                                HIER
                                {renderSortIndicator('yesterdayFantasyPoints')}
                            </th>

                            <th
                                className={cn(
                                    thSortable,
                                    'text-[0.65rem]',
                                )}
                                onClick={() =>
                                    handleSort('todayFantasyPoints')
                                }
                            >
                                AJD
                                {renderSortIndicator('todayFantasyPoints')}
                            </th>

                            <th
                                className={thSortable}
                                onClick={() =>
                                    handleSort('totalFantasyPoints')
                                }
                            >
                                FP
                                {renderSortIndicator('totalFantasyPoints')}
                            </th>
                        </tr>
                    </thead>
                    <tbody className='text-foreground'>
                        {sortedRows.map((row, index) => {
                            const isFirst = row.rank === 1;
                            const totalGames =
                                row.skaterGamesPlayed + row.goalieGamesPlayed;
                            const totalPoints =
                                row.skaterPoints + row.goaliePoints;

                            return (
                                <tr
                                    key={row.fantasyTeamId}
                                    className={cn(
                                        'border-b border-border/40 last:border-b-0',
                                        index % 2 === 0
                                            ? 'bg-transparent'
                                            : 'bg-secondary/20',
                                    )}
                                >
                                    <td
                                        className={cn(
                                            'px-2 py-3 text-center font-semibold',
                                            isFirst && 'text-[#F59E0B]',
                                        )}
                                    >
                                        {row.rank}
                                    </td>

                                    <td className='px-2 py-3 text-center font-medium'>
                                        <Link
                                            to={`/mon-equipe?teamId=${row.fantasyTeamId}`}
                                            className='transition-colors hover:text-[#00A8FF] hover:underline'
                                        >
                                            {row.fantasyTeamName}
                                        </Link>
                                    </td>

                                    <td className='px-2 py-3 text-center'>
                                        {totalGames}
                                    </td>
                                    <td className='px-2 py-3 text-center'>
                                        {row.skaterHatTricks}
                                    </td>
                                    <td className='px-2 py-3 text-center text-[#00F0FF]'>
                                        {row.goalieWins}
                                    </td>
                                    <td className='px-2 py-3 text-center'>
                                        {row.goalieOvertimeLosses}
                                    </td>
                                    <td className='px-2 py-3 text-center'>
                                        {row.goalieShutouts}
                                    </td>
                                    <td className='px-2 py-3 text-center text-[#00F0FF]'>
                                        {totalPoints}
                                    </td>
                                    <td className='px-2 py-3 text-center'>
                                        {renderDailyTotal(row.yesterdayFantasyPoints)}
                                    </td>
                                    <td className='px-2 py-3 text-center'>
                                        {renderDailyTotal(row.todayFantasyPoints)}
                                    </td>
                                    <td className='px-2 py-3 text-center text-base font-bold text-[#F59E0B] md:text-lg'>
                                        {row.totalFantasyPoints}
                                    </td>
                                </tr>
                            );
                        })}
                    </tbody>
                </table>
            </div>
        </section>
    );
}