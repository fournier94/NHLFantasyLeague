import type { ReactNode } from 'react';
import { NeonTitle } from '@/components/ui/NeonTitle';

interface RosterSectionProps {
    /** French title of the section, for example "Alignement". */
    title: string;
    /** Number of players shown in the section, kept for compatibility but not displayed. */
    count?: number;
    /** Extra classes applied to the section wrapper (optional). */
    className?: string;
    /**
     * Spacing above the title.
     *   'normal'  -> mt-6 (24px, default).
     *   'large'   -> mt-8 (32px), used by the salary-cap tab to
     *               separate the stacked subsections from one
     *               another.
     *   'compact' -> mt-4 (16px), used only for the first section
     *               under the cap bars where the bars already
     *               provide visual separation.
     */
    spacing?: 'normal' | 'large' | 'compact';
    children: ReactNode;
}

/**
 * Titled section used by the Mon équipe page to group players
 * (Attaquants, Défenseurs, Gardiens, Banc, Prospects).
 *
 * The title uses the shared NeonTitle so it matches every other
 * section header in the app.
 */
export function RosterSection({
    title,
    className = '',
    spacing = 'normal',
    children,
}: RosterSectionProps) {
    const titleMarginTop =
        spacing === 'large'
            ? 'mt-8'
            : spacing === 'compact'
                ? 'mt-4'
                : 'mt-6';

    return (
        <section className={className}>
            <h2 className={`${titleMarginTop} mb-3 text-center`}>
                <NeonTitle>{title}</NeonTitle>
            </h2>
            {children}
        </section>
    );
}