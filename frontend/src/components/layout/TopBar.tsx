import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import {
    CalendarDays,
    LogIn,
    LogOut,
    Menu,
    Search,
    ShieldCheck,
    Stethoscope,
    Trophy,
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
import {
    auraPulseClass,
    auraPulseStyle,
    auraRangeFor,
    isAuraOff,
    LEAGUE_LOGO_PULSE_PEAK_SCALE,
    LEAGUE_LOGO_PULSE_REST_SCALE,
} from '@/lib/auraConfig';

// ---------------------------------------------------------------------
// Single size knob for every non-logo icon in the top bar.
//
// Change this one constant to scale every icon (mobile shortcuts,
// search, hamburger, desktop nav links, profil) at once. The league
// logo is intentionally excluded: it keeps its own fixed h-10 size.
//
// Responsive via Tailwind variants. Tiers are stacked so the
// tightest match wins:
//   h-6 w-6                   -> default (>= 400px)
//   max-[400px]:h-5 w-5       -> under 400px
//
// Adjust the pixel values or add more tiers as needed. Nothing here
// uses JavaScript; Tailwind compiles this into plain @media rules.
// ---------------------------------------------------------------------
const NAV_ICON_CLASS =
    'h-6 w-6 max-[400px]:h-5 max-[400px]:w-5';

/** Nav items rendered inside the mobile hamburger. */
const MOBILE_NAV_ITEMS = [
    { to: '/mon-equipe', label: 'Mon equipe', icon: Users },
    { to: '/game-day', label: 'Game Day', icon: CalendarDays },
    { to: '/blessures', label: 'Blessures', icon: Stethoscope },
    { to: '/classement', label: 'Classement', icon: Trophy },
];

/** Colors used for the mobile shortcut icons. */
const GOLD = '#FFC72C';
const GAMEDAY_CYAN = '#00E5FF';
const INJURY_RED = '#EF4444';
const SEARCH_WHITE = '#FFFFFF';
const MARKETPLACE_VIOLET = '#A855F7';

/**
 * Two-layer glow, matching the crown effect on the Classement page:
 *
 *   drop-shadow(0 0 6px  rgba(color, 0.85))   <- inner, tight
 *   drop-shadow(0 0 14px rgba(color, 0.4))    <- outer, soft bloom
 */

const GAMEDAY_AURA = [
    `drop-shadow(0 0 6px rgba(0, 229, 255, 0.85))`,
    `drop-shadow(0 0 14px rgba(0, 229, 255, 0.4))`,
].join(' ');

const INJURY_AURA = [
    `drop-shadow(0 0 6px rgba(239, 68, 68, 0.85))`,
    `drop-shadow(0 0 14px rgba(239, 68, 68, 0.4))`,
].join(' ');

const TROPHY_AURA = [
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

/**
 * Crossed hockey sticks with a puck, drawn as a small inline SVG.
 * Cyan neon look to match the reference image.
 */
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

/**
 * Red cross used on the mobile nav for the Blessures page.
 */
function InjuryIcon({ className = NAV_ICON_CLASS }: { className?: string }) {
    return (
        <svg
            viewBox='1.5 1.5 21 21'
            className={className}
            xmlns='http://www.w3.org/2000/svg'
            style={{ filter: INJURY_AURA }}
            aria-hidden='true'
        >
            <rect x='9' y='3' width='6' height='18' fill={INJURY_RED} />
            <rect x='3' y='9' width='18' height='6' fill={INJURY_RED} />
        </svg>
    );
}

/**
 * Marketplace icon: two horizontal arrows facing opposite directions.
 * viewBox is cropped (2 3 20 18) so the arrows fill the icon box the
 * same way GameDayIcon's puck and sticks fill theirs.
 */
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
            {/* Top arrow, pointing right */}
            <path d='M4 8 H17' />
            <path d='M14 5 L17 8 L14 11' />

            {/* Bottom arrow, pointing left */}
            <path d='M20 16 H7' />
            <path d='M10 13 L7 16 L10 19' />
        </svg>
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

    async function handleLogout() {
        await logout();
        setMobileOpen(false);
    }

    // Player search state
    const [searchQuery, setSearchQuery] = useState('');
    const [searchResults, setSearchResults] = useState<PlayerSearchResult[]>([]);
    const [searching, setSearching] = useState(false);
    const [searchModalOpen, setSearchModalOpen] = useState(false);
    const searchInputRef = useRef<HTMLInputElement>(null);

    const menuIconAura = useAura('mobileMenuIcon');
    const logoAura = useAura('leagueLogo');

    // --- Player search: debounced fetch --------------------------------
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
                    if (!cancelled) {
                        setSearchResults(data);
                    }
                })
                .catch(() => {
                    if (!cancelled) {
                        setSearchResults([]);
                    }
                })
                .finally(() => {
                    if (!cancelled) {
                        setSearching(false);
                    }
                });
        }, 300);

        return () => {
            cancelled = true;
            clearTimeout(timer);
        };
    }, [searchQuery]);

    // --- Player search: reset on route change --------------------------
    useEffect(() => {
        setSearchQuery('');
        setSearchResults([]);
        setSearchModalOpen(false);
    }, [location.pathname]);

    // --- Search modal: focus input when opened ------------------------
    useEffect(() => {
        if (searchModalOpen && searchInputRef.current) {
            searchInputRef.current.focus();
        }
    }, [searchModalOpen]);

    // --- Search modal: close on Escape --------------------------------
    useEffect(() => {
        if (!searchModalOpen) return;

        function onKeyDown(event: KeyboardEvent) {
            if (event.key === 'Escape') {
                setSearchModalOpen(false);
            }
        }

        document.addEventListener('keydown', onKeyDown);

        return () => {
            document.removeEventListener('keydown', onKeyDown);
        };
    }, [searchModalOpen]);

    // --- Mobile menu icon aura ----------------------------------------
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

    // --- League logo --------------------------------------------------
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
            <nav className='relative flex flex-1 items-center gap-x-6'>
                <Link to='/' className='flex items-center'>
                    {/* League logo: FIXED size. Never touched by
                        NAV_ICON_CLASS. */}
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

                {/*
                 * Desktop nav.
                 */}
                <div className='hidden flex-1 items-center justify-around md:flex'>
                    <Link
                        to='/game-day'
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
                        className={`relative flex items-center gap-1.5 text-sm transition-colors ${location.pathname === '/classement'
                            ? 'font-medium text-primary'
                            : 'text-muted-foreground hover:text-foreground'
                            }`}
                    >
                        <Trophy className={NAV_ICON_CLASS} />
                        <span>Classement</span>
                    </Link>

                    <Link
                        to='/marketplace'
                        className={`relative flex items-center gap-1.5 text-sm transition-colors ${location.pathname === '/marketplace'
                            ? 'font-medium text-primary'
                            : 'text-muted-foreground hover:text-foreground'
                            }`}
                    >
                        <MarketplaceIcon className={NAV_ICON_CLASS} />
                        <span>Marketplace</span>
                    </Link>

                    <div className='flex items-center gap-4'>
                        {isCommissioner && (
                            <Link
                                to='/admin'
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

                {/*
                 * Right-aligned group: mobile shortcut icons
                 * (Blessures, Marketplace, Game Day, Classement)
                 * + Search + Déconnexion (desktop) + Hamburger
                 * (mobile).
                 *
                 * Gap is slightly tighter on mobile (gap-3) than
                 * on tablet+ (gap-5) so the six icons fit on a
                 * 375px phone while still having breathing room.
                 */}
                <div className='ml-auto flex items-center gap-3 md:gap-5'>
                    {/* Blessures shortcut — mobile only. */}
                    <Link
                        to='/blessures'
                        aria-label='Blessures'
                        className={`cursor-pointer rounded-lg bg-transparent p-2 transition-colors hover:bg-secondary md:hidden ${location.pathname === '/blessures'
                            ? 'text-primary'
                            : 'text-foreground'
                            }`}
                    >
                        <InjuryIcon className={NAV_ICON_CLASS} />
                    </Link>

                    {/* Marketplace shortcut — mobile only. */}
                    <Link
                        to='/marketplace'
                        aria-label='Marketplace'
                        className={`cursor-pointer rounded-lg bg-transparent p-2 transition-colors hover:bg-secondary md:hidden ${location.pathname === '/marketplace'
                            ? 'text-primary'
                            : 'text-foreground'
                            }`}
                    >
                        <MarketplaceIcon className={NAV_ICON_CLASS} />
                    </Link>

                    {/* Game Day shortcut — mobile only. */}
                    <Link
                        to='/game-day'
                        aria-label='Game Day'
                        className={`cursor-pointer rounded-lg bg-transparent p-2 transition-colors hover:bg-secondary md:hidden ${location.pathname === '/game-day'
                            ? 'text-primary'
                            : 'text-foreground'
                            }`}
                    >
                        <GameDayIcon className={NAV_ICON_CLASS} />
                    </Link>

                    {/* Golden Classement shortcut — mobile only. */}
                    <Link
                        to='/classement'
                        aria-label='Classement'
                        className={`cursor-pointer rounded-lg bg-transparent p-2 transition-colors hover:bg-secondary md:hidden ${location.pathname === '/classement'
                            ? 'text-primary'
                            : 'text-foreground'
                            }`}
                    >
                        <Trophy
                            className={NAV_ICON_CLASS}
                            style={{
                                color: GOLD,
                                filter: TROPHY_AURA,
                            }}
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
                            style={{
                                color: SEARCH_WHITE,
                                filter: SEARCH_AURA,
                            }}
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
                                                    onClick={() => {
                                                        void updatePlayerPageStyle('Neon');
                                                    }}
                                                    className={`flex-1 cursor-pointer rounded-lg px-3 py-1.5 text-sm font-medium transition-colors ${playerPageStyle === 'Neon'
                                                        ? 'bg-[#00A8FF] text-[#080D1A]'
                                                        : 'bg-transparent text-foreground hover:bg-secondary'
                                                        }`}
                                                >
                                                    Neon
                                                </button>

                                                <button
                                                    type='button'
                                                    onClick={() => {
                                                        void updatePlayerPageStyle('Classic');
                                                    }}
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
                                                onClick={() => setMobileOpen(false)}
                                                className='flex items-center gap-2 rounded-lg px-3 py-2 text-sm text-foreground hover:bg-secondary'
                                            >
                                                <LogIn className='h-4 w-4' />
                                                <span>Connexion</span>
                                            </Link>

                                            <Link
                                                to='/inscription'
                                                onClick={() => setMobileOpen(false)}
                                                className='flex items-center gap-2 rounded-lg px-3 py-2 text-sm text-foreground hover:bg-secondary'
                                            >
                                                <User className='h-4 w-4' />
                                                <span>Inscription</span>
                                            </Link>
                                        </>
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
                            className='w-full max-w-md overflow-hidden rounded-lg border'
                            onClick={(event) => event.stopPropagation()}
                            style={{
                                borderColor: 'rgba(0, 168, 255, 0.6)',
                                backgroundColor: '#080D1A',
                                boxShadow:
                                    '0 0 22px rgba(0, 168, 255, 0.35), inset 0 0 18px rgba(0, 168, 255, 0.08)',
                            }}
                        >
                            <div
                                className='flex items-center gap-2 border-b px-3 py-2.5'
                                style={{
                                    borderColor: 'rgba(0, 168, 255, 0.35)',
                                    background:
                                        'linear-gradient(180deg, rgba(0, 168, 255, 0.12), rgba(0, 168, 255, 0.02))',
                                }}
                            >
                                <Search
                                    className='h-4 w-4 shrink-0'
                                    style={{
                                        color: '#00E5FF',
                                        filter:
                                            'drop-shadow(0 0 6px rgba(0, 229, 255, 0.85)) drop-shadow(0 0 14px rgba(0, 229, 255, 0.4))',
                                    }}
                                />

                                <input
                                    ref={searchInputRef}
                                    type='text'
                                    value={searchQuery}
                                    autoComplete='off'
                                    placeholder='RECHERCHER UN JOUEUR'
                                    onChange={(event) =>
                                        setSearchQuery(event.target.value)
                                    }
                                    className='w-full bg-transparent text-sm font-semibold uppercase tracking-wider text-[#00E5FF] placeholder:text-[#00E5FF]/40 focus:outline-none'
                                    style={{
                                        textShadow:
                                            '0 0 8px rgba(0, 229, 255, 0.35)',
                                    }}
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
                                {searchQuery.trim().length >= 2 &&
                                    searching &&
                                    searchResults.length === 0 && (
                                        <p className='px-3 py-3 text-sm text-muted-foreground'>
                                            Recherche...
                                        </p>
                                    )}

                                {searchQuery.trim().length >= 2 &&
                                    !searching &&
                                    searchResults.length === 0 && (
                                        <p className='px-3 py-3 text-sm text-muted-foreground'>
                                            Aucun joueur trouvé.
                                        </p>
                                    )}

                                {searchResults.map((p) => (
                                    <button
                                        key={p.playerId}
                                        type='button'
                                        onClick={() => handlePickResult(p)}
                                        className='flex w-full cursor-pointer items-center justify-between gap-2 border-b px-3 py-2 text-left text-sm transition-colors last:border-b-0 hover:bg-[#00A8FF]/10'
                                        style={{
                                            borderColor:
                                                'rgba(0, 168, 255, 0.12)',
                                        }}
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