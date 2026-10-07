import { useEffect, useState } from 'react';

/**
 * Captures the browser's `beforeinstallprompt` event so we can show
 * our own "Installer l'application" button instead of relying on the
 * browser's mini-infobar. The event is stored at module scope because
 * it fires once at page load, long before the button mounts.
 *
 * On iOS Safari there is no `beforeinstallprompt` — Apple requires
 * the user to use Share → Add to Home Screen. Same story for Firefox,
 * which uses its own browser menu. The hook exposes `isIosSafari` and
 * `isFirefox` so the UI can show the appropriate manual hint instead
 * of a dead button.
 */

interface BeforeInstallPromptEvent extends Event {
    readonly platforms: string[];
    readonly userChoice: Promise<{
        outcome: 'accepted' | 'dismissed';
        platform: string;
    }>;
    prompt(): Promise<void>;
}

let deferredPrompt: BeforeInstallPromptEvent | null = null;

const listeners = new Set<() => void>();

function notify(): void {
    listeners.forEach((l) => l());
}

if (typeof window !== 'undefined') {
    window.addEventListener('beforeinstallprompt', (e) => {
        // Prevent the default mini-infobar so we can control when the
        // install prompt is shown.
        e.preventDefault();
        deferredPrompt = e as BeforeInstallPromptEvent;
        notify();
    });

    window.addEventListener('appinstalled', () => {
        // Installed: discard the stored prompt so the button hides.
        deferredPrompt = null;
        notify();
    });
}

/**
 * True when the app is already running in installed/standalone mode.
 * Covers both Android/desktop (display-mode media query) and iOS
 * (navigator.standalone, which is a non-standard Safari-only flag).
 */
export function isRunningStandalone(): boolean {
    if (typeof window === 'undefined') return false;

    const nav = window.navigator as Navigator & { standalone?: boolean };
    if (nav.standalone === true) return true;

    return window.matchMedia('(display-mode: standalone)').matches;
}

/**
 * True when the visitor is on an iPhone, iPad, or iPod. Catches both
 * classic iOS user agents and the iPadOS 13+ case, where Safari
 * deliberately reports itself as a Mac with touch support.
 */
function isIosDevice(): boolean {
    if (typeof navigator === 'undefined') return false;

    const ua = navigator.userAgent;

    return (
        /iPad|iPhone|iPod/.test(ua) ||
        (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1)
    );
}

/**
 * True when the visitor is on iOS Safari specifically.
 *
 * iOS Chrome (CriOS), Firefox (FxiOS), Edge (EdgiOS) and Opera (OPiOS)
 * are excluded because their install flow lives in their own menu, not
 * the Safari share sheet. Showing the Safari hint in those browsers
 * would point the user at the wrong place.
 */
function detectIosSafari(): boolean {
    if (!isIosDevice()) return false;

    return !/CriOS|FxiOS|EdgiOS|OPiOS/.test(navigator.userAgent);
}

/**
 * True when the visitor is on Firefox (desktop or Android).
 *
 * iOS Firefox is excluded here because the iOS branch handles it, and
 * Firefox does not fire `beforeinstallprompt` anywhere: install is
 * always done through Firefox's own menu.
 */
function detectFirefox(): boolean {
    if (typeof navigator === 'undefined') return false;

    if (isIosDevice()) return false;

    return /Firefox\/|FxiOS\//.test(navigator.userAgent);
}

export interface PwaInstallState {
    /** True when the browser has offered a deferred install prompt. */
    canInstall: boolean;

    /** True when the app is already running as an installed PWA. */
    isInstalled: boolean;

    /** True when the visitor is on iOS Safari (manual install hint). */
    isIosSafari: boolean;

    /** True when the visitor is on Firefox (manual install hint). */
    isFirefox: boolean;

    /**
     * Triggers the browser install prompt. Resolves to the user's
     * choice, or 'unavailable' when no prompt is pending.
     */
    promptInstall: () => Promise<'accepted' | 'dismissed' | 'unavailable'>;
}

export function usePwaInstall(): PwaInstallState {
    // Force a re-render whenever the module-level state changes
    // (prompt captured, prompt consumed, app installed).
    const [, forceUpdate] = useState(0);

    useEffect(() => {
        const listener = () => forceUpdate((n) => n + 1);
        listeners.add(listener);
        return () => {
            listeners.delete(listener);
        };
    }, []);

    async function promptInstall(): Promise<
        'accepted' | 'dismissed' | 'unavailable'
    > {
        if (!deferredPrompt) return 'unavailable';

        await deferredPrompt.prompt();
        const choice = await deferredPrompt.userChoice;

        if (choice.outcome === 'accepted') {
            deferredPrompt = null;
            notify();
        }

        return choice.outcome;
    }

    return {
        canInstall: deferredPrompt !== null,
        isInstalled: isRunningStandalone(),
        isIosSafari: detectIosSafari(),
        isFirefox: detectFirefox(),
        promptInstall,
    };
}