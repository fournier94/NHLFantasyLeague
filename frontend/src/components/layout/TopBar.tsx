import { useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import {
    Bell,
    LogIn,
    Menu,
    MessageSquare,
    ShieldCheck,
    Trophy,
    User,
    Users,
} from 'lucide-react';
import {
    Sheet,
    SheetContent,
    SheetHeader,
    SheetTitle,
    SheetTrigger,
} from '@/components/ui/sheet';
import { useAura } from '@/lib/auraContext';
import {
    auraLerp,
    auraPulseClass,
    auraPulseStyle,
    auraRangeFor,
    isAuraOff,
    LEAGUE_LOGO_PULSE_PEAK_SCALE,
    LEAGUE_LOGO_PULSE_REST_SCALE,
} from '@/lib/auraConfig';

const NAV_ITEMS = [
    { to: '/mon-equipe', label: 'Mon equipe', icon: Users },
    { to: '/classement', label: 'Classement', icon: Trophy },
    { to: '/stats', label: 'Stats', icon: Trophy },
    { to: '/transactions', label: 'Transactions', icon: null },
];

export function TopBar() {
    const location = useLocation();
    const currentPage = NAV_ITEMS.find((item) => item.to === location.pathname)?.label;
    const [mobileOpen, setMobileOpen] = useState(false);

    const titleAura = useAura('mobilePageTitle');
    const menuIconAura = useAura('mobileMenuIcon');
    const logoAura = useAura('leagueLogo');

    // --- Mobile page title ---------------------------------------------
    const titleRest = [
        `0 0 ${auraRangeFor(titleAura, 'mobilePageTitle', 0).toFixed(2)}px #F2F5FA`,
        `0 0 ${auraRangeFor(titleAura, 'mobilePageTitle', 1).toFixed(2)}px #00A8FF`,
        `0 0 ${auraRangeFor(titleAura, 'mobilePageTitle', 2).toFixed(2)}px rgba(0, 168, 255, 0.7)`,
        `0 0 ${auraRangeFor(titleAura, 'mobilePageTitle', 3).toFixed(2)}px rgba(0, 168, 255, 0.4)`,
    ].join(', ');

    const titlePeak = [
        `0 0 ${auraRangeFor(titleAura, 'mobilePageTitle', 0).toFixed(2)}px #F2F5FA`,
        `0 0 ${auraRangeFor(titleAura, 'mobilePageTitle', 1).toFixed(2)}px #00A8FF`,
        `0 0 ${auraRangeFor(titleAura, 'mobilePageTitle', 2).toFixed(2)}px #00A8FF`,
        `0 0 ${auraRangeFor(titleAura, 'mobilePageTitle', 3).toFixed(2)}px rgba(0, 168, 255, 0.9)`,
        `0 0 ${auraLerp(titleAura, 30, 50).toFixed(2)}px rgba(0, 168, 255, 0.6)`,
    ].join(', ');

    // --- Mobile menu icon ----------------------------------------------
    const menuRest = [
        `drop-shadow(0 0 ${auraRangeFor(menuIconAura, 'mobileMenuIcon', 0).toFixed(2)}px #F2F5FA)`,
        `drop-shadow(0 0 ${auraRangeFor(menuIconAura, 'mobileMenuIcon', 1).toFixed(2)}px #00A8FF)`,
        `drop-shadow(0 0 ${auraRangeFor(menuIconAura, 'mobileMenuIcon', 2).toFixed(2)}px #00A8FF)`,
        `drop-shadow(0 0 ${auraRangeFor(menuIconAura, 'mobileMenuIcon', 3).toFixed(2)}px rgba(0, 168, 255, 0.5))`,
    ].join(' ');

    const menuPeak = [
        `drop-shadow(0 0 ${auraRangeFor(menuIconAura, 'mobileMenuIcon', 0).toFixed(2)}px #F2F5FA)`,
        `drop-shadow(0 0 ${auraRangeFor(menuIconAura, 'mobileMenuIcon', 1).toFixed(2)}px #00A8FF)`,
        `drop-shadow(0 0 ${auraRangeFor(menuIconAura, 'mobileMenuIcon', 2).toFixed(2)}px #00A8FF)`,
        `drop-shadow(0 0 ${auraRangeFor(menuIconAura, 'mobileMenuIcon', 3).toFixed(2)}px rgba(0, 168, 255, 0.8))`,
    ].join(' ');

    // --- League logo ----------------------------------------------------
    // Compute the base layer sizes once (at the current intensity), then
    // scale them for the pulse endpoints. The rest endpoint is tiny
    // (LEAGUE_LOGO_PULSE_REST_SCALE) so the aura almost vanishes; the
    // peak endpoint is larger (LEAGUE_LOGO_PULSE_PEAK_SCALE) so the pulse
    // is very visible. Only the logo uses these scales.
    const logoLayer = (idx: number) =>
        auraRangeFor(logoAura, 'leagueLogo', idx);

    const logoRest = [
        `drop-shadow(0 0 ${(logoLayer(0) * LEAGUE_LOGO_PULSE_REST_SCALE).toFixed(2)}px #F2F5FA)`,
        `drop-shadow(0 0 ${(logoLayer(1) * LEAGUE_LOGO_PULSE_REST_SCALE).toFixed(2)}px #00A8FF)`,
        `drop-shadow(0 0 ${(logoLayer(2) * LEAGUE_LOGO_PULSE_REST_SCALE).toFixed(2)}px #00A8FF)`,
        `drop-shadow(0 0 ${(logoLayer(3) * LEAGUE_LOGO_PULSE_REST_SCALE).toFixed(2)}px rgba(0, 168, 255, 0.4))`,
    ].join(' ');

    const logoPeak = [
        `drop-shadow(0 0 ${(logoLayer(0) * LEAGUE_LOGO_PULSE_PEAK_SCALE).toFixed(2)}px #F2F5FA)`,
        `drop-shadow(0 0 ${(logoLayer(1) * LEAGUE_LOGO_PULSE_PEAK_SCALE).toFixed(2)}px #00A8FF)`,
        `drop-shadow(0 0 ${(logoLayer(2) * LEAGUE_LOGO_PULSE_PEAK_SCALE).toFixed(2)}px #00A8FF)`,
        `drop-shadow(0 0 ${(logoLayer(3) * LEAGUE_LOGO_PULSE_PEAK_SCALE).toFixed(2)}px rgba(0, 168, 255, 0.5))`,
    ].join(' ');

    return (
        <nav className='relative flex flex-1 flex-wrap items-center gap-x-6 gap-y-2'>
            <Link to='/' className='flex items-center'>
                <img
                    src='/images/league/logo_07_beaver.png'
                    alt='Ligue Keeper'
                    className={`h-10 w-auto ${!isAuraOff(logoAura) ? auraPulseClass('filter') : ''}`}
                    style={
                        !isAuraOff(logoAura)
                            ? auraPulseStyle(logoRest, logoPeak)
                            : undefined
                    }
                />
            </Link>

            {currentPage && (
                <span
                    className={`mobile-page-title absolute left-1/2 -translate-x-1/2 text-3xl text-foreground md:hidden ${!isAuraOff(titleAura) ? auraPulseClass('text') : ''}`}
                    style={
                        !isAuraOff(titleAura)
                            ? auraPulseStyle(titleRest, titlePeak)
                            : undefined
                    }
                >
                    {currentPage}
                </span>
            )}

            <div className='hidden flex-1 items-center justify-around md:flex'>
                {NAV_ITEMS.map((item) => {
                    const isActive = location.pathname === item.to;

                    return (
                        <Link
                            key={item.to}
                            to={item.to}
                            className={`relative flex items-center gap-1.5 text-sm transition-colors ${isActive
                                ? 'font-medium text-primary'
                                : 'text-muted-foreground hover:text-foreground'
                                }`}
                        >
                            {item.icon && <item.icon className='h-4 w-4' />}
                            <span>{item.label}</span>

                            {item.to === '/transactions' && (
                                <span
                                    className='h-2 w-2 rounded-full bg-primary'
                                    aria-label='Nouvelle activité'
                                />
                            )}
                        </Link>
                    );
                })}

                <div className='flex items-center gap-4'>
                    <Link
                        to='/admin'
                        aria-label='Administration'
                        className={`flex items-center gap-1.5 text-sm transition-colors ${location.pathname === '/admin'
                            ? 'font-medium text-primary'
                            : 'text-muted-foreground hover:text-foreground'
                            }`}
                    >
                        <ShieldCheck className='h-4 w-4' />
                        <span>Admin</span>
                    </Link>

                    <Link
                        to='/messages'
                        aria-label='Messages'
                        className={`relative transition-colors ${location.pathname === '/messages'
                            ? 'text-primary'
                            : 'text-muted-foreground hover:text-foreground'
                            }`}
                    >
                        <MessageSquare className='h-5 w-5' />
                    </Link>

                    <Link
                        to='/notifications'
                        aria-label='Notifications'
                        className={`relative transition-colors ${location.pathname === '/notifications'
                            ? 'text-primary'
                            : 'text-muted-foreground hover:text-foreground'
                            }`}
                    >
                        <Bell className='h-5 w-5' />
                    </Link>

                    <Link
                        to='/profil'
                        aria-label='Profil'
                        className={`transition-colors ${location.pathname === '/profil'
                            ? 'text-primary'
                            : 'text-muted-foreground hover:text-foreground'
                            }`}
                    >
                        <User className='h-5 w-5' />
                    </Link>

                    <Link
                        to='/connexion'
                        className={`flex items-center gap-1.5 text-sm transition-colors ${location.pathname === '/connexion'
                            ? 'font-medium text-primary'
                            : 'text-muted-foreground hover:text-foreground'
                            }`}
                    >
                        <LogIn className='h-4 w-4' />
                        <span>Connexion</span>
                    </Link>
                </div>
            </div>

            <Sheet open={mobileOpen} onOpenChange={setMobileOpen}>
                <SheetTrigger
                    aria-label='Ouvrir le menu de navigation'
                    className='ml-auto cursor-pointer rounded-lg bg-transparent p-2 text-foreground transition-colors hover:bg-secondary md:hidden'
                >
                    <Menu
                        className={`h-5 w-5 ${!isAuraOff(menuIconAura) ? auraPulseClass('filter') : ''} ${!isAuraOff(menuIconAura) ? 'text-[#F2F5FA]' : ''}`}
                        style={
                            !isAuraOff(menuIconAura)
                                ? auraPulseStyle(menuRest, menuPeak)
                                : undefined
                        }
                    />
                </SheetTrigger>

                <SheetContent side='left' className='w-64'>
                    <SheetHeader>
                        <SheetTitle>Navigation</SheetTitle>
                    </SheetHeader>

                    <div className='flex flex-col gap-1 p-4 pt-0'>
                        {NAV_ITEMS.map((item) => {
                            const isActive = location.pathname === item.to;

                            return (
                                <Link
                                    key={item.to}
                                    to={item.to}
                                    onClick={() => setMobileOpen(false)}
                                    className={`flex items-center gap-2 rounded-lg px-3 py-2 text-sm transition-colors ${isActive
                                        ? 'bg-secondary font-medium text-primary'
                                        : 'text-foreground hover:bg-secondary'
                                        }`}
                                >
                                    {item.icon && <item.icon className='h-4 w-4' />}
                                    <span>{item.label}</span>

                                    {item.to === '/transactions' && (
                                        <span
                                            className='ml-auto h-2 w-2 rounded-full bg-primary'
                                            aria-label='Nouvelle activité'
                                        />
                                    )}
                                </Link>
                            );
                        })}

                        <div className='mt-2 border-t border-border pt-2'>
                            <Link
                                to='/messages'
                                onClick={() => setMobileOpen(false)}
                                className='flex items-center gap-2 rounded-lg px-3 py-2 text-sm text-foreground hover:bg-secondary'
                            >
                                <MessageSquare className='h-4 w-4' />
                                <span>Messages</span>
                            </Link>

                            <Link
                                to='/notifications'
                                onClick={() => setMobileOpen(false)}
                                className='flex items-center gap-2 rounded-lg px-3 py-2 text-sm text-foreground hover:bg-secondary'
                            >
                                <Bell className='h-4 w-4' />
                                <span>Notifications</span>
                            </Link>

                            <Link
                                to='/profil'
                                onClick={() => setMobileOpen(false)}
                                className='flex items-center gap-2 rounded-lg px-3 py-2 text-sm text-foreground hover:bg-secondary'
                            >
                                <User className='h-4 w-4' />
                                <span>Profil</span>
                            </Link>

                            <Link
                                to='/connexion'
                                onClick={() => setMobileOpen(false)}
                                className='flex items-center gap-2 rounded-lg px-3 py-2 text-sm text-foreground hover:bg-secondary'
                            >
                                <LogIn className='h-4 w-4' />
                                <span>Connexion / Inscription</span>
                            </Link>
                        </div>
                    </div>
                </SheetContent>
            </Sheet>
        </nav>
    );
}