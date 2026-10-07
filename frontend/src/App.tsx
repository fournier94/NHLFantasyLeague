import { lazy } from 'react';
import { Navigate, Outlet, Route, Routes } from 'react-router-dom';
import { Layout } from '@/components/layout/Layout';
import { AuraProvider } from '@/lib/auraContext';
import { AuthProvider, useAuth } from '@/lib/AuthContext';

import MonEquipePage from '@/pages/MonEquipePage';
import ClassementPage from '@/pages/ClassementPage';
import ConnexionPage from '@/pages/ConnexionPage';

const PlayerPage = lazy(() => import('@/pages/PlayerPage'));
const AdminPage = lazy(() => import('@/pages/AdminPage'));
const InscriptionPage = lazy(() => import('@/pages/InscriptionPage'));
const LiguePage = lazy(() => import('@/pages/LiguePage'));
const GameDayPage = lazy(() => import('@/pages/GameDayPage'));
const InjuriesPage = lazy(() => import('@/pages/InjuriesPage'));
const MarketplacePage = lazy(() => import('@/pages/MarketplacePage'));

/**
 * Root redirect. Sends a logged-in user to /mon-equipe and an
 * anonymous visitor straight to /connexion. Waits for AuthContext
 * to finish its initial /Auth/me call before deciding, so a
 * logged-in user is never bounced to the login page during startup.
 */
function RootRedirect() {
    const { loading, isAuthenticated } = useAuth();

    if (loading) {
        return <p className='text-muted-foreground'>Chargement...</p>;
    }

    return (
        <Navigate
            to={isAuthenticated ? '/mon-equipe' : '/connexion'}
            replace
        />
    );
}

/**
 * Route guard: renders its children only when the user is
 * authenticated. Otherwise redirects to /connexion.
 *
 * Uses <Outlet /> so it can wrap an entire route group instead of
 * being repeated on every protected page.
 */
function RequireAuth() {
    const { loading, isAuthenticated } = useAuth();

    if (loading) {
        return <p className='text-muted-foreground'>Chargement...</p>;
    }

    if (!isAuthenticated) {
        return <Navigate to='/connexion' replace />;
    }

    return <Outlet />;
}

/**
 * Route guard: commissioner-only pages. Nested inside RequireAuth,
 * so an unauthenticated user never reaches here. An authenticated
 * non-commissioner gets sent back to his own team page.
 */
function RequireCommissioner() {
    const { loading, isCommissioner } = useAuth();

    if (loading) {
        return <p className='text-muted-foreground'>Chargement...</p>;
    }

    if (!isCommissioner) {
        return <Navigate to='/mon-equipe' replace />;
    }

    return <Outlet />;
}

export default function App() {
    return (
        <AuthProvider>
            <AuraProvider>
                <Routes>
                    <Route element={<Layout />}>
                        {/* Root: decide based on auth state. */}
                        <Route path='/' element={<RootRedirect />} />

                        {/* Protected: an anonymous visitor hitting any
                            of these goes to /connexion. */}
                        <Route element={<RequireAuth />}>
                            <Route path='/mon-equipe' element={<MonEquipePage />} />
                            <Route path='/classement' element={<ClassementPage />} />
                            <Route path='/game-day' element={<GameDayPage />} />
                            <Route path='/blessures' element={<InjuriesPage />} />
                            <Route path='/marketplace' element={<MarketplacePage />} />
                            <Route path='/ligue' element={<LiguePage />} />
                            <Route path='/joueurs/:nhlPlayerId' element={<PlayerPage />} />

                            {/* Commissioner only. Nested inside
                                RequireAuth so the auth check runs
                                first, then the role check. */}
                            <Route element={<RequireCommissioner />}>
                                <Route path='/admin' element={<AdminPage />} />
                            </Route>
                        </Route>

                        {/* Public. */}
                        <Route path='/connexion' element={<ConnexionPage />} />
                        <Route path='/inscription' element={<InscriptionPage />} />
                    </Route>
                </Routes>
            </AuraProvider>
        </AuthProvider>
    );
}