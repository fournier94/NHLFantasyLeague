import { useEffect, useRef, useState } from 'react';
import { Outlet, useLocation } from 'react-router-dom';
import { TopBar } from '@/components/layout/TopBar';
import { hasPendingRestore } from '@/lib/scrollRestoration';

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
 */
export function Layout() {
    const headerRef = useRef<HTMLElement>(null);
    const [headerHeight, setHeaderHeight] = useState(64);

    const location = useLocation();

    // Scroll to the top whenever the route changes. Without this, the
    // browser keeps the previous page's scroll position, so opening a
    // player page from a scrolled-down Mon équipe lands mid-page.
    //
    // When a scroll restore is pending (the user is coming back from a
    // player page), we skip the top-scroll and let the destination page
    // restore its own position instead.
    useEffect(() => {
        if (hasPendingRestore()) {
            return;
        }

        window.scrollTo(0, 0);
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
            className='flex min-h-screen flex-col bg-background'
            style={
                {
                    '--header-height': `${headerHeight}px`,
                } as React.CSSProperties
            }
        >
            <header
                ref={headerRef}
                className='sticky top-0 z-50 flex items-center gap-3 border-b border-border bg-background px-4 py-3'
            >
                <TopBar />
            </header>

            <main className='flex-1 px-3 py-4 sm:px-4 sm:py-6'>
                <Outlet />
            </main>
        </div>
    );
}