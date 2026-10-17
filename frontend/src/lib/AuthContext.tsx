import {
    createContext,
    useCallback,
    useContext,
    useEffect,
    useMemo,
    useState,
    type ReactNode,
} from 'react';
import { useNavigate } from 'react-router-dom';
import {
    clearApiCache,
    getCurrentUser,
    login as apiLogin,
    logout as apiLogout,
    onUnauthorized,
    register as apiRegister,
    setPlayerPageStyle as apiSetPlayerPageStyle,
    updatePreferences as apiUpdatePreferences,
    type AuthUser,
    type LoginRequest,
    type PlayerPageStyle,
    type RegisterRequest,
} from '@/api/client';
import { resetDirectOfferDraft } from '@/lib/directOfferState';
import { clearDirectPicks } from '@/lib/marketplacePicksState';
import { clearMarketplacePopupRestore } from '@/lib/marketplacePopupRestoration';

interface AuthContextValue {
    user: AuthUser | null;
    loading: boolean;
    isAuthenticated: boolean;
    isCommissioner: boolean;

    playerPageStyle: PlayerPageStyle;

    updatePlayerPageStyle: (style: PlayerPageStyle) => Promise<void>;
    updatePreferences: (prefs: { showContractsStats?: boolean; showContractsRoster?: boolean }) => Promise<void>;

    login: (request: LoginRequest) => Promise<AuthUser>;
    register: (request: RegisterRequest) => Promise<AuthUser>;
    logout: () => Promise<void>;
    refreshUser: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
    const [user, setUser] = useState<AuthUser | null>(null);
    const [loading, setLoading] = useState(true);

    const navigate = useNavigate();

    const refreshUser = useCallback(async () => {
        try {
            const me = await getCurrentUser();
            setUser(me);
        } catch {
            setUser(null);
        }
    }, []);

    useEffect(() => {
        let cancelled = false;

        (async () => {
            try {
                const me = await getCurrentUser();
                if (!cancelled) {
                    setUser(me);
                }
            } catch {
                if (!cancelled) {
                    setUser(null);
                }
            } finally {
                if (!cancelled) {
                    setLoading(false);
                }
            }
        })();

        return () => {
            cancelled = true;
        };
    }, []);

    useEffect(() => {
        return onUnauthorized(() => {
            setUser(null);
        });
    }, []);

    useEffect(() => {
        resetDirectOfferDraft();
        clearDirectPicks();
        clearMarketplacePopupRestore();
    }, [user?.id]);

    useEffect(() => {
        const style = user?.playerPageStyle ?? 'Classic';
        const root = document.documentElement;

        if (style === 'Neon') {
            root.classList.add('aura-neon');
        } else {
            root.classList.remove('aura-neon');
        }
    }, [user?.playerPageStyle]);

    const login = useCallback(async (request: LoginRequest) => {
        const me = await apiLogin(request);
        clearApiCache();
        setUser(me);
        return me;
    }, []);

    const register = useCallback(async (request: RegisterRequest) => {
        const me = await apiRegister(request);
        clearApiCache();
        setUser(me);
        return me;
    }, []);

    const logout = useCallback(async () => {
        try {
            await apiLogout();
        } catch {
            // Ignore network errors on logout.
        }

        clearApiCache();
        navigate('/connexion', { replace: true });
        setUser(null);
    }, [navigate]);

    const updatePlayerPageStyle = useCallback(
        async (style: PlayerPageStyle) => {
            const me = await apiSetPlayerPageStyle(style);
            setUser(me);
        },
        [],
    );

    const updatePreferences = useCallback(
        async (prefs: { showContractsStats?: boolean; showContractsRoster?: boolean }) => {
            const me = await apiUpdatePreferences(prefs);
            setUser(me);
        },
        [],
    );

    const value = useMemo<AuthContextValue>(
        () => ({
            user,
            loading,
            isAuthenticated: user != null,
            isCommissioner: user?.isCommissioner ?? false,
            playerPageStyle: user?.playerPageStyle ?? 'Classic',
            updatePlayerPageStyle,
            updatePreferences,
            login,
            register,
            logout,
            refreshUser,
        }),
        [
            user,
            loading,
            updatePlayerPageStyle,
            updatePreferences,
            login,
            register,
            logout,
            refreshUser,
        ],
    );

    return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
    const ctx = useContext(AuthContext);

    if (!ctx) {
        throw new Error('useAuth must be used inside <AuthProvider>');
    }

    return ctx;
}