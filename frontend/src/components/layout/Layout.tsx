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

/**
 * Shell shared by every page: horizontal top navigation and the current
 * page rendered by <Outlet />.
 *
 * The header measures its full height (including padding and border)
 * with a ResizeObserver and publishes it as `--header-height`. The
 * fixed Close button on the player page uses that variable to sit
 * reliably under the header at every viewport size.
 *
 * It also resets the window scroll position to the top whenever the
 * route changes, so navigating from a scrolled page (e.g. Mon équipe)
 * to a new page (e.g. a player detail page) always starts at the top.
 *
 * It records the last non-player location the user visited, so
 * PlayerPage's Fermer button can jump past a chain of player pages and
 * land back on it (see lib/playerNavigation.ts).
 *
 * It also clears the GameDayPage state snapshot whenever the user
 * lands on a page that is neither GameDay nor a player page. That
 * makes the snapshot only survive a direct PlayerPage -> GameDayPage
 * round-trip; any other page in between resets it.
 */
export function Layout() {
    const headerRef = useRef<HTMLElement>(null);
    const [headerHeight, setHeaderHeight] = useState(64);

    const location = useLocation();

    // Scroll to the top whenever the route changes. Without this, the
    // browser keeps the previous page's scroll position, so opening a
    // player page from a scrolled-down Mon équipe lands mid-page.
    //
    // Two exceptions skip the top-scroll, because the destination
    // page is going to restore its own scroll position:
    //
    //   1. Landing on Mon équipe with a pending Mon équipe scroll
    //      restore (from the scrollRestoration store).
    //
    //   2. Landing on GameDay with a pending GameDay snapshot. The
    //      GameDayPage restore effect runs in the same commit and
    //      schedules its own scroll-to-card; if we scrolled to top
    //      here, our rAF would run after theirs and cancel their
    //      smooth scroll, leaving the page at the top.
    //
    // Both exceptions use the "peek" pattern: the destination page
    // has not yet consumed the restore by the time this effect
    // fires, so a peek returns the pending state.
    useEffect(() => {
        const isMonEquipe = location.pathname === '/mon-equipe';
        const isGameDay = location.pathname === '/game-day';

        if (isMonEquipe && hasPendingRestore()) {
            return;
        }

        if (isGameDay && peekGameDaySnapshot() !== null) {
            return;
        }

        const frame = requestAnimationFrame(() => {
            window.scrollTo(0, 0);
        });

        return () => cancelAnimationFrame(frame);
    }, [location.pathname]);

    // Record the last non-player location. Player pages are skipped on
    // purpose: we want Fermer on a player page to jump all the way back
    // to the last page that was NOT a player page (typically Mon équipe,
    // possibly with a query string like ?teamId=5).
    //
    // This runs on every location change, including player -> player
    // transitions, but since those are player paths they simply do not
    // overwrite the stored value.
    useEffect(() => {
        if (isPlayerPath(location.pathname)) {
            return;
        }

        setLastNonPlayerLocation({
            pathname: location.pathname,
            search: location.search,
            hash: location.hash,
        });
    }, [location.pathname, location.search, location.hash]);

    // Clear the GameDay state snapshot whenever the user lands on a
    // page that is neither GameDay nor a player page.
    //
    // This is what makes the snapshot survive only a direct
    // PlayerPage -> GameDayPage transition:
    //
    //   GameDay -> Player -> GameDay                : no clear, restore applied
    //   GameDay -> Player -> Classement -> GameDay  : clear on Classement, no restore
    //   GameDay -> Classement -> GameDay            : clear on Classement, no restore
    //
    // Player pages themselves do not clear: that is precisely the
    // path we want to survive.
    useEffect(() => {
        const path = location.pathname;
        const isGameDay = path === '/game-day';

        if (!isGameDay && !isPlayerPath(path)) {
            clearGameDaySnapshot();
        }
    }, [location.pathname]);

    useEffect(() => {
        if (!headerRef.current) {
            return;
        }

        const observer = new ResizeObserver(() => {
            if (headerRef.current) {
                // offsetHeight includes padding and border, unlike
                // contentRect.height which only measures the content box.
                setHeaderHeight(headerRef.current.offsetHeight);
            }
        });

        observer.observe(headerRef.current);

        return () => observer.disconnect();
    }, []);

    return (
        <div
            className='flex min-h-dvh flex-col bg-background'
            style={
                {
                    '--header-height': `${headerHeight}px`,
                } as React.CSSProperties
            }
        >
            <header
                ref={headerRef}
                className='sticky top-0 z-50 flex items-center gap-3 bg-background px-4 py-3'
            >
                <TopBar />
            </header>

            <HealthBanner />

            <main className='flex-1 px-3 py-4 sm:px-4 sm:py-6'>
                <Suspense
                    fallback={
                        <p className='text-muted-foreground'>Chargement...</p>
                    }
                >
                    <Outlet />
                </Suspense>
            </main>
        </div>
    );
}