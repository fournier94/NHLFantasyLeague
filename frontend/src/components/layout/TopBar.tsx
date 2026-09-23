import { Link, useLocation } from 'react-router-dom';
import { LogIn, ShieldCheck, Trophy, UserSearch, Users } from 'lucide-react';

// Navigation entries: French labels, one per route.
const NAV_ITEMS = [
  { to: '/mon-equipe', label: 'Mon équipe', icon: Users },
  { to: '/ligue', label: 'Ligue', icon: Trophy },
  { to: '/joueurs', label: 'Joueurs', icon: UserSearch },
  { to: '/admin', label: 'Admin', icon: ShieldCheck },
  { to: '/connexion', label: 'Connexion', icon: LogIn },
];

/**
 * Horizontal top navigation: brand on the left, page links after it.
 * The links wrap on narrow screens instead of collapsing into a menu.
 */
export function TopBar() {
  const location = useLocation();

  return (
    <nav className='flex flex-1 flex-wrap items-center gap-x-6 gap-y-2'>
      <span className='whitespace-nowrap text-sm font-semibold tracking-wide text-primary'>
        Ligue Keeper
      </span>

      <div className='flex flex-wrap items-center gap-x-4 gap-y-2'>
        {NAV_ITEMS.map((item) => {
          // Highlight only the page we are currently on.
          const isActive = location.pathname === item.to;
          return (
            <Link
              key={item.to}
              to={item.to}
              className={`flex items-center gap-1.5 text-sm transition-colors ${
                isActive
                  ? 'font-medium text-primary'
                  : 'text-muted-foreground hover:text-foreground'
              }`}
            >
              <item.icon className='h-4 w-4' />
              <span>{item.label}</span>
            </Link>
          );
        })}
      </div>
    </nav>
  );
}
