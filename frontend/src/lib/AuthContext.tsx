import {
    createContext,
    useCallback,
    useContext,
    useEffect,
    useMemo,
    useState,
    type ReactNode,
} from 'react';
import {
    getCurrentUser,
    login as apiLogin,
    logout as apiLogout,
    onUnauthorized,
    register as apiRegister,
    type AuthUser,
    type LoginRequest,
    type RegisterRequest,
} from '@/api/client';

interface AuthContextValue {
    /** The current user, or null when logged out / not yet loaded. */
    user: AuthUser | null;

    /** True while we're fetching the current user for the first time. */
    loading: boolean;

    /** True when the user is logged in. */
    isAuthenticated: boolean;

    /** True when the user has the Commissioner role. */
    isCommissioner: boolean;

    /** Logs in; throws on failure. */
    login: (request: LoginRequest) => Promise<AuthUser>;

    /** Registers; throws on failure. */
    register: (request: RegisterRequest) => Promise<AuthUser>;

    /** Logs out. Never throws. */
    logout: () => Promise<void>;

    /** Re-fetches the current user (used after changing something). */
    refreshUser: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

/**
 * Wraps the app and keeps the current user in memory. On mount it
 * calls GET /api/Auth/me; if the auth cookie is present and valid, the
 * user loads. If it 401s, we treat that as "logged out".
 *
 * Also subscribes to the shared 401 handler in client.ts, so if any
 * API call later returns 401, the context clears its user and the UI
 * flips to logged-out.
 */
export function AuthProvider({ children }: { children: ReactNode }) {
    const [user, setUser] = useState<AuthUser | null>(null);
    const [loading, setLoading] = useState(true);

    const refreshUser = useCallback(async () => {
        try {
            const me = await getCurrentUser();
            setUser(me);
        } catch {
            setUser(null);
        }
    }, []);

    // Initial load: fetch the current user once.
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

    // Any 401 from any API call clears the cached user.
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
            // Ignore network errors on logout: the local state is what
            // matters.
        }
        setUser(null);
    }, []);

    const value = useMemo<AuthContextValue>(
        () => ({
            user,
            loading,
            isAuthenticated: user != null,
            isCommissioner: user?.isCommissioner ?? false,
            login,
            register,
            logout,
            refreshUser,
        }),
        [user, loading, login, register, logout, refreshUser],
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