import { useEffect, useState } from 'react';
import { getTeamRoster, type RosterEntry, type TeamRoster } from '@/api/client';
import { PlayerCard } from '@/components/roster/PlayerCard';
import { RosterSection } from '@/components/roster/RosterSection';

// TODO(auth): replace with the signed-in user's fantasy team once
// authentication exists. Team 5 is farn.
const TEMPORARY_TEAM_ID = 5;

// Salary display in the header, e.g. "118 500 000 $".
const salaryFormatter = new Intl.NumberFormat('fr-CA', { maximumFractionDigits: 0 });

/** Returns true when the entry belongs to the active lineup. */
function isActive(entry: RosterEntry): boolean {
  return entry.rosterStatus === 'Active';
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

  return (
    <section className='space-y-6'>
      <div>
        <h2 className='hidden text-2xl font-semibold text-foreground md:block'>
          Mon équipe · {roster.fantasyTeamName}
        </h2>
        <p className='mt-1 text-muted-foreground'>
          {roster.seasonName} · {roster.totalPlayers} joueurs ·{' '}
          {salaryFormatter.format(roster.totalSalary)} $
        </p>
      </div>

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