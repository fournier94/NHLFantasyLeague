import { useEffect, useState } from 'react';
import { getTeamRoster, type RosterEntry, type TeamRoster } from '@/api/client';
import { PlayerCard } from '@/components/roster/PlayerCard';
import { RosterSection } from '@/components/roster/RosterSection';
import { useAura } from '@/lib/auraContext';
import {
    auraPulseClass,
    auraPulseStyle,
    auraRangeFor,
    isAuraOff,
} from '@/lib/auraConfig';

const TEMPORARY_TEAM_ID = 5;

function isActive(entry: RosterEntry): boolean {
    return entry.rosterStatus === 'Active';
}

function capPercentage(capSalary: number, salaryCap: number): number {
    if (salaryCap <= 0) return 0;
    const pct = (capSalary / salaryCap) * 100;
    return Math.max(0, Math.min(100, pct));
}

function trackColorClass(pct: number): string {
    if (pct > 90) return 'bg-rose-500';
    if (pct >= 75) return 'bg-yellow-300';
    return 'bg-lime-400';
}

function compactMillions(value: number): string {
    const millions = value / 1_000_000;
    const rounded = millions.toFixed(2).replace(/\.?0+$/, '');
    return `${rounded}M`;
}

export default function MonEquipePage() {
    const [roster, setRoster] = useState<TeamRoster | null>(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);

    // Single aura around the whole bar. No separate fill slider.
    const trackAura = useAura('capBarTrack');

    useEffect(() => {
        let cancelled = false;

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

        return () => {
            cancelled = true;
        };
    }, []);

    if (loading) return <p className='text-muted-foreground'>Chargement...</p>;
    if (error) return <p className='text-destructive'>{error}</p>;
    if (!roster) return null;

    const forwards = roster.entries.filter(
        (entry) => isActive(entry) && entry.position !== 'D' && entry.position !== 'G',
    );
    const defensemen = roster.entries.filter((entry) => isActive(entry) && entry.position === 'D');
    const goalies = roster.entries.filter((entry) => isActive(entry) && entry.position === 'G');
    const bench = roster.entries.filter((entry) => entry.rosterStatus === 'Bench');
    const prospects = roster.entries.filter((entry) => entry.rosterStatus === 'Prospect');

    const maxSignedPlayers =
        roster.leagueMaximumRosterSize - roster.leagueProspectCount;

    const trackRest = [
        `0 0 ${auraRangeFor(trackAura, 'capBarTrack', 0).toFixed(2)}px rgba(0, 168, 255, 0.7)`,
        `0 0 ${auraRangeFor(trackAura, 'capBarTrack', 1).toFixed(2)}px rgba(0, 168, 255, 0.55)`,
        `0 0 ${auraRangeFor(trackAura, 'capBarTrack', 2).toFixed(2)}px rgba(0, 168, 255, 0.3)`,
    ].join(', ');

    const trackPeak = [
        `0 0 ${auraRangeFor(trackAura, 'capBarTrack', 0).toFixed(2)}px rgba(0, 168, 255, 0.95)`,
        `0 0 ${auraRangeFor(trackAura, 'capBarTrack', 1).toFixed(2)}px rgba(0, 168, 255, 0.75)`,
        `0 0 ${auraRangeFor(trackAura, 'capBarTrack', 2).toFixed(2)}px rgba(0, 168, 255, 0.45)`,
    ].join(', ');

    return (
        <section className='space-y-4'>
            <div>
                <h2 className='hidden text-2xl font-semibold text-foreground md:block'>
                    Mon équipe · {roster.fantasyTeamName}
                </h2>
            </div>

            {roster.futureCapBySeason.length > 0 && (
                <div className='-mt-4 space-y-2'>
                    {roster.futureCapBySeason.map((row) => {
                        const pct = capPercentage(row.capSalary, row.salaryCap);
                        const available = Math.max(0, row.salaryCap - row.capSalary);

                        return (
                            <div key={row.nhlSeasonCode}>
                                <div className='flex items-center gap-3'>
                                    <span className='w-12 shrink-0 text-xs font-medium text-foreground'>
                                        {row.label}
                                    </span>

                                    <div
                                        className={`relative h-3 flex-1 overflow-hidden rounded ${trackColorClass(pct)} ${!isAuraOff(trackAura) ? auraPulseClass('box') : ''}`}
                                        style={
                                            !isAuraOff(trackAura)
                                                ? auraPulseStyle(trackRest, trackPeak)
                                                : undefined
                                        }
                                    >
                                        <div
                                            className='h-full rounded bg-cyan-400 transition-[width]'
                                            style={{ width: `${pct}%` }}
                                        />
                                    </div>
                                </div>

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