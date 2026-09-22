import { useLocation } from 'react-router-dom';

// Widgets are placeholders only: no endpoint exists yet for live games or top scorers.
const PAGE_TITLES: Record<string, string> = {
  '/mon-equipe': 'Mon équipe',
  '/ligue': 'Ligue',
  '/joueurs': 'Joueurs',
  '/admin': 'Admin',
  '/connexion': 'Connexion',
};

export function TopBar() {
  const location = useLocation();
  const title = PAGE_TITLES[location.pathname] ?? 'Ligue Keeper';

  return (
    <div className='flex flex-1 items-center justify-between gap-4'>
      <h1 className='text-lg font-semibold text-foreground'>{title}</h1>
      {location.pathname === '/mon-equipe' && (
        // Placeholder strip: real top-scorer data comes in a later phase.
        <div className='hidden items-center gap-2 md:flex'>
          <span className='text-xs uppercase tracking-wider text-accent-purple'>Top pointeurs</span>
          {[1, 2, 3, 4, 5].map((slot) => (
            <span key={slot} className='rounded-md border border-border bg-card px-3 py-1 text-xs text-muted-foreground'>
              Joueur {slot}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}
