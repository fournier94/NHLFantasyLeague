import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { getStandings, type StandingsRow } from '@/api/client';
import { cn } from '@/lib/utils';
import { NeonTitle } from '@/components/ui/NeonTitle';

/**
 * Classement (standings) page.
 *
 * Read-only view of GET /api/Standings. Every number comes from the
 * backend; this page never computes anything. The standings are
 * refreshed by the recompute step of the NHL refresh pipeline.
 *
 * Team names are clickable and open that team's page via
 * /mon-equipe?teamId=X, the same read-only view that PlayerPage
 * links to when a player is on someone else's roster.
 */
export default function ClassementPage() {
    const [rows, setRows] = useState<StandingsRow[]>([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);

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
                    <NeonTitle>Classement</NeonTitle>
                </h2>
                <p className='text-center text-muted-foreground'>
                    Aucune donnée de classement pour le moment.
                </p>
            </section>
        );
    }

    return (
        <section className='w-full space-y-4'>
            <h2 className='text-center'>
                <NeonTitle>Classement</NeonTitle>
            </h2>

            <div className='w-full rounded-lg border border-border bg-card'>
                <table className='w-full table-fixed text-sm tabular-nums md:text-base'>
                    <colgroup>
                        <col className='w-[7%]' />
                        <col className='w-[20%]' />
                        <col className='w-[9%]' />
                        <col className='w-[9%]' />
                        <col className='w-[9%]' />
                        <col className='w-[9%]' />
                        <col className='w-[9%]' />
                        <col className='w-[9%]' />
                        <col className='w-[19%]' />
                    </colgroup>

                    <thead className='border-b border-border text-xs uppercase tracking-wide text-foreground'>
                        <tr>
                            <th className='px-2 py-3 text-center' />
                            <th className='px-2 py-3 text-center font-medium'>Team</th>
                            <th className='px-2 py-3 text-center font-medium'>GP</th>
                            <th className='px-2 py-3 text-center font-medium'>PTS</th>
                            <th className='px-2 py-3 text-center font-medium'>3B</th>
                            <th className='px-2 py-3 text-center font-medium'>W</th>
                            <th className='px-2 py-3 text-center font-medium'>OTL</th>
                            <th className='px-2 py-3 text-center font-medium'>SO</th>
                            <th className='px-2 py-3 text-center font-medium'>FP</th>
                        </tr>
                    </thead>
                    <tbody className='text-foreground'>
                        {rows.map((row, index) => {
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
                                    <td className='px-2 py-3 text-center text-[#00F0FF]'>
                                        {totalPoints}
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