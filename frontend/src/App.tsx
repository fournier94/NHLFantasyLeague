import { lazy } from 'react';
import { Navigate, Route, Routes } from 'react-router-dom';
import { Layout } from '@/components/layout/Layout';
import { AuraProvider } from '@/lib/auraContext';
import { AuthProvider, useAuth } from '@/lib/AuthContext';

// Layout and auth infrastructure stay eager because they wrap every
// page and must be ready for the first paint. Every page component
// is lazy-loaded so its JS is only downloaded when the user actually
// navigates there. AdminPage and PlayerPage in particular are heavy
// and rarely opened on the first session.
import MonEquipePage from '@/pages/MonEquipePage';
import ClassementPage from '@/pages/ClassementPage';
import ConnexionPage from '@/pages/ConnexionPage';

const PlayerPage = lazy(() => import('@/pages/PlayerPage'));
const AdminPage = lazy(() => import('@/pages/AdminPage'));
const InscriptionPage = lazy(() => import('@/pages/InscriptionPage'));
const LiguePage = lazy(() => import('@/pages/LiguePage'));
const GameDayPage = lazy(() => import('@/pages/GameDayPage'));

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