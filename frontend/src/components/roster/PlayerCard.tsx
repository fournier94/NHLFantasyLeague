import { useState } from 'react';
import type { RosterEntry, SeasonStatLine } from '@/api/client';
import { cn } from '@/lib/utils';

// Number formatting for salaries: "7 850 000 $".
const salaryFormatter = new Intl.NumberFormat('fr-CA', {
  maximumFractionDigits: 0,
});

// Goalies show PJ/V/D/DP; skaters show PJ/B/A/PTS.
const skaterColumns = ['PJ', 'B', 'A', 'PTS'];
const goalieColumns = ['PJ', 'V', 'D', 'DP'];

/** Returns the four stat values of one season line, adapted to the position. */
function statValues(line: SeasonStatLine | null, isGoalie: boolean): (string | number)[] {
  if (!line) {
    return ['-', '-', '-', '-'];
  }

  return isGoalie
    ? [line.gamesPlayed, line.wins, line.losses, line.overtimeLosses]
    : [line.gamesPlayed, line.goals, line.assists, line.points];
}

interface PlayerCardProps {
  entry: RosterEntry;
  /** Extra classes applied to the card container (optional). */
  className?: string;
}

/**
 * NHL-style player card: name centered on top, headshot on the left, the
 * previous and current season stat lines on the right, and the fantasy
 * salary as a small badge in the top-right corner.
 */
export function PlayerCard({ entry, className = '' }: PlayerCardProps) {
  const [imageFailed, setImageFailed] = useState(false);
  const isGoalie = entry.position === 'G';
  const columns = isGoalie ? goalieColumns : skaterColumns;
  const lines = [entry.lastSeason, entry.currentSeason];
  const showImage = Boolean(entry.headshotUrl) && !imageFailed;

  return (
    <article
      className={cn('relative min-h-32 rounded-lg border border-border bg-card p-3', className)}
    >
      <span className='absolute right-2 top-2 rounded border border-border px-1.5 py-0.5 text-xs text-muted-foreground'>
        {salaryFormatter.format(entry.fantasySalary)} $
      </span>

      <h3 className='truncate px-12 text-center text-sm font-semibold text-foreground'>
        {entry.firstName} {entry.lastName}
      </h3>
      <p className='truncate text-center text-xs uppercase tracking-wide text-muted-foreground'>
        {entry.position} · {entry.nhlTeamAbbreviation}
      </p>

      <div className='mt-2 flex items-center gap-3'>
        {showImage ? (
          <img
            src={entry.headshotUrl ?? undefined}
            alt={`${entry.firstName} ${entry.lastName}`}
            className='h-16 w-16 shrink-0 rounded-md bg-muted object-cover'
            loading='lazy'
            onError={() => setImageFailed(true)}
          />
        ) : (
          <div className='flex h-16 w-16 shrink-0 items-center justify-center rounded-md bg-muted text-lg font-semibold text-muted-foreground'>
            {entry.firstName.charAt(0)}
            {entry.lastName.charAt(0)}
          </div>
        )}

        <table className='w-full text-right text-xs tabular-nums'>
          <thead>
            <tr className='text-muted-foreground'>
              <th className='text-left font-normal' />
              {columns.map((column) => (
                <th key={column} className='pl-2 font-normal'>
                  {column}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className='text-foreground'>
            {lines.map((line, index) => (
              <tr key={index === 0 ? 'last' : 'current'}>
                <td className='text-left text-muted-foreground'>{line?.label ?? '—'}</td>
                {statValues(line, isGoalie).map((value, valueIndex) => (
                  <td key={valueIndex} className='pl-2'>
                    {value}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </article>
  );
}
