import { useEffect, useState } from 'react';
import { getTeamRoster, type RosterEntry, type TeamRoster } from '@/api/client';
import { PlayerCard } from '@/components/roster/PlayerCard';
import { RosterSection } from '@/components/roster/RosterSection';

// TODO(auth): replace with the signed-in user's fantasy team once
// authentication exists. Team 5 is farn.
const TEMPORARY_TEAM_ID = 5;

/** Returns true when the entry belongs to the active lineup. */
function isActive(entry: RosterEntry): boolean {
    return entry.rosterStatus === 'Active';
}

/**
 * Percentage of the cap used, clamped to [0, 100]. Used to size the
 * filled bar and to pick the track color.
 */
function capPercentage(capSalary: number, salaryCap: number): number {
    if (salaryCap <= 0) return 0;
    const pct = (capSalary / salaryCap) * 100;
    return Math.max(0, Math.min(100, pct));
}

/**
 * Track color, based on the percentage of cap used:
 *   > 90%    -> neon red
 *   75-90%   -> neon yellow
 *   < 75%    -> neon green
 */
function trackColorClass(pct: number): string {
    if (pct > 90) return 'bg-rose-500';
    if (pct >= 75) return 'bg-yellow-300';
    return 'bg-lime-400';
}

/**
 * Compact millions label for a dollar amount:
 *   4 000 000  -> "4M"
 *   4 150 000  -> "4.15M"
 *   950 000    -> "0.95M"
 *   24 900 000 -> "24.9M"
 * Trailing zeros and a trailing decimal point are removed.
 */
function compactMillions(value: number): string {
    const millions = value / 1_000_000;
    const rounded = millions.toFixed(2).replace(/\.?0+$/, '');
    return `${rounded}M`;
}

export default function MonEquipePage() {
    const [roster, setRoster] = useState<TeamRoster | null>(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);

    useEffect(() => {
        let cancelled = false;

        // Runs once, when the page is first opened.
        getTeamRoster(TEMPORARY_TEAM_ID)
            .then((data) => {
                if (!cancelled) {
                    setRoster(data);
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

        // Avoid setting state after unmount (React StrictMode mounts twice in dev).
        return () => {
            cancelled = true;
        };
    }, []);

    if (loading) return <p className='text-muted-foreground'>Chargement...</p>;
    if (error) return <p className='text-destructive'>{error}</p>;
    if (!roster) return null;

    // No re-sort: the API already returns the desired order.
    const forwards = roster.entries.filter(
        (entry) => isActive(entry) && entry.position !== 'D' && entry.position !== 'G',
    );
    const defensemen = roster.entries.filter((entry) => isActive(entry) && entry.position === 'D');
    const goalies = roster.entries.filter((entry) => isActive(entry) && entry.position === 'G');
    const bench = roster.entries.filter((entry) => entry.rosterStatus === 'Bench');
    const prospects = roster.entries.filter((entry) => entry.rosterStatus === 'Prospect');

    // Max signed players = total roster size minus the prospect slots.
    const maxSignedPlayers =
        roster.leagueMaximumRosterSize - roster.leagueProspectCount;

    return (
        <section className='space-y-4'>
            <div>
                <h2 className='hidden text-2xl font-semibold text-foreground md:block'>
                    Mon équipe · {roster.fantasyTeamName}
                </h2>
            </div>

            {/* Cap projection: current season + next four, based on the
          contracts already in the system. Sits directly on the page
          background, no wrapper card. */}
            {roster.futureCapBySeason.length > 0 && (
                <div className='-mt-4 space-y-2'>
                    {roster.futureCapBySeason.map((row) => {
                        const pct = capPercentage(row.capSalary, row.salaryCap);
                        const available = Math.max(0, row.salaryCap - row.capSalary);

                        return (
                            <div key={row.nhlSeasonCode}>
                                {/* Year on the left, bar on the right. */}
                                <div className='flex items-center gap-3'>
                                    <span className='w-12 shrink-0 text-xs font-medium text-foreground'>
                                        {row.label}
                                    </span>

                                    <div
                                        className={`relative h-3 flex-1 overflow-hidden rounded ${trackColorClass(pct)} shadow-[0_0_8px_rgba(0,168,255,1),0_0_20px_rgba(0,168,255,0.85),0_0_36px_rgba(0,168,255,0.55)]`}
                                    >
                                        <div
                                            className='h-full rounded bg-cyan-400 shadow-[0_0_8px_rgba(34,211,238,1),0_0_18px_rgba(34,211,238,0.8)] transition-[width]'
                                            style={{ width: `${pct}%` }}
                                        />
                                    </div>
                                </div>

                                {/* Labels under the bar: signed on the left,
                    available cap on the right. The left padding matches
                    the year column so the labels line up under the bar. */}
                                <div className='mt-1 flex items-center justify-between pl-15 text-xs text-white'>
                                    <span>
                                        {maxSignedPlayers > 0
                                            ? `${row.signedPlayers}/${maxSignedPlayers} sous contrats`
                                            : `${row.signedPlayers} sous contrats`}
                                    </span>

                                    <span>
                                        {available > 0
                                            ? `${compactMillions(available)} $ disponible`
                                            : '0 $ disponible'}
                                    </span>
                                </div>
                            </div>
                        );
                    })}
                </div>
            )}

            <RosterSection title='Attaquants' count={forwards.length}>
                <div className='grid grid-cols-1 gap-3 md:grid-cols-3'>
                    {forwards.map((entry) => (
                        <PlayerCard key={entry.id} entry={entry} />
                    ))}
                </div>
            </RosterSection>

            <RosterSection title='Défenseurs' count={defensemen.length}>
                <div className='mx-auto grid w-full grid-cols-1 gap-3 md:w-2/3 md:grid-cols-2'>
                    {defensemen.map((entry) => (
                        <PlayerCard key={entry.id} entry={entry} />
                    ))}
                </div>
            </RosterSection>

            <RosterSection title='Gardiens' count={goalies.length}>
                <div className='flex justify-center'>
                    {goalies.map((entry) => (
                        <PlayerCard
                            key={entry.id}
                            entry={entry}
                            className='w-full md:w-1/3 md:min-w-[260px]'
                        />
                    ))}
                </div>
            </RosterSection>

            <RosterSection title='Banc' count={bench.length}>
                <div className='grid grid-cols-1 gap-3 md:grid-cols-3'>
                    {bench.map((entry) => (
                        <PlayerCard key={entry.id} entry={entry} />
                    ))}
                </div>
            </RosterSection>

            <RosterSection title='Prospects' count={prospects.length}>
                <div className='grid grid-cols-1 gap-3 md:grid-cols-3'>
                    {prospects.map((entry) => (
                        <PlayerCard key={entry.id} entry={entry} />
                    ))}
                </div>
            </RosterSection>
        </section>
    );
}