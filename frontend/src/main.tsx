import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import { registerSW } from 'virtual:pwa-register';
import App from './App';
import './index.css';

if ('scrollRestoration' in window.history) {
    window.history.scrollRestoration = 'manual';
}

// Register the service worker immediately on app boot.
//
// 'immediate: true' is required for the autoUpdate strategy to work
// correctly: without it, the SW registration is deferred until after
// the first page render, which means a new version deployed while the
// user is on the page might not be picked up until a later navigation.
//
// The plugin handles the reload itself. When a new SW activates,
// workbox.clientsClaim makes it take control of every open tab, and
// the virtual module reloads those tabs to serve the new assets.
registerSW({ immediate: true });

// Entry point: mounts React into the #root div of index.html and enables
// client-side routing (the browser never fully reloads when navigating).
createRoot(document.getElementById('root')!).render(
    <StrictMode>
        <BrowserRouter>
            <App />
        </BrowserRouter>
    </StrictMode>,
);