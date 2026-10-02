import { useEffect, useState } from 'react';
import { getStandings, type StandingsRow } from '@/api/client';
import { cn } from '@/lib/utils';
import { useAura } from '@/lib/auraContext';
import {
    auraPulseClass,
    auraPulseStyle,
    auraRangeFor,
    isAuraOff,
} from '@/lib/auraConfig';

/**
 * Classement (standings) page.
 *
 * Read-only view of GET /api/Standings. Every number comes from the
 * backend; this page never computes anything. The standings are
 * refreshed by the recompute step of the NHL refresh pipeline.
 *
 * Columns: Rank, Team, GP (skaters + goalies), PTS (skater points +
 * goalie points), 3B (skater hat tricks), W / OTL / SO (goalies),
 * and FP (the total that decides the standings).
 *
 * Every cell and header is centered.
 */
export default function ClassementPage() {
    const [rows, setRows] = useState<StandingsRow[]>([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);

    const titleAura = useAura('rosterSectionTitle');

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
                    setError(
                        'Vérifiez que le serveur API est démarré.',
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
    }, []);

    const titleRest = [
        `0 0 ${auraRangeFor(titleAura, 'rosterSectionTitle', 0).toFixed(2)}px #F2F5FA`,
        `0 0 ${auraRangeFor(titleAura, 'rosterSectionTitle', 1).toFixed(2)}px #00A8FF`,
        `0 0 ${auraRangeFor(titleAura, 'rosterSectionTitle', 2).toFixed(2)}px rgba(0, 168, 255, 0.5)`,
        `0 0 ${auraRangeFor(titleAura, 'rosterSectionTitle', 3).toFixed(2)}px rgba(0, 168, 255, 0.25)`,
    ].join(', ');

    const titlePeak = [
        `0 0 ${auraRangeFor(titleAura, 'rosterSectionTitle', 0).toFixed(2)}px #F2F5FA`,
        `0 0 ${auraRangeFor(titleAura, 'rosterSectionTitle', 1).toFixed(2)}px #00A8FF`,
        `0 0 ${auraRangeFor(titleAura, 'rosterSectionTitle', 2).toFixed(2)}px rgba(0, 168, 255, 0.65)`,
        `0 0 ${auraRangeFor(titleAura, 'rosterSectionTitle', 3).toFixed(2)}px rgba(0, 168, 255, 0.4)`,
    ].join(', ');

    if (loading) {
        return <p className='text-muted-foreground'>Chargement...</p>;
    }

    if (error) {
        return <p className='text-destructive'>{error}</p>;
    }

    if (rows.length === 0) {
        return (
            <section className='w-full space-y-4'>
                <h2 className='text-center text-2xl font-semibold text-foreground'>
                    Classement
                </h2>
                <p className='text-center text-muted-foreground'>
                    Aucune donnée de classement pour le moment.
                </p>
            </section>
        );
    }

    return (
        <section className='w-full space-y-4'>
            <h2
                className={cn(
                    'text-center text-2xl font-semibold text-white',
                    !isAuraOff(titleAura) ? auraPulseClass('text') : '',
                )}
                style={
                    !isAuraOff(titleAura)
                        ? auraPulseStyle(titleRest, titlePeak)
                        : undefined
                }
            >
                Classement
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
                                        {row.fantasyTeamName}
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