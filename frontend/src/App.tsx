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
const StatistiquesPage = lazy(
    () => import('@/pages/StatistiquesPage'),
);
const NhlEquipePage = lazy(() => import('@/pages/NhlEquipePage'));

/**
 * Root redirect. Every page except /admin is now public, so an
 * anonymous visitor and an authenticated user both land on
 * /mon-equipe. MonEquipePage itself decides which team to show:
 * the user's own team when authed, the commissioner's team when
 * anonymous.
 */
function RootRedirect() {
    return <Navigate to='/mon-equipe' replace />;
}

/**
 * Route guard: commissioner-only pages.
 *
 * Requires BOTH "authenticated" AND "in the Commissioner role".
 * Anonymous users are redirected to /mon-equipe (public). Authed
 * non-commissioners are redirected to /mon-equipe as well.
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
                        {/* Root: pick a sensible default. */}
                        <Route path='/' element={<RootRedirect />} />

                        {/* Public pages: every page except /admin
                            is visible to anonymous visitors.
                            Mutations stay commissioner-gated on
                            the backend. */}
                        <Route path='/mon-equipe' element={<MonEquipePage />} />
                        <Route path='/classement' element={<ClassementPage />} />
                        <Route path='/game-day' element={<GameDayPage />} />
                        <Route path='/blessures' element={<InjuriesPage />} />
                        <Route path='/marketplace' element={<MarketplacePage />} />
                        <Route path='/statistiques' element={<StatistiquesPage />} />
                        <Route path='/nhl-equipe/:nhlTeamId' element={<NhlEquipePage />} />
                        <Route path='/ligue' element={<LiguePage />} />
                        <Route path='/joueurs/:nhlPlayerId' element={<PlayerPage />} />

                        {/* Commissioner-only. RequireCommissioner
                            does BOTH checks (auth + role) on its
                            own — anonymous users are bounced to
                            /mon-equipe. */}
                        <Route element={<RequireCommissioner />}>
                            <Route path='/admin' element={<AdminPage />} />
                        </Route>

                        {/* Public auth pages. */}
                        <Route path='/connexion' element={<ConnexionPage />} />
                        <Route path='/inscription' element={<InscriptionPage />} />

                        {/* Catch-all: any unknown URL lands on the
                            default page instead of a blank Layout. */}
                        <Route path='*' element={<Navigate to='/' replace />} />
                    </Route>
                </Routes>
            </AuraProvider>
        </AuthProvider>
    );
}