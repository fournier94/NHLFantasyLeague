import {
    createContext,
    useCallback,
    useContext,
    useMemo,
    useState,
    type ReactNode,
} from 'react';
import {
    AURA_DEFAULTS,
    clampAura,
    type AuraChannel,
} from './auraConfig';

interface AuraContextValue {
    /** Current intensity per channel, 0-10. */
    intensities: Record<AuraChannel, number>;
    /** Sets one channel's intensity; clamped to 0-10. */
    setIntensity: (channel: AuraChannel, value: number) => void;
    /** Resets every channel to its default. */
    reset: () => void;
}

const AuraContext = createContext<AuraContextValue | null>(null);

/**
 * Provides the aura intensity map to the whole app. Wrap the router once,
 * then any component calls `useAura(channel)` for its own intensity and
 * `useAuraAll()` for the full map (used by the admin sliders).
 */
export function AuraProvider({ children }: { children: ReactNode }) {
    const [intensities, setIntensities] = useState<Record<AuraChannel, number>>(
        () => ({ ...AURA_DEFAULTS }),
    );

    const setIntensity = useCallback((channel: AuraChannel, value: number) => {
        setIntensities((current) => ({
            ...current,
            [channel]: clampAura(value),
        }));
    }, []);

    const reset = useCallback(() => {
        setIntensities({ ...AURA_DEFAULTS });
    }, []);

    const value = useMemo(
        () => ({ intensities, setIntensity, reset }),
        [intensities, setIntensity, reset],
    );

    return <AuraContext.Provider value={value}>{children}</AuraContext.Provider>;
}

/** Reads the whole map. Used by the admin page to render every slider. */
export function useAuraAll(): AuraContextValue {
    const ctx = useContext(AuraContext);
    if (!ctx) {
        throw new Error('useAuraAll must be used inside <AuraProvider>');
    }
    return ctx;
}

/** Reads one channel. Used by each component that has an aura. */
export function useAura(channel: AuraChannel): number {
    const ctx = useContext(AuraContext);
    if (!ctx) {
        throw new Error('useAura must be used inside <AuraProvider>');
    }
    return ctx.intensities[channel];
}