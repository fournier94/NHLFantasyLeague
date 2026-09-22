import { Link, useLocation } from 'react-router-dom';
import { LogIn, ShieldCheck, Trophy, UserSearch, Users } from 'lucide-react';
import {
  Sidebar,
  SidebarContent,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
} from '@/components/ui/sidebar';

// Sidebar entries: French labels, one per route.
const NAV_ITEMS = [
  { to: '/mon-equipe', label: 'Mon équipe', icon: Users },
  { to: '/ligue', label: 'Ligue', icon: Trophy },
  { to: '/joueurs', label: 'Joueurs', icon: UserSearch },
  { to: '/admin', label: 'Admin', icon: ShieldCheck },
  { to: '/connexion', label: 'Connexion', icon: LogIn },
];

export function AppSidebar() {
  const location = useLocation();

  return (
    <Sidebar>
      <SidebarHeader>
        <p className='px-2 py-1 text-sm font-semibold tracking-wide text-primary'>Ligue Keeper</p>
      </SidebarHeader>
      <SidebarContent>
        <SidebarGroup>
          <SidebarGroupLabel>Navigation</SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>
              {NAV_ITEMS.map((item) => {
                // Highlight only the page we are currently on.
                const isActive = location.pathname === item.to;
                return (
                  <SidebarMenuItem key={item.to}>
                    <SidebarMenuButton asChild isActive={isActive} className={isActive ? 'glow-blue text-primary' : ''}>
                      <Link to={item.to}>
                        <item.icon />
                        <span>{item.label}</span>
                      </Link>
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                );
              })}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
      </SidebarContent>
    </Sidebar>
  );
}
