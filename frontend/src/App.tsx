import { lazy } from 'react';
import { Navigate, Route, Routes } from 'react-router-dom';
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

function AdminRoute({ children }: { children: React.ReactNode }) {
    const { loading, isCommissioner } = useAuth();

    if (loading) {
        return <p className='text-muted-foreground'>Chargement...</p>;
    }

    if (!isCommissioner) {
        return <Navigate to='/mon-equipe' replace />;
    }

    return <>{children}</>;
}

export default function App() {
    return (
        <AuthProvider>
            <AuraProvider>
                <Routes>
                    <Route element={<Layout />}>
                        <Route path='/' element={<Navigate to='/mon-equipe' replace />} />
                        <Route path='/mon-equipe' element={<MonEquipePage />} />
                        <Route path='/classement' element={<ClassementPage />} />
                        <Route path='/game-day' element={<GameDayPage />} />
                        <Route path='/blessures' element={<InjuriesPage />} />
                        <Route path='/ligue' element={<LiguePage />} />
                        <Route path='/joueurs/:nhlPlayerId' element={<PlayerPage />} />
                        <Route
                            path='/admin'
                            element={
                                <AdminRoute>
                                    <AdminPage />
                                </AdminRoute>
                            }
                        />
                        <Route path='/connexion' element={<ConnexionPage />} />
                        <Route path='/inscription' element={<InscriptionPage />} />
                    </Route>
                </Routes>
            </AuraProvider>
        </AuthProvider>
    );
}