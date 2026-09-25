import { useState } from 'react';
import type {
    PlayerContractLine,
    RosterEntry,
    SeasonStatLine,
} from '@/api/client';
import { cn } from '@/lib/utils';
import { NhlTeamLogo } from '@/components/nhl/NhlTeamLogo';

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

/**
 * "7 850 000 $ · 3 ans" for one contract, or null when there is no contract.
 * The singular "an" is used when only one season is left.
 */
function contractLabel(contract: PlayerContractLine | null): string | null {
    if (!contract) {
        return null;
    }

    const salary = `${salaryFormatter.format(contract.salary)} $`;
    const years =
        contract.yearsRemaining > 1
            ? `${contract.yearsRemaining} ans`
            : '1 an';

    return `${salary} · ${years}`;
}

interface PlayerCardProps {
    entry: RosterEntry;
    /** Extra classes applied to the card container (optional). */
    className?: string;
}

/**
 * NHL-style player card. Tablets and up show the full card (headshot,
 * previous + current season stats, contracts); phones show a compact row
 * with the same two stat lines and the current contract.
 */
export function PlayerCard({ entry, className = '' }: PlayerCardProps) {
    const [imageFailed, setImageFailed] = useState(false);
    const isGoalie = entry.position === 'G';
    const columns = isGoalie ? goalieColumns : skaterColumns;
    const lines = [entry.lastSeason, entry.currentSeason];
    const showImage = Boolean(entry.headshotUrl) && !imageFailed;
    const initials = `${entry.firstName.charAt(0)}${entry.lastName.charAt(0)}`;

    // Salary text for the current contract, with a fallback on the cached
    // FantasySalary when the API did not send a contract line.
    const currentContractLabel =
        contractLabel(entry.currentContract) ??
        `${salaryFormatter.format(entry.fantasySalary)} $`;

    return (
        <article
            className={cn(
                'relative h-34 overflow-hidden rounded-lg border border-border bg-card p-3 md:h-auto md:min-h-46',
                className,
            )}
        >
            {/* Full card - tablets and up. */}
            <div className='hidden md:block'>
                <div className='flex items-center justify-center gap-2 pl-54 pr-12'>
                    <h3 className='truncate text-center text-xl font-semibold text-foreground'>
                        {entry.firstName} {entry.lastName}
                    </h3>

                    <span className='shrink-0 text-xs uppercase tracking-wide text-muted-foreground'>
                        {entry.position}
                    </span>

                    <NhlTeamLogo
                        abbreviation={entry.nhlTeamAbbreviation}
                        size={24}
                    />
                </div>

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
                            {initials}
                        </div>
                    )}

                    <div className='pl-54'>
                        <table className='relative top-[35px] w-full text-right text-xs tabular-nums'>
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

                        {/* Current contract only. */}
                        <div className='mt-2 flex w-full items-center justify-center gap-3 text-xs text-muted-foreground'>
                            <span>{currentContractLabel}</span>
                        </div>
                    </div>
                </div>
            </div>

            {/* Compact row - phones only. */}
            <div className='relative flex h-full items-center gap-3 md:hidden'>
                {/* Player headshot. */}
                <div className='flex h-24 w-24 shrink-0 items-center justify-center overflow-hidden rounded-md bg-white'>
                    {showImage ? (
                        <img
                            src={entry.headshotUrl ?? undefined}
                            alt={`${entry.firstName} ${entry.lastName}`}
                            className='h-full w-full object-cover'
                            loading='lazy'
                            onError={() => setImageFailed(true)}
                        />
                    ) : (
                        <span className='text-sm font-semibold text-muted-foreground'>
                            {initials}
                        </span>
                    )}
                </div>

                {/* Right-side content area. */}
                <div className='relative min-w-0 flex-1'>
                    {/* Name + position + logo. */}
                    <div className='absolute left-0 right-0 top-[-9px] flex items-center justify-center gap-1.5'>
                        <p className='truncate text-sm font-semibold text-foreground'>
                            {entry.firstName} {entry.lastName}
                        </p>

                        <span className='shrink-0 text-xs uppercase tracking-wide text-muted-foreground'>
                            {entry.position}
                        </span>

                        <NhlTeamLogo
                            abbreviation={entry.nhlTeamAbbreviation}
                            size={18}
                        />
                    </div>

                    {/* Previous + current season stats, then current contract. */}
                    <div className='pt-9'>
                        <table className='relative top-[-5px] w-full text-right text-xs tabular-nums'>
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

                        <div className='mt-1 translate-y-[5px] flex w-full items-center justify-center gap-3 text-xs text-muted-foreground'>
                            <span>{currentContractLabel}</span>
                        </div>
                    </div>
                </div>
            </div>
        </article>
    );
}