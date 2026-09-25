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

// Navigation entries: French labels, one per main route.
const NAV_ITEMS = [
    { to: '/mon-equipe', label: 'Mon equipe', icon: Users },
    { to: '/classement', label: 'Classement', icon: Trophy },
    { to: '/stats', label: 'Stats', icon: Trophy },
    { to: '/transactions', label: 'Transactions', icon: null },
];

/**
 * Horizontal top navigation: logo on the left, page links across the
 * remaining desktop space, and user actions on the right.
 *
 * On phones the links and user actions hide behind a hamburger menu.
 * On desktop the full navigation is displayed.
 */
export function TopBar() {
    const location = useLocation();

    // Current page label for the mobile top bar.
    const currentPage = NAV_ITEMS.find((item) => item.to === location.pathname)?.label;

    // Controlled so a link click can close the drawer after navigating.
    const [mobileOpen, setMobileOpen] = useState(false);

    return (
        <nav className='relative flex flex-1 flex-wrap items-center gap-x-6 gap-y-2'>
            {/* League logo - clicking it returns to the dashboard. */}
            <Link to='/' className='flex items-center'>
                <img
                    src='/images/league/logo_07_beaver.png'
                    alt='Ligue Keeper'
                    className='h-10 w-auto'
                />
            </Link>

            {/* Mobile current page title. */}
            {currentPage && (
                <span className='mobile-page-title absolute left-1/2 -translate-x-1/2 text-3xl text-foreground md:hidden'>
                    {currentPage}
                </span>
            )}

            {/* Desktop navigation - hidden on phones. */}
            <div className='hidden flex-1 items-center justify-around md:flex'>
                {NAV_ITEMS.map((item) => {
                    const isActive = location.pathname === item.to;

                    return (
                        <Link
                            key={item.to}
                            to={item.to}
                            className={`relative flex items - center gap - 1.5 text - sm transition - colors ${isActive
                                    ? 'font-medium text-primary'
                                    : 'text-muted-foreground hover:text-foreground'
                                } `}
                        >
                            {item.icon && <item.icon className='h-4 w-4' />}
                            <span>{item.label}</span>

                            {/* Placeholder attention indicator for transactions. */}
                            {item.to === '/transactions' && (
                                <span
                                    className='h-2 w-2 rounded-full bg-primary'
                                    aria-label='Nouvelle activité'
                                />
                            )}
                        </Link>
                    );
                })}

                {/* Desktop user actions. */}
                <div className='flex items-center gap-4'>
                    {/* Admin */}
                    <Link
                        to='/admin'
                        aria-label='Administration'
                        className={`flex items - center gap - 1.5 text - sm transition - colors ${location.pathname === '/admin'
                                ? 'font-medium text-primary'
                                : 'text-muted-foreground hover:text-foreground'
                            } `}
                    >
                        <ShieldCheck className='h-4 w-4' />
                        <span>Admin</span>
                    </Link>

                    {/* Messages */}
                    <Link
                        to='/messages'
                        aria-label='Messages'
                        className={`relative transition - colors ${location.pathname === '/messages'
                                ? 'text-primary'
                                : 'text-muted-foreground hover:text-foreground'
                            } `}
                    >
                        <MessageSquare className='h-5 w-5' />
                    </Link>

                    {/* Notifications */}
                    <Link
                        to='/notifications'
                        aria-label='Notifications'
                        className={`relative transition - colors ${location.pathname === '/notifications'
                                ? 'text-primary'
                                : 'text-muted-foreground hover:text-foreground'
                            } `}
                    >
                        <Bell className='h-5 w-5' />
                    </Link>

                    {/* User profile */}
                    <Link
                        to='/profil'
                        aria-label='Profil'
                        className={`transition - colors ${location.pathname === '/profil'
                                ? 'text-primary'
                                : 'text-muted-foreground hover:text-foreground'
                            } `}
                    >
                        <User className='h-5 w-5' />
                    </Link>

                    {/* Login / Register while logged out. */}
                    <Link
                        to='/connexion'
                        className={`flex items - center gap - 1.5 text - sm transition - colors ${location.pathname === '/connexion'
                                ? 'font-medium text-primary'
                                : 'text-muted-foreground hover:text-foreground'
                            } `}
                    >
                        <LogIn className='h-4 w-4' />
                        <span>Connexion</span>
                    </Link>
                </div>
            </div>

            {/* Mobile menu - hamburger opens a drawer with the same navigation. */}
            <Sheet open={mobileOpen} onOpenChange={setMobileOpen}>
                <SheetTrigger
                    aria-label='Ouvrir le menu de navigation'
                    className='ml-auto cursor-pointer rounded-lg border border-border bg-card p-2 text-foreground transition-colors hover:bg-secondary md:hidden'
                >
                    <Menu className='h-5 w-5' />
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
                                    className={`flex items - center gap - 2 rounded - lg px - 3 py - 2 text - sm transition - colors ${isActive
                                            ? 'bg-secondary font-medium text-primary'
                                            : 'text-foreground hover:bg-secondary'
                                        } `}
                                >
                                    {item.icon && <item.icon className='h-4 w-4' />}
                                    <span>{item.label}</span>

                                    {/* Placeholder attention indicator for transactions. */}
                                    {item.to === '/transactions' && (
                                        <span
                                            className='ml-auto h-2 w-2 rounded-full bg-primary'
                                            aria-label='Nouvelle activité'
                                        />
                                    )}
                                </Link>
                            );
                        })}

                        {/* Mobile user actions. */}
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