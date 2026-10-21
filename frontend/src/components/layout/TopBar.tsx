import {
    useEffect,
    useRef,
    useState,
    useSyncExternalStore,
} from 'react';
import { createPortal } from 'react-dom';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import {
    CalendarDays,
    Crown,
    Download,
    LogIn,
    LogOut,
    Menu,
    Search,
    ShieldCheck,
    Stethoscope,
    User,
    Users,
    X,
} from 'lucide-react';
import {
    searchPlayers,
    type PlayerSearchResult,
} from '@/api/client';
import { useAuth } from '@/lib/AuthContext';
import {
    Sheet,
    SheetContent,
    SheetHeader,
    SheetTitle,
    SheetTrigger,
} from '@/components/ui/sheet';
import { useAura } from '@/lib/auraContext';
import { usePwaInstall } from '@/lib/pwaInstall';
import { IosShareHint } from '@/components/layout/IosShareHint';
import {
    getMarketplaceNotificationsSnapshot,
    subscribeToMarketplaceNotifications,
} from '@/lib/marketplaceNotificationsStore';
import {
    computeMarketplaceTargetPath,
} from '@/lib/marketplaceNavigationStore';
import {
    auraPulseClass,
    auraPulseStyle,
    auraRangeFor,
    isAuraOff,
    LEAGUE_LOGO_PULSE_PEAK_SCALE,
    LEAGUE_LOGO_PULSE_REST_SCALE,
} from '@/lib/auraConfig';

const NAV_ICON_CLASS =
    'h-6 w-6 max-[400px]:h-5 max-[400px]:w-5';

const MOBILE_NAV_ITEMS = [
    { to: '/mon-equipe', label: 'Mon equipe', icon: Users },
    { to: '/game-day', label: 'Game Day', icon: CalendarDays },
    { to: '/blessures', label: 'Blessures', icon: Stethoscope },
    { to: '/classement', label: 'Classement', icon: Crown },
];

const GOLD = '#FFC72C';
const GAMEDAY_CYAN = '#00E5FF';
const SEARCH_WHITE = '#FFFFFF';
const MARKETPLACE_VIOLET = '#A855F7';
const MARKETPLACE_GREEN = '#22C55E';

const GAMEDAY_AURA = [
    `drop-shadow(0 0 6px rgba(0, 229, 255, 0.85))`,
    `drop-shadow(0 0 14px rgba(0, 229, 255, 0.4))`,
].join(' ');

const STATS_AURA = [
    `drop-shadow(0 0 6px rgba(249, 115, 22, 0.85))`,
    `drop-shadow(0 0 14px rgba(249, 115, 22, 0.4))`,
].join(' ');

const GOLD_AURA = [
    `drop-shadow(0 0 6px rgba(255, 199, 44, 0.85))`,
    `drop-shadow(0 0 14px rgba(255, 199, 44, 0.4))`,
].join(' ');

const SEARCH_AURA = [
    `drop-shadow(0 0 6px rgba(255, 255, 255, 0.85))`,
    `drop-shadow(0 0 14px rgba(255, 255, 255, 0.4))`,
].join(' ');

const MARKETPLACE_AURA = [
    `drop-shadow(0 0 6px rgba(168, 85, 247, 0.85))`,
    `drop-shadow(0 0 14px rgba(168, 85, 247, 0.4))`,
].join(' ');

const INSTALL_BUTTON_STYLE: React.CSSProperties = {
    backgroundColor: '#080D1A',
    border: '2px solid #00C8FF',
    boxShadow: [
        'inset 0 0 0 1px #FFFDF0',
        'inset 0 0 12px rgba(0, 200, 255, 0.55)',
        'inset 0 0 28px rgba(0, 200, 255, 0.15)',
    ].join(', '),
};

const SEARCH_POPUP_STYLE: React.CSSProperties = {
    backgroundColor: '#080D1A',
    border: '2px solid #00C8FF',
    boxShadow: [
        'inset 0 0 0 1px rgba(200, 245, 255, 0.9)',
        'inset 0 0 10px rgba(0, 200, 255, 0.55)',
        'inset 0 0 28px rgba(0, 200, 255, 0.15)',
    ].join(', '),
};

function GameDayIcon({ className = NAV_ICON_CLASS }: { className?: string }) {
    return (
        <svg
            viewBox='2 1 20 20'
            className={className}
            fill='none'
            stroke={GAMEDAY_CYAN}
            strokeWidth='1.9'
            strokeLinecap='round'
            strokeLinejoin='round'
            style={{ filter: GAMEDAY_AURA }}
            aria-hidden='true'
        >
            <path d='M20 3 L12 13 L8 17 Q7 19 5 19 L3 19' />
            <path d='M4 3 L12 13 L16 17 Q17 19 19 19 L21 19' />
            <ellipse cx='12' cy='12.5' rx='3.5' ry='2.2' />
        </svg>
    );
}

function StatsIcon({ className = NAV_ICON_CLASS }: { className?: string }) {
    return (
        <img
            src='/images/league/stats-icon.svg'
            alt=''
            className={className}
            style={{ filter: STATS_AURA }}
            aria-hidden='true'
        />
    );
}

function MarketplaceIcon({ className = NAV_ICON_CLASS }: { className?: string }) {
    return (
        <svg
            viewBox='2 3 20 18'
            className={className}
            fill='none'
            stroke={MARKETPLACE_VIOLET}
            strokeWidth='1.9'
            strokeLinecap='round'
            strokeLinejoin='round'
            style={{ filter: MARKETPLACE_AURA }}
            aria-hidden='true'
        >
            <path d='M4 8 H17' />
            <path d='M14 5 L17 8 L14 11' />
            <path d='M20 16 H7' />
            <path d='M10 13 L7 16 L10 19' />
        </svg>
    );
}

function MarketplaceBadge() {
    const { isAuthenticated } = useAuth();
    if (!isAuthenticated) return null;
    return <MarketplaceBadgeContent />;
}

function MarketplaceBadgeContent() {
    const notifications = useSyncExternalStore(
        subscribeToMarketplaceNotifications,
        getMarketplaceNotificationsSnapshot,
    );

    if (notifications.total <= 0) return null;

    const hasGold =
        notifications.unseenResponses > 0 ||
        notifications.unseenAcceptedSentResponses > 0;

    const backgroundColor = hasGold ? GOLD : MARKETPLACE_GREEN;
    const color = hasGold ? '#000000' : '#04160A';
    const label = notifications.total > 99 ? '99+' : String(notifications.total);

    return (
        <span
            aria-label={`${notifications.total} nouvelle${notifications.total > 1 ? 's' : ''} notification${notifications.total > 1 ? 's' : ''} dans le marché`}
            className='pointer-events-none absolute left-1/2 top-1/2 flex h-5 min-w-5 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full border-2 px-1 text-[0.6rem] font-bold leading-none'
            style={{
                borderColor: '#080D1A',
                backgroundColor,
                color,
            }}
        >
            {label}
        </span>
    );
}

export function TopBar() {
    const location = useLocation();
    const navigate = useNavigate();
    const [mobileOpen, setMobileOpen] = useState(false);

    const {
        user,
        isAuthenticated,
        isCommissioner,
        playerPageStyle,
        updatePlayerPageStyle,
        logout,
    } = useAuth();

    const {
        canInstall,
        isInstalled,
        isIosSafari,
        isFirefox,
        promptInstall,
    } = usePwaInstall();

    const marketplaceNotifications = useSyncExternalStore(
        subscribeToMarketplaceNotifications,
        getMarketplaceNotificationsSnapshot,
    );

    const marketplaceTarget = computeMarketplaceTargetPath(marketplaceNotifications);

    async function handleLogout() {
        await logout();
        setMobileOpen(false);
    }

    const [searchQuery, setSearchQuery] = useState('');
    const [searchResults, setSearchResults] = useState<PlayerSearchResult[]>([]);
    const [searching, setSearching] = useState(false);
    const [searchModalOpen, setSearchModalOpen] = useState(false);
    const searchInputRef = useRef<HTMLInputElement>(null);

    const menuIconAura = useAura('mobileMenuIcon');
    const logoAura = useAura('leagueLogo');

    useEffect(() => {
        const text = searchQuery.trim();
        if (text.length < 2) {
            setSearchResults([]);
            setSearching(false);
            return;
        }

        setSearching(true);
        let cancelled = false;

        const timer = setTimeout(() => {
            searchPlayers(text)
                .then((data) => {
                    if (!cancelled) setSearchResults(data);
                })
                .catch(() => {
                    if (!cancelled) setSearchResults([]);
                })
                .finally(() => {
                    if (!cancelled) setSearching(false);
                });
        }, 300);

        return () => {
            cancelled = true;
            clearTimeout(timer);
        };
    }, [searchQuery]);

    useEffect(() => {
        setSearchQuery('');
        setSearchResults([]);
        setSearchModalOpen(false);
    }, [location.pathname]);

    useEffect(() => {
        if (searchModalOpen && searchInputRef.current) {
            searchInputRef.current.focus();
        }
    }, [searchModalOpen]);

    useEffect(() => {
        if (!searchModalOpen) return;
        function onKeyDown(event: KeyboardEvent) {
            if (event.key === 'Escape') setSearchModalOpen(false);
        }
        document.addEventListener('keydown', onKeyDown);
        return () => document.removeEventListener('keydown', onKeyDown);
    }, [searchModalOpen]);

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

    const logoLayer = (idx: number) => auraRangeFor(logoAura, 'leagueLogo', idx);

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

    function handlePickResult(p: PlayerSearchResult) {
        setSearchModalOpen(false);
        setSearchQuery('');
        setSearchResults([]);
        navigate(`/joueurs/${p.nhlPlayerId}`);
    }

    function closeSearchModal() {
        setSearchModalOpen(false);
        setSearchQuery('');
        setSearchResults([]);
    }

    return (
        <>
            <nav className='relative flex flex-1 items-center justify-between md:justify-start md:gap-x-6'>
                <Link to='/' replace className='mr-2 flex items-center md:mr-0'>
                    <img
                        src='/images/league/logo_07_beaver.png'
                        alt='Ligue Keeper'
                        className={`h-10 w-auto ${!isAuraOff(logoAura) ? `${auraPulseClass('filter')} aura-mobile-keep` : ''}`}
                        style={
                            !isAuraOff(logoAura)
                                ? auraPulseStyle(logoRest, logoPeak)
                                : undefined
                        }
                    />
                </Link>

                <div className='hidden flex-1 items-center justify-around md:flex'>
                    <Link
                        to='/game-day'
                        replace
                        className={`relative flex items-center gap-1.5 text-sm transition-colors ${location.pathname === '/game-day'
                            ? 'font-medium text-primary'
                            : 'text-muted-foreground hover:text-foreground'
                            }`}
                    >
                        <CalendarDays className={NAV_ICON_CLASS} />
                        <span>Game Day</span>
                    </Link>

                    <Link
                        to='/blessures'
                        replace
                        className={`relative flex items-center gap-1.5 text-sm transition-colors ${location.pathname === '/blessures'
                            ? 'font-medium text-primary'
                            : 'text-muted-foreground hover:text-foreground'
                            }`}
                    >
                        <Stethoscope className={NAV_ICON_CLASS} />
                        <span>Blessures</span>
                    </Link>

                    <Link
                        to='/classement'
                        replace
                        className={`relative flex items-center gap-1.5 text-sm transition-colors ${location.pathname === '/classement'
                            ? 'font-medium text-primary'
                            : 'text-muted-foreground hover:text-foreground'
                            }`}
                    >
                        <Crown className={NAV_ICON_CLASS} />
                        <span>Classement</span>
                    </Link>

                    <Link
                        to={marketplaceTarget}
                        replace
                        className={`relative flex items-center gap-1.5 text-sm transition-colors ${location.pathname === '/marketplace'
                            ? 'font-medium text-primary'
                            : 'text-muted-foreground hover:text-foreground'
                            }`}
                    >
                        <span className='relative inline-block h-6 w-6 max-[400px]:h-5 max-[400px]:w-5'>
                            <MarketplaceIcon className='block h-full w-full' />
                            <MarketplaceBadge />
                        </span>
                        <span>Marketplace</span>
                    </Link>

                    <div className='flex items-center gap-4'>
                        {isCommissioner && (
                            <Link
                                to='/admin'
                                replace
                                aria-label='Administration'
                                className={`flex items-center gap-1.5 text-sm transition-colors ${location.pathname === '/admin'
                                    ? 'font-medium text-primary'
                                    : 'text-muted-foreground hover:text-foreground'
                                    }`}
                            >
                                <ShieldCheck className={NAV_ICON_CLASS} />
                                <span>Admin</span>
                            </Link>
                        )}

                        {isAuthenticated && (
                            <Link
                                to='/profil'
                                replace
                                aria-label='Profil'
                                className={`transition-colors ${location.pathname === '/profil'
                                    ? 'text-primary'
                                    : 'text-muted-foreground hover:text-foreground'
                                    }`}
                            >
                                <User className={NAV_ICON_CLASS} />
                            </Link>
                        )}

                        {isAuthenticated && (
                            <span className='text-sm text-foreground'>
                                {user?.displayName ?? user?.userName}
                            </span>
                        )}

                        {!isAuthenticated && (
                            <Link
                                to='/connexion'
                                replace
                                className={`flex items-center gap-1.5 text-sm transition-colors ${location.pathname === '/connexion'
                                    ? 'font-medium text-primary'
                                    : 'text-muted-foreground hover:text-foreground'
                                    }`}
                            >
                                <LogIn className={NAV_ICON_CLASS} />
                                <span>Connexion</span>
                            </Link>
                        )}
                    </div>
                </div>

                <div className='contents md:ml-auto md:flex md:items-center md:gap-5'>
                    <Link
                        to='/statistiques'
                        replace
                        aria-label='Statistiques'
                        onClick={(e) => {
                            if (location.pathname === '/statistiques') {
                                e.preventDefault();
                                navigate('/statistiques', {
                                    state: { resetTab: Date.now() },
                                    replace: true,
                                });
                            }
                        }}
                        className={`cursor-pointer rounded-lg bg-transparent p-2 transition-colors hover:bg-secondary md:hidden ${location.pathname === '/statistiques'
                            ? 'text-primary'
                            : 'text-foreground'
                            }`}
                    >
                        <StatsIcon className={NAV_ICON_CLASS} />
                    </Link>

                    <Link
                        to={marketplaceTarget}
                        replace
                        aria-label='Marketplace'
                        className={`relative cursor-pointer rounded-lg bg-transparent p-2 transition-colors hover:bg-secondary md:hidden ${location.pathname === '/marketplace'
                            ? 'text-primary'
                            : 'text-foreground'
                            }`}
                    >
                        <MarketplaceIcon className={NAV_ICON_CLASS} />
                        <MarketplaceBadge />
                    </Link>

                    <Link
                        to='/game-day'
                        replace
                        aria-label='Game Day'
                        className={`cursor-pointer rounded-lg bg-transparent p-2 transition-colors hover:bg-secondary md:hidden ${location.pathname === '/game-day'
                            ? 'text-primary'
                            : 'text-foreground'
                            }`}
                    >
                        <GameDayIcon className={NAV_ICON_CLASS} />
                    </Link>

                    <Link
                        to='/classement'
                        replace
                        aria-label='Classement'
                        className={`cursor-pointer rounded-lg bg-transparent p-2 transition-colors hover:bg-secondary md:hidden ${location.pathname === '/classement'
                            ? 'text-primary'
                            : 'text-foreground'
                            }`}
                    >
                        <Crown
                            className={NAV_ICON_CLASS}
                            style={{ color: GOLD, filter: GOLD_AURA }}
                        />
                    </Link>

                    <button
                        type='button'
                        aria-label='Rechercher un joueur'
                        onClick={() => setSearchModalOpen(true)}
                        className='cursor-pointer rounded-lg bg-transparent p-2 text-foreground transition-colors hover:bg-secondary'
                    >
                        <Search
                            className={NAV_ICON_CLASS}
                            style={{ color: SEARCH_WHITE, filter: SEARCH_AURA }}
                        />
                    </button>

                    {isAuthenticated && (
                        <button
                            type='button'
                            onClick={handleLogout}
                            className='hidden cursor-pointer items-center gap-1.5 rounded-lg bg-transparent p-2 text-sm text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground md:flex'
                        >
                            <LogOut className={NAV_ICON_CLASS} />
                            <span>Déconnexion</span>
                        </button>
                    )}

                    <Sheet open={mobileOpen} onOpenChange={setMobileOpen}>
                        <SheetTrigger
                            aria-label='Ouvrir le menu de navigation'
                            className='cursor-pointer rounded-lg bg-transparent p-2 text-foreground transition-colors hover:bg-secondary md:hidden'
                        >
                            <Menu
                                className={`${NAV_ICON_CLASS} ${!isAuraOff(menuIconAura) ? `${auraPulseClass('filter')} aura-mobile-keep` : ''} ${!isAuraOff(menuIconAura) ? 'text-[#F2F5FA]' : ''}`}
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
                                {MOBILE_NAV_ITEMS.map((item) => {
                                    const isActive = location.pathname === item.to;
                                    return (
                                        <Link
                                            key={item.to}
                                            to={item.to}
                                            replace
                                            onClick={() => setMobileOpen(false)}
                                            className={`flex items-center gap-2 rounded-lg px-3 py-2 text-sm transition-colors ${isActive
                                                ? 'bg-secondary font-medium text-primary'
                                                : 'text-foreground hover:bg-secondary'
                                                }`}
                                        >
                                            {item.icon && <item.icon className='h-4 w-4' />}
                                            <span>{item.label}</span>
                                        </Link>
                                    );
                                })}

                                <div className='mt-2 border-t border-border pt-2'>
                                    {isCommissioner && (
                                        <Link
                                            to='/admin'
                                            replace
                                            onClick={() => setMobileOpen(false)}
                                            className='flex items-center gap-2 rounded-lg px-3 py-2 text-sm text-foreground hover:bg-secondary'
                                        >
                                            <ShieldCheck className='h-4 w-4' />
                                            <span>Admin</span>
                                        </Link>
                                    )}

                                    {isAuthenticated && (
                                        <div className='mt-2 border-t border-border pt-2'>
                                            <p className='px-3 py-1 text-xs uppercase tracking-wide text-white'>
                                                Style page joueur
                                            </p>
                                            <div className='flex gap-1 px-2 py-1'>
                                                <button
                                                    type='button'
                                                    onClick={() => void updatePlayerPageStyle('Neon')}
                                                    className={`flex-1 cursor-pointer rounded-lg px-3 py-1.5 text-sm font-medium transition-colors ${playerPageStyle === 'Neon'
                                                        ? 'bg-[#00A8FF] text-[#080D1A]'
                                                        : 'bg-transparent text-foreground hover:bg-secondary'
                                                        }`}
                                                >
                                                    Neon
                                                </button>
                                                <button
                                                    type='button'
                                                    onClick={() => void updatePlayerPageStyle('Classic')}
                                                    className={`flex-1 cursor-pointer rounded-lg px-3 py-1.5 text-sm font-medium transition-colors ${playerPageStyle === 'Classic'
                                                        ? 'bg-[#00A8FF] text-[#080D1A]'
                                                        : 'bg-transparent text-foreground hover:bg-secondary'
                                                        }`}
                                                >
                                                    Classic
                                                </button>
                                            </div>
                                        </div>
                                    )}

                                    {isAuthenticated ? (
                                        <button
                                            type='button'
                                            onClick={handleLogout}
                                            className='mt-3 flex w-full cursor-pointer items-center gap-2 rounded-lg px-3 py-2 text-left text-sm text-foreground hover:bg-secondary'
                                        >
                                            <LogOut className='h-4 w-4' />
                                            <span>Déconnexion ({user?.displayName ?? user?.userName})</span>
                                        </button>
                                    ) : (
                                        <>
                                            <Link
                                                to='/connexion'
                                                replace
                                                onClick={() => setMobileOpen(false)}
                                                className='flex items-center gap-2 rounded-lg px-3 py-2 text-sm text-foreground hover:bg-secondary'
                                            >
                                                <LogIn className='h-4 w-4' />
                                                <span>Connexion</span>
                                            </Link>
                                            <Link
                                                to='/inscription'
                                                replace
                                                onClick={() => setMobileOpen(false)}
                                                className='flex items-center gap-2 rounded-lg px-3 py-2 text-sm text-foreground hover:bg-secondary'
                                            >
                                                <User className='h-4 w-4' />
                                                <span>Inscription</span>
                                            </Link>
                                        </>
                                    )}

                                    {!isInstalled && (canInstall || isIosSafari || isFirefox) && (
                                        <div className='mt-3 border-t border-border pt-3'>
                                            {canInstall && (
                                                <button
                                                    type='button'
                                                    onClick={() => void promptInstall()}
                                                    className='flex w-full cursor-pointer flex-col items-center justify-center gap-1.5 rounded-lg px-3 py-3 text-center text-sm font-bold uppercase tracking-wider text-[#F2F5FA] transition-all hover:brightness-110'
                                                    style={INSTALL_BUTTON_STYLE}
                                                >
                                                    <Download className='h-5 w-5 shrink-0' aria-hidden='true' />
                                                    <span className='leading-tight'>Installer l'application</span>
                                                </button>
                                            )}

                                            {!canInstall && isIosSafari && <IosShareHint />}

                                            {!canInstall && isFirefox && (
                                                <div className='rounded-lg px-3 py-2 text-xs'>
                                                    <div className='flex items-center gap-2 text-sm font-bold uppercase tracking-wider text-foreground'>
                                                        <Download className='h-4 w-4 shrink-0' aria-hidden='true' />
                                                        <span className='leading-tight'>Installer l'application</span>
                                                    </div>
                                                    <p className='mt-1 leading-relaxed text-muted-foreground'>
                                                        Ouvrez le menu du navigateur puis choisissez{' '}
                                                        <span className='font-semibold text-foreground'>« Installer »</span>.
                                                    </p>
                                                </div>
                                            )}
                                        </div>
                                    )}
                                </div>
                            </div>
                        </SheetContent>
                    </Sheet>
                </div>
            </nav>

            {searchModalOpen &&
                createPortal(
                    <div
                        className='fixed inset-0 z-[70] flex items-start justify-center bg-black/60 px-4 pt-24 sm:pt-32'
                        onClick={closeSearchModal}
                        role='dialog'
                        aria-modal='true'
                        aria-label='Rechercher un joueur'
                    >
                        <div
                            className='w-full max-w-md overflow-hidden rounded-lg'
                            onClick={(event) => event.stopPropagation()}
                            style={SEARCH_POPUP_STYLE}
                        >
                            <div
                                className='flex items-center gap-2 border-b px-3 py-2.5'
                                style={{
                                    borderColor: 'rgba(0, 168, 255, 0.35)',
                                    background: 'linear-gradient(180deg, rgba(0, 168, 255, 0.12), rgba(0, 168, 255, 0.02))',
                                }}
                            >
                                <Search
                                    className='h-4 w-4 shrink-0'
                                    style={{
                                        color: '#00E5FF',
                                        filter: 'drop-shadow(0 0 6px rgba(0, 229, 255, 0.85)) drop-shadow(0 0 14px rgba(0, 229, 255, 0.4))',
                                    }}
                                />

                                <input
                                    ref={searchInputRef}
                                    type='text'
                                    value={searchQuery}
                                    autoComplete='off'
                                    placeholder='RECHERCHER UN JOUEUR'
                                    onChange={(event) => setSearchQuery(event.target.value)}
                                    className='w-full bg-transparent text-sm font-semibold uppercase tracking-wider text-[#00E5FF] placeholder:text-[#00E5FF]/40 focus:outline-none'
                                    style={{ textShadow: '0 0 8px rgba(0, 229, 255, 0.35)' }}
                                />

                                <button
                                    type='button'
                                    aria-label='Fermer la recherche'
                                    onClick={closeSearchModal}
                                    className='cursor-pointer rounded-md p-1 text-[#00E5FF] transition-colors hover:bg-[#00A8FF]/15'
                                >
                                    <X className='h-4 w-4' />
                                </button>
                            </div>

                            <div className='max-h-80 overflow-y-auto'>
                                {searchQuery.trim().length >= 2 && searching && searchResults.length === 0 && (
                                    <p className='px-3 py-3 text-sm text-muted-foreground'>Recherche...</p>
                                )}

                                {searchQuery.trim().length >= 2 && !searching && searchResults.length === 0 && (
                                    <p className='px-3 py-3 text-sm text-muted-foreground'>Aucun joueur trouvé.</p>
                                )}

                                {searchResults.map((p) => (
                                    <button
                                        key={p.playerId}
                                        type='button'
                                        onClick={() => handlePickResult(p)}
                                        className='flex w-full cursor-pointer items-center justify-between gap-2 border-b px-3 py-2 text-left text-sm transition-colors last:border-b-0 hover:bg-[#00A8FF]/10'
                                        style={{ borderColor: 'rgba(0, 168, 255, 0.12)' }}
                                    >
                                        <span className='truncate font-semibold text-foreground'>
                                            {p.firstName} {p.lastName}
                                        </span>
                                        <span className='shrink-0 text-xs uppercase tracking-wider text-[#7DD3FC]'>
                                            {p.nhlTeamAbbreviation} · {p.position}
                                        </span>
                                    </button>
                                ))}
                            </div>
                        </div>
                    </div>,
                    document.body,
                )}
        </>
    );
}