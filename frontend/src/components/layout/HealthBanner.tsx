import { useEffect, useState } from 'react';
import {
    getExternalSourceHealth,
    type ExternalSourceHealthResponse,
} from '@/api/client';
import { useAuth } from '@/lib/AuthContext';

/**
 * Admin-only red banner that shows when any external data source is
 * Degraded or Broken. Polls /api/Health/external-sources every 60
 * seconds. Renders nothing for non-commissioners and nothing when
 * every source is healthy.
 *
 * The banner clears itself automatically: the next successful fetch
 * flips the source back to Healthy and the banner stops rendering on
 * the next poll.
 */
export function HealthBanner() {
    const { isCommissioner, isAuthenticated } = useAuth();

    const [health, setHealth] =
        useState<ExternalSourceHealthResponse | null>(null);

    useEffect(() => {
        if (!isAuthenticated || !isCommissioner) {
            setHealth(null);
            return;
        }

        let cancelled = false;

        const fetchHealth = async () => {
            try {
                const data = await getExternalSourceHealth();
                if (!cancelled) {
                    setHealth(data);
                }
            } catch {
                // Non-fatal: if the health endpoint itself is down,
                // we just don't show the banner. Avoids a noisy loop.
                if (!cancelled) {
                    setHealth(null);
                }
            }
        };

        void fetchHealth();

        const timer = setInterval(() => {
            void fetchHealth();
        }, 60_000);

        return () => {
            cancelled = true;
            clearInterval(timer);
        };
    }, [isAuthenticated, isCommissioner]);

    if (!health) return null;
    if (health.overallStatus === 'Healthy') return null;

    const unhealthy = health.sources.filter(
        (s) => s.status !== 'Healthy',
    );

    if (unhealthy.length === 0) return null;

    const summary = unhealthy
        .map((s) => `${s.sourceName} (${s.status})`)
        .join(' · ');

    return (
        <div
            role='alert'
            className='w-full border-b border-red-500/40 bg-red-500/15 px-3 py-2 text-sm text-red-300'
        >
            <div className='mx-auto flex max-w-5xl items-start gap-2'>
                <span
                    aria-hidden='true'
                    className='mt-0.5 inline-block h-2 w-2 shrink-0 rounded-full bg-red-400'
                />
                <span className='font-semibold'>
                    Sources externes en problème :
                </span>
                <span className='flex-1'>{summary}</span>
            </div>
        </div>
    );
}