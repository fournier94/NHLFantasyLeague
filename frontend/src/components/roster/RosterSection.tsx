import type { ReactNode } from 'react';

interface RosterSectionProps {
  /** French title of the section, for example "Alignement". */
  title: string;
  /** Number of players shown in the section, displayed next to the title. */
  count?: number;
  /** Extra classes applied to the section wrapper (optional). */
  className?: string;
  children: ReactNode;
}

/**
 * Titled section used by the Mon équipe page to group players
 * (Attaquants, Défenseurs, Gardiens, Banc, Prospects).
 */
export function RosterSection({ title, count, className = '', children }: RosterSectionProps) {
  return (
    <section className={className}>
      <h2 className='mb-3 text-sm font-semibold uppercase tracking-wide text-muted-foreground'>
        {title}
        {count !== undefined ? ` (${count})` : ''}
      </h2>
      {children}
    </section>
  );
}
