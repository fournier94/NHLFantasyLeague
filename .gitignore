import type { CSSProperties, ReactNode } from 'react';
import { useAura } from '@/lib/auraContext';
import {
    auraPulseClass,
    auraPulseStyle,
    auraRangeFor,
    isAuraOff,
} from '@/lib/auraConfig';

interface NeonTitleProps {
    children: ReactNode;
    /**
     * 'section'    -> sized for a section header (text-xl).
     * 'subsection' -> one notch down (text-base).
     */
    variant?: 'section' | 'subsection';
    /**
     * Optional custom aura color. When provided, the four glow
     * layers use this color instead of the default league cyan
     * chain. Accepts a 6-digit hex string (e.g. '#4A90E2').
     */
    auraColor?: string;
    /**
     * Whether to draw the red outline. Defaults to true. Set to
     * false to render just the white fill + aura.
     */
    showStroke?: boolean;
    /**
     * When true, the pulse animation keeps running on mobile
     * (<= 767px). By default, all aura pulses are disabled on
     * mobile for performance, except a small allowlist. Set this
     * to true only for section / subsection titles that should
     * stay alive on phones.
     */
    keepPulseOnMobile?: boolean;
    className?: string;
}

/**
 * Shared neon title for the whole app.
 *
 * Default look (section titles, dropdown label): Grindy Brush, white
 * fill, 3.5px red stroke, cyan aura. The aura reads from the same
 * 'teamPickerLabel' channel the dropdown uses, so tuning that slider
 * in the admin panel moves everything at once.
 *
 * Overrides:
 *   - `auraColor` swaps the cyan chain for a custom color.
 *   - `showStroke={false}` removes the red outline.
 *   - `keepPulseOnMobile` opts a title back into the pulse on mobile.
 * Together they let the player name carry the same font as every
 * other title while glowing in the player's team color.
 */
export function NeonTitle({
    children,
    variant = 'section',
    auraColor,
    showStroke = true,
    keepPulseOnMobile = false,
    className = '',
}: NeonTitleProps) {
    const aura = useAura('teamPickerLabel');

    let rest: string;
    let peak: string;

    if (auraColor) {
        // Custom color chain: four layers of the same color at
        // decreasing opacity. The hex is 6 digits from the team
        // color helper, so appending a 2-digit alpha suffix gives
        // a valid 8-digit hex.
        const s0 = auraRangeFor(aura, 'teamPickerLabel', 0).toFixed(2);
        const s1 = auraRangeFor(aura, 'teamPickerLabel', 1).toFixed(2);
        const s2 = auraRangeFor(aura, 'teamPickerLabel', 2).toFixed(2);
        const s3 = auraRangeFor(aura, 'teamPickerLabel', 3).toFixed(2);

        rest = [
            `0 0 ${s0}px ${auraColor}E6`,
            `0 0 ${s1}px ${auraColor}D9`,
            `0 0 ${s2}px ${auraColor}99`,
            `0 0 ${s3}px ${auraColor}59`,
        ].join(', ');

        peak = [
            `0 0 ${s0}px ${auraColor}FF`,
            `0 0 ${s1}px ${auraColor}FF`,
            `0 0 ${s2}px ${auraColor}CC`,
            `0 0 ${s3}px ${auraColor}80`,
        ].join(', ');
    } else {
        rest = [
            `0 0 ${auraRangeFor(aura, 'teamPickerLabel', 0).toFixed(2)}px #F2F5FA`,
            `0 0 ${auraRangeFor(aura, 'teamPickerLabel', 1).toFixed(2)}px #00A8FF`,
            `0 0 ${auraRangeFor(aura, 'teamPickerLabel', 2).toFixed(2)}px rgba(0, 168, 255, 0.85)`,
            `0 0 ${auraRangeFor(aura, 'teamPickerLabel', 3).toFixed(2)}px rgba(0, 168, 255, 0.55)`,
        ].join(', ');

        peak = [
            `0 0 ${auraRangeFor(aura, 'teamPickerLabel', 0).toFixed(2)}px #F2F5FA`,
            `0 0 ${auraRangeFor(aura, 'teamPickerLabel', 1).toFixed(2)}px #00A8FF`,
            `0 0 ${auraRangeFor(aura, 'teamPickerLabel', 2).toFixed(2)}px #00A8FF`,
            `0 0 ${auraRangeFor(aura, 'teamPickerLabel', 3).toFixed(2)}px rgba(0, 168, 255, 0.85)`,
        ].join(', ');
    }

    const auraOn = !isAuraOff(aura);

    const sizeClass = variant === 'section' ? 'text-xl' : 'text-base';

    const pulseClasses = auraOn
        ? `${auraPulseClass('text')}${keepPulseOnMobile ? ' aura-mobile-keep' : ''}`
        : '';

    return (
        <span
            className={`inline-block leading-none tracking-[0.02em] ${sizeClass} ${pulseClasses} ${className}`}
            style={{
                fontFamily: "'Grindy Brush', sans-serif",
                fontWeight: 400,
                color: '#FFFFFF',
                ...(showStroke
                    ? {
                        WebkitTextStrokeWidth: '3.5px',
                        WebkitTextStrokeColor: '#AF1E2D',
                        paintOrder: 'stroke fill',
                    }
                    : {}),
                ...(auraOn ? auraPulseStyle(rest, peak) : {}),
            } as CSSProperties}
        >
            {children}
        </span>
    );
}