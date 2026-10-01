import { useEffect, useRef, useState } from 'react';
import { Outlet, useLocation } from 'react-router-dom';
import { TopBar } from '@/components/layout/TopBar';
import { hasPendingRestore } from '@/lib/scrollRestoration';
import {
    isPlayerPath,
    setLastNonPlayerLocation,
} from '@/lib/playerNavigation';

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
 * Finally, it records the last non-player location the user visited, so
 * PlayerPage's Fermer button can jump past a chain of player pages and
 * land back on it (see lib/playerNavigation.ts).
 */
export function Layout() {
    const headerRef = useRef<HTMLElement>(null);
    const [headerHeight, setHeaderHeight] = useState(64);

    const location = useLocation();

    // Scroll to the top whenever the route changes. Without this, the
    // browser keeps the previous page's scroll position, so opening a
    // player page from a scrolled-down Mon équipe lands mid-page.
    //
    // The only exception: when we are landing on Mon équipe AND a
    // scroll restore is pending, we skip the top-scroll and let
    // MonEquipePage restore its own position instead.
    //
    // Note: a pending restore that was set on the way TO the player
    // page must NOT suppress the top-scroll here — that restore is for
    // the trip back to Mon équipe, not for the player page itself.
    //
    // The scroll is deferred to the next animation frame so it runs
    // after the browser has painted the new page. On the same tick, the
    // new page may still be shorter than the old one and the browser
    // would clamp the scroll, which reads as "the scroll did nothing".
    useEffect(() => {
        const isMonEquipe = location.pathname === '/mon-equipe';

        if (isMonEquipe && hasPendingRestore()) {
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
            className='flex min-h-screen flex-col bg-background'
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

            <main className='flex-1 px-3 py-4 sm:px-4 sm:py-6'>
                <Outlet />
            </main>
        </div>
    );
}