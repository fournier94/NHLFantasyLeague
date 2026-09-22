import { useEffect, useState } from 'react';
import { getLeague, getLeagueTeams, type FantasyTeam, type League } from '@/api/client';

export default function LiguePage() {
  const [league, setLeague] = useState<League | null>(null);
  const [teams, setTeams] = useState<FantasyTeam[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    // Runs once, when the page is first opened.
    Promise.all([getLeague(), getLeagueTeams()])
      .then(([leagueData, teamData]) => {
        setLeague(leagueData);
        setTeams(teamData);
      })
      .catch(() => setError('Vérifiez que le serveur API est démarré.'));
  }, []);

  if (error) return <p className='text-destructive'>{error}</p>;
  if (!league) return <p className='text-muted-foreground'>Chargement...</p>;

  return (
    <section>
      <h2 className='text-2xl font-semibold text-foreground'>{league.name}</h2>
      <p className='mt-2 text-muted-foreground'>{teams.length} équipes</p>
      <ul className='mt-4 flex flex-wrap gap-2'>
        {teams.map((team) => (
          <li key={team.id} className='rounded-md border border-border bg-card px-3 py-1 text-sm text-foreground'>
            {team.name}
          </li>
        ))}
      </ul>
    </section>
  );
}
