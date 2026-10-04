import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import {
    LogIn,
    LogOut,
    Menu,
    Search,
    ShieldCheck,
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

/** Nav items rendered inside the mobile hamburger. */
const MOBILE_NAV_ITEMS = [
    { to: '/mon-equipe', label: 'Mon equipe', icon: Users },
    { to: '/classement', label: 'Classement', icon: Trophy },
];

/** Color used for the golden Classement shortcut icon. */
const GOLD = '#FFC72C';

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

    // --- Golden trophy aura -------------------------------------------
    // Fixed, not tied to the aura system: this is a small shortcut
    // icon, not a user-tunable element. Three layers of gold at
    // decreasing opacity sell the "glowing medal" look.
    const trophyAura = [
        `drop-shadow(0 0 3px rgba(255, 199, 44, 0.95))`,
        `drop-shadow(0 0 6px rgba(255, 199, 44, 0.6))`,
        `drop-shadow(0 0 10px rgba(255, 184, 0, 0.35))`,
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
                 * Desktop nav. Reduced to Classement + Admin +
                 * Profil + username. Déconnexion lives in the
                 * right-side group next to the search icon.
                 */}
                <div className='hidden flex-1 items-center justify-around md:flex'>
                    <Link
                        to='/classement'
                        className={`relative flex items-center gap-1.5 text-sm transition-colors ${location.pathname === '/classement'
                            ? 'font-medium text-primary'
                            : 'text-muted-foreground hover:text-foreground'
                            }`}
                    >
                        <Trophy className='h-4 w-4' />
                        <span>Classement</span>
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
                                <ShieldCheck className='h-4 w-4' />
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
                                <User className='h-5 w-5' />
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
                                <LogIn className='h-4 w-4' />
                                <span>Connexion</span>
                            </Link>
                        )}
                    </div>
                </div>

                {/*
                 * Right-aligned group: Trophy (mobile) + Search +
                 * Déconnexion (desktop) + Hamburger (mobile).
                 * gap-3 gives each icon 12px of breathing room.
                 */}
                <div className='ml-auto flex items-center gap-3'>
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
                            className='h-5 w-5'
                            style={{
                                color: GOLD,
                                filter: trophyAura,
                            }}
                        />
                    </Link>

                    <button
                        type='button'
                        aria-label='Rechercher un joueur'
                        onClick={() => setSearchModalOpen(true)}
                        className='cursor-pointer rounded-lg bg-transparent p-2 text-foreground transition-colors hover:bg-secondary'
                    >
                        <Search className='h-5 w-5' />
                    </button>

                    {isAuthenticated && (
                        <button
                            type='button'
                            onClick={handleLogout}
                            className='hidden cursor-pointer items-center gap-1.5 rounded-lg bg-transparent p-2 text-sm text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground md:flex'
                        >
                            <LogOut className='h-4 w-4' />
                            <span>Déconnexion</span>
                        </button>
                    )}

                    <Sheet open={mobileOpen} onOpenChange={setMobileOpen}>
                        <SheetTrigger
                            aria-label='Ouvrir le menu de navigation'
                            className='cursor-pointer rounded-lg bg-transparent p-2 text-foreground transition-colors hover:bg-secondary md:hidden'
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

            {/* Search modal — portaled to document.body so it lives
                outside the header's stacking context. */}
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
                            className='w-full max-w-md rounded-lg border border-border bg-card shadow-2xl'
                            onClick={(event) => event.stopPropagation()}
                        >
                            <div className='flex items-center gap-2 border-b border-border px-3 py-2'>
                                <Search className='h-4 w-4 shrink-0 text-muted-foreground' />

                                <input
                                    ref={searchInputRef}
                                    type='text'
                                    value={searchQuery}
                                    autoComplete='off'
                                    placeholder='Rechercher un joueur'
                                    onChange={(event) =>
                                        setSearchQuery(event.target.value)
                                    }
                                    className='w-full bg-transparent text-sm text-foreground placeholder:text-muted-foreground focus:outline-none'
                                />

                                <button
                                    type='button'
                                    aria-label='Fermer la recherche'
                                    onClick={closeSearchModal}
                                    className='cursor-pointer rounded-md p-1 text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground'
                                >
                                    <X className='h-4 w-4' />
                                </button>
                            </div>

                            <div className='max-h-80 overflow-y-auto'>
                                {searchQuery.trim().length < 2 && (
                                    <p className='px-3 py-3 text-sm text-muted-foreground'>
                                        Tapez au moins 2 caractères pour rechercher.
                                    </p>
                                )}

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
                                        className='flex w-full cursor-pointer items-center justify-between gap-2 px-3 py-2 text-left text-sm hover:bg-secondary'
                                    >
                                        <span className='text-foreground'>
                                            {p.firstName} {p.lastName}
                                        </span>

                                        <span className='text-xs text-muted-foreground'>
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