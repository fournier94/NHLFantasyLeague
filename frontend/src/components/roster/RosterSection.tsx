import type { ReactNode } from 'react';
import { useAura } from '@/lib/auraContext';
import {
    auraPulseClass,
    auraPulseStyle,
    auraRangeFor,
    isAuraOff,
} from '@/lib/auraConfig';

interface RosterSectionProps {
    /** French title of the section, for example "Alignement". */
    title: string;
    /** Number of players shown in the section, kept for compatibility but not displayed. */
    count?: number;
    /** Extra classes applied to the section wrapper (optional). */
    className?: string;
    children: ReactNode;
}

/**
 * Titled section used by the Mon équipe page to group players
 * (Attaquants, Défenseurs, Gardiens, Banc, Prospects).
 */
export function RosterSection({
    title,
    className = '',
    children,
}: RosterSectionProps) {
    const aura = useAura('rosterSectionTitle');

    // Ranges come from AURA_RANGES.rosterSectionTitle in auraConfig.ts.
    const rest = [
        `0 0 ${auraRangeFor(aura, 'rosterSectionTitle', 0).toFixed(2)}px #F2F5FA`,
        `0 0 ${auraRangeFor(aura, 'rosterSectionTitle', 1).toFixed(2)}px #00A8FF`,
        `0 0 ${auraRangeFor(aura, 'rosterSectionTitle', 2).toFixed(2)}px rgba(0, 168, 255, 0.5)`,
        `0 0 ${auraRangeFor(aura, 'rosterSectionTitle', 3).toFixed(2)}px rgba(0, 168, 255, 0.25)`,
    ].join(', ');

    const peak = [
        `0 0 ${auraRangeFor(aura, 'rosterSectionTitle', 0).toFixed(2)}px #F2F5FA`,
        `0 0 ${auraRangeFor(aura, 'rosterSectionTitle', 1).toFixed(2)}px #00A8FF`,
        `0 0 ${auraRangeFor(aura, 'rosterSectionTitle', 2).toFixed(2)}px rgba(0, 168, 255, 0.65)`,
        `0 0 ${auraRangeFor(aura, 'rosterSectionTitle', 3).toFixed(2)}px rgba(0, 168, 255, 0.4)`,
    ].join(', ');

    return (
        <section className={className}>
            <h2
                className={`mb-3 text-center text-sm font-semibold uppercase tracking-wide text-white roster-section-title ${!isAuraOff(aura) ? auraPulseClass('text') : ''}`}
                style={!isAuraOff(aura) ? auraPulseStyle(rest, peak) : undefined}
            >
                {title}
            </h2>
            {children}
        </section>
    );
}