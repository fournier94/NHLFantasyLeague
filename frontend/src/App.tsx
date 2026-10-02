import { Navigate, Route, Routes } from 'react-router-dom';
import { Layout } from '@/components/layout/Layout';
import { AuraProvider } from '@/lib/auraContext';
import { AuthProvider, useAuth } from '@/lib/AuthContext';
import MonEquipePage from '@/pages/MonEquipePage';
import ClassementPage from '@/pages/ClassementPage';
import LiguePage from '@/pages/LiguePage';
import JoueursPage from '@/pages/JoueursPage';
import PlayerPage from '@/pages/PlayerPage';
import AdminPage from '@/pages/AdminPage';
import ConnexionPage from '@/pages/ConnexionPage';
import InscriptionPage from '@/pages/InscriptionPage';

/**
 * Route table. AuthProvider wraps everything so any component can
 * read the current user. AuraProvider supplies the neon-intensity
 * settings.
 *
 * AdminRoute is a small guard: if the user isn't a commissioner, it
 * redirects to /mon-equipe.
 */
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
                        <Route path='/ligue' element={<LiguePage />} />
                        <Route path='/joueurs' element={<JoueursPage />} />
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