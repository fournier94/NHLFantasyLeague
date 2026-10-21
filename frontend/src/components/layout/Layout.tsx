import { Suspense, useEffect, useRef, useState } from 'react';
import { Outlet, useLocation } from 'react-router-dom';
import { TopBar } from '@/components/layout/TopBar';
import { HealthBanner } from '@/components/layout/HealthBanner';
import { hasPendingRestore } from '@/lib/scrollRestoration';
import {
    isPlayerPath,
    setLastNonPlayerLocation,
} from '@/lib/playerNavigation';
import {
    clearGameDaySnapshot,
    peekGameDaySnapshot,
} from '@/lib/gameDayRestoration';

export function Layout() {
    const headerRef = useRef<HTMLElement>(null);
    const [headerHeight, setHeaderHeight] = useState(64);
    const location = useLocation();

    useEffect(() => {
        const isMonEquipe = location.pathname === '/mon-equipe';
        const isGameDay = location.pathname === '/game-day';

        if (isMonEquipe && hasPendingRestore()) return;
        if (isGameDay && peekGameDaySnapshot() !== null) return;

        const frame = requestAnimationFrame(() => {
            window.scrollTo(0, 0);
        });
        return () => cancelAnimationFrame(frame);
    }, [location.pathname]);

    const prevLocationRef = useRef<{
        pathname: string;
        search: string;
        hash: string;
        state: unknown;
        idx: number;
    } | null>(null);

    useEffect(() => {
        const prev = prevLocationRef.current;
        const curr = {
            pathname: location.pathname,
            search: location.search,
            hash: location.hash,
            state: location.state,
            idx: (window.history.state?.idx as number) ?? 0,
        };

        prevLocationRef.current = curr;

        const isCurrPlayer = isPlayerPath(curr.pathname);
        const isPrevPlayer = prev ? isPlayerPath(prev.pathname) : false;

        const isCurrDetour =
            curr.state && typeof curr.state === 'object' && 'returnTo' in curr.state && Boolean((curr.state as any).returnTo);

        const isPrevDetour =
            prev && prev.state && typeof prev.state === 'object' && 'returnTo' in prev.state && Boolean((prev.state as any).returnTo);

        // Rule 1: Player -> Non-Player
        if (isPrevPlayer && !isCurrPlayer) {
            if (!isCurrDetour) {
                setLastNonPlayerLocation({ pathname: curr.pathname, search: curr.search, hash: curr.hash, idx: curr.idx });
            }
            return;
        }

        // Rule 2: Non-Player -> Non-Player
        if (!isPrevPlayer && !isCurrPlayer) {
            setLastNonPlayerLocation({ pathname: curr.pathname, search: curr.search, hash: curr.hash, idx: curr.idx });
            return;
        }

        // Rule 3: Non-Player -> Player
        if (!isPrevPlayer && isCurrPlayer) {
            if (prev && !isPrevDetour) {
                setLastNonPlayerLocation({ pathname: prev.pathname, search: prev.search, hash: prev.hash, idx: prev.idx });
            }
            return;
        }

        // Rule 4: Player -> Player (Do nothing, freeze anchor)
    }, [location.pathname, location.search, location.hash, location.state]);

    useEffect(() => {
        const path = location.pathname;
        const isGameDay = path === '/game-day';
        const isNhlEquipe = path.startsWith('/nhl-equipe/');

        if (!isGameDay && !isPlayerPath(path) && !isNhlEquipe) {
            clearGameDaySnapshot();
        }
    }, [location.pathname]);

    useEffect(() => {
        if (!headerRef.current) return;
        const observer = new ResizeObserver(() => {
            if (headerRef.current) setHeaderHeight(headerRef.current.offsetHeight);
        });
        observer.observe(headerRef.current);
        return () => observer.disconnect();
    }, []);

    return (
        <div className='flex min-h-dvh flex-col bg-background' style={{ '--header-height': `${headerHeight}px` } as React.CSSProperties}>
            <header ref={headerRef} className='sticky top-0 z-50 flex items-center gap-3 bg-background px-4 py-3'>
                <TopBar />
            </header>
            <HealthBanner />
            <main className='flex-1 px-3 py-4 sm:px-4 sm:py-6'>
                <Suspense fallback={<p className='text-muted-foreground'>Chargement...</p>}>
                    <Outlet />
                </Suspense>
            </main>
        </div>
    );
}