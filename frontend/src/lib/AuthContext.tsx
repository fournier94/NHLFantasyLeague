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
    getCurrentUser,
    login as apiLogin,
    logout as apiLogout,
    onUnauthorized,
    register as apiRegister,
    setPlayerPageStyle as apiSetPlayerPageStyle,
    type AuthUser,
    type LoginRequest,
    type PlayerPageStyle,
    type RegisterRequest,
} from '@/api/client';

interface AuthContextValue {
    user: AuthUser | null;
    loading: boolean;
    isAuthenticated: boolean;
    isCommissioner: boolean;

    /**
     * PlayerPage visual style for the current user. Defaults to
     * 'Neon' when logged out or before the user has chosen one.
     */
    playerPageStyle: PlayerPageStyle;

    /** Updates the style, persists it, and refreshes the cached user. */
    updatePlayerPageStyle: (style: PlayerPageStyle) => Promise<void>;

    login: (request: LoginRequest) => Promise<AuthUser>;
    register: (request: RegisterRequest) => Promise<AuthUser>;
    logout: () => Promise<void>;
    refreshUser: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

/**
 * Wraps the app and keeps the current user in memory. On mount it
 * calls GET /api/Auth/me; if the auth cookie is present and valid,
 * the user loads. If it 401s, we treat that as "logged out".
 *
 * Logout always redirects to /connexion. The redirect is fired
 * BEFORE clearing the user so that any auth-aware wrapper
 * (AdminRoute, etc.) cannot race the navigation and land the user
 * somewhere else.
 */
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

    const login = useCallback(async (request: LoginRequest) => {
        const me = await apiLogin(request);
        setUser(me);
        return me;
    }, []);

    const register = useCallback(async (request: RegisterRequest) => {
        const me = await apiRegister(request);
        setUser(me);
        return me;
    }, []);

    const logout = useCallback(async () => {
        try {
            await apiLogout();
        } catch {
            // Ignore network errors on logout.
        }

        // Redirect first, then clear the user. Doing it in this
        // order prevents auth-aware wrappers (like AdminRoute) from
        // reacting to the null user and redirecting to a fallback
        // route before we get to /connexion.
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

    const value = useMemo<AuthContextValue>(
        () => ({
            user,
            loading,
            isAuthenticated: user != null,
            isCommissioner: user?.isCommissioner ?? false,
            playerPageStyle: user?.playerPageStyle ?? 'Classic',
            updatePlayerPageStyle,
            login,
            register,
            logout,
            refreshUser,
        }),
        [
            user,
            loading,
            updatePlayerPageStyle,
            login,
            register,
            logout,
            refreshUser,
        ],
    );

    return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

/** Reads the auth context. Must be used inside <AuthProvider>. */
export function useAuth(): AuthContextValue {
    const ctx = useContext(AuthContext);

    if (!ctx) {
        throw new Error('useAuth must be used inside <AuthProvider>');
    }

    return ctx;
}