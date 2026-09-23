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
 * NHL-style player card: name centered in the space to the right of the
 * headshot, headshot centered vertically, previous and current season stats
 * on the right, and fantasy salary displayed below the stats.
 */
export function PlayerCard({ entry, className = '' }: PlayerCardProps) {
    const [imageFailed, setImageFailed] = useState(false);
    const isGoalie = entry.position === 'G';
    const columns = isGoalie ? goalieColumns : skaterColumns;
    const lines = [entry.lastSeason, entry.currentSeason];
    const showImage = Boolean(entry.headshotUrl) && !imageFailed;

    return (
        <article
            className={cn('relative min-h-46 rounded-lg border border-border bg-card p-3', className)}
        >
            <h3 className='truncate pl-54 pr-12 text-center text-xl font-semibold text-foreground'>
                {entry.firstName} {entry.lastName}
            </h3>

            <p className='truncate pl-54 pr-12 text-center text-xs uppercase tracking-wide text-muted-foreground'>
                {entry.position} · {entry.nhlTeamAbbreviation}
            </p>

            <div className='mt-2'>
                {showImage ? (
                    <img
                        src={entry.headshotUrl ?? undefined}
                        alt={`${entry.firstName} ${entry.lastName}`}
                        className='absolute left-3 top-1/2 h-38 w-38 -translate-y-1/2 rounded-md bg-white object-cover'
                        loading='lazy'
                        onError={() => setImageFailed(true)}
                    />
                ) : (
                    <div className='absolute left-3 top-1/2 flex h-50 w-50 -translate-y-1/2 items-center justify-center rounded-md bg-white text-lg font-semibold text-muted-foreground'>
                        {entry.firstName.charAt(0)}
                        {entry.lastName.charAt(0)}
                    </div>
                )}

                <div className='pl-54'>
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
                                    <td className='text-left text-muted-foreground'>
                                        {line?.label ?? '—'}
                                    </td>

                                    {statValues(line, isGoalie).map((value, valueIndex) => (
                                        <td key={valueIndex} className='pl-2'>
                                            {value}
                                        </td>
                                    ))}
                                </tr>
                            ))}
                        </tbody>
                    </table>

                    <div className='mt-2 text-center text-xs text-muted-foreground'>
                        {salaryFormatter.format(entry.fantasySalary)} $
                    </div>
                </div>
            </div>
        </article>
    );
}