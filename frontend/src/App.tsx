import { Navigate, Route, Routes } from 'react-router-dom';
import { Layout } from '@/components/layout/Layout';
import { AuraProvider } from '@/lib/auraContext';
import MonEquipePage from '@/pages/MonEquipePage';
import LiguePage from '@/pages/LiguePage';
import JoueursPage from '@/pages/JoueursPage';
import AdminPage from '@/pages/AdminPage';
import ConnexionPage from '@/pages/ConnexionPage';

// Route table: every page is rendered inside the shared Layout (sidebar + top bar).
// AuraProvider wraps everything so any component can read its aura intensity.
export default function App() {
    return (
        <AuraProvider>
            <Routes>
                <Route element={<Layout />}>
                    <Route path='/' element={<Navigate to='/mon-equipe' replace />} />
                    <Route path='/mon-equipe' element={<MonEquipePage />} />
                    <Route path='/ligue' element={<LiguePage />} />
                    <Route path='/joueurs' element={<JoueursPage />} />
                    <Route path='/admin' element={<AdminPage />} />
                    <Route path='/connexion' element={<ConnexionPage />} />
                </Route>
            </Routes>
        </AuraProvider>
    );
}