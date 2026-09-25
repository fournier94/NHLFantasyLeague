import { useState } from 'react';
import type {
    PlayerContractLine,
    RosterEntry,
    SeasonStatLine,
} from '@/api/client';
import { cn } from '@/lib/utils';
import { NhlTeamLogo } from '@/components/nhl/NhlTeamLogo';

// Goalies show PJ/V/D/DP; skaters show PJ/B/A/PTS.
const skaterColumns = ['PJ', 'B', 'A', 'PTS'];
const goalieColumns = ['PJ', 'V', 'D', 'DP'];

/**
 * Season codes for the three rows on the card. Must stay in sync with
 * the constants in RosterAdminService.
 */
const TWO_SEASONS_AGO_CODE = 20242025;
const PREVIOUS_SEASON_CODE = 20252026;
const CURRENT_SEASON_CODE = 20262027;

/**
 * Builds the display label from a season code, e.g. 20252026 -> "2025-26".
 * Used as a fallback when the API did not send a stat line for the season.
 */
function seasonLabelFromCode(code: number): string {
    const startYear = Math.floor(code / 10000);
    const endYear = code % 100;

    return `${startYear}-${endYear.toString().padStart(2, '0')}`;
}

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
 * Shortens a first name to its initial: "Cale Makar" -> "C. Makar".
 * Falls back to just the last name when the first name is empty.
 */
function shortName(firstName: string, lastName: string): string {
    const initial = firstName.trim().charAt(0);

    return initial
        ? `${initial.toUpperCase()}. ${lastName}`
        : lastName;
}

/**
 * Shortens a season label:
 *   "2025-26" -> "25-26"
 *   "2024-25" -> "24-25"
 */
function shortSeasonLabel(label: string): string {
    return label.replace(/^20/, '');
}

/**
 * Compact millions label for one contract:
 *   4 000 000 -> "4M"
 *   4 150 000 -> "4.15M"
 *   950 000   -> "0.95M"
 *   20 000 000 -> "20M"
 * Trailing zeros and a trailing decimal point are removed.
 * No "$" suffix.
 */
function compactSalary(salary: number): string {
    const millions = salary / 1_000_000;

    // Round to 2 decimals, then drop trailing zeros / trailing dot.
    const rounded = millions.toFixed(2).replace(/\.?0+$/, '');

    return `${rounded}M`;
}

/**
 * One contract line: salary in millions, plus the number of seasons left.
 * "7.85M · 3 ans" / "0.95M · 1 an".
 */
function contractLabel(contract: PlayerContractLine | null): string | null {
    if (!contract) {
        return null;
    }

    const salary = compactSalary(contract.salary);
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
 * three seasons of stats, contracts); phones show a compact row with
 * the same three stat lines and both contracts.
 *
 * Stats table:
 *  - Desktop: six columns, each `w-1/6`, evenly distributed.
 *  - Mobile: the season-label column sizes to content and never wraps;
 *    the league and the four stat columns each take `w-1/6` of the
 *    remaining table width, so the table stretches edge-to-edge between
 *    the headshot and the right side of the card.
 *
 * Row order: current season, previous season, two seasons ago.
 *
 * When a player has no stat line for a season, the row still appears
 * with the season label and dashes for the values, so the card always
 * shows three years.
 *
 * The league column has a header cell so the widths line up, but that
 * header is empty: the league abbreviation only shows in the body rows.
 *
 * Contract layout:
 *  - One contract: centered.
 *  - Two contracts: first flush left with the stats column, second flush
 *    right, arrow in between pointing at the second contract.
 */
export function PlayerCard({ entry, className = '' }: PlayerCardProps) {
    const [imageFailed, setImageFailed] = useState(false);
    const isGoalie = entry.position === 'G';
    const columns = isGoalie ? goalieColumns : skaterColumns;

    // Current season first, then previous season, then two seasons ago.
    // Each entry carries the season code so we can build the label even
    // when the stat line is missing from the API.
    const rows: { code: number; line: SeasonStatLine | null }[] = [
        { code: CURRENT_SEASON_CODE, line: entry.currentSeason },
        { code: PREVIOUS_SEASON_CODE, line: entry.lastSeason },
        { code: TWO_SEASONS_AGO_CODE, line: entry.twoSeasonsAgo },
    ];

    const showImage = Boolean(entry.headshotUrl) && !imageFailed;
    const initials = `${entry.firstName.charAt(0)}${entry.lastName.charAt(0)}`;
    const displayName = shortName(entry.firstName, entry.lastName);

    // Current contract: compact label, with a fallback on the cached
    // FantasySalary when the API did not send a contract line.
    const currentContractLabel =
        contractLabel(entry.currentContract) ??
        compactSalary(entry.fantasySalary);

    const secondContractLabel = contractLabel(entry.secondContract);
    const hasTwoContracts = Boolean(secondContractLabel);

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
                        {displayName}
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
                            alt={displayName}
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
                        <table className='relative top-[35px] w-full text-xs tabular-nums'>
                            <thead>
                                <tr className='text-muted-foreground'>
                                    <th className='w-1/6 px-1 text-left font-normal' />
                                    {/* Empty header cell for the league
                                        column: keeps the column width
                                        aligned without a label. */}
                                    <th className='w-1/6 px-1 text-left font-normal' />
                                    {columns.map((column) => (
                                        <th
                                            key={column}
                                            className='w-1/6 px-1 text-center font-normal'
                                        >
                                            {column}
                                        </th>
                                    ))}
                                </tr>
                            </thead>

                            <tbody className='text-foreground'>
                                {rows.map((row, index) => {
                                    const rawLabel =
                                        row.line?.label ??
                                        seasonLabelFromCode(row.code);

                                    return (
                                        <tr key={index}>
                                            <td className='px-1 text-left text-muted-foreground'>
                                                {shortSeasonLabel(rawLabel)}
                                            </td>

                                            <td className='px-1 text-left text-muted-foreground'>
                                                {row.line?.leagueAbbreviation ?? '—'}
                                            </td>

                                            {statValues(row.line, isGoalie).map((value, valueIndex) => (
                                                <td
                                                    key={valueIndex}
                                                    className='px-1 text-center'
                                                >
                                                    {value}
                                                </td>
                                            ))}
                                        </tr>
                                    );
                                })}
                            </tbody>
                        </table>

                        {/*
                          Contracts:
                          - One contract: centered.
                          - Two contracts: first flush left with the stats
                            column, second flush right, arrow in between
                            pointing at the second contract.
                        */}
                        {hasTwoContracts ? (
                            <div className='relative top-[35px] mt-2 flex w-full items-center justify-between text-xs text-muted-foreground'>
                                <span>{currentContractLabel}</span>

                                <span
                                    aria-hidden='true'
                                    className='text-[0.7rem] opacity-80'
                                >
                                    →
                                </span>

                                <span className='text-[0.7rem] opacity-80'>
                                    {secondContractLabel}
                                </span>
                            </div>
                        ) : (
                            <div className='relative top-[35px] mt-2 flex w-full items-center justify-center text-xs text-muted-foreground'>
                                <span>{currentContractLabel}</span>
                            </div>
                        )}
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
                            alt={displayName}
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

                {/* Right-side content area, stretched to fill the card. */}
                <div className='relative min-w-0 flex-1'>
                    {/* Name + position + logo. */}
                    <div className='absolute left-0 right-0 top-[-4px] flex items-center justify-center gap-1.5'>
                        <p className='truncate text-sm font-semibold text-foreground'>
                            {displayName}
                        </p>

                        <span className='shrink-0 text-xs uppercase tracking-wide text-muted-foreground'>
                            {entry.position}
                        </span>

                        <NhlTeamLogo
                            abbreviation={entry.nhlTeamAbbreviation}
                            size={18}
                        />
                    </div>

                    {/* Current + previous season stats, then contracts. */}
                    <div className='pt-9'>
                        <table className='relative top-[-6px] w-full text-xs tabular-nums'>
                            <thead>
                                <tr className='text-muted-foreground'>
                                    {/* Mobile: the label column sizes to
                                        content and never wraps, so the
                                        year always fits. The league and
                                        the four stat columns share the
                                        remaining width evenly. */}
                                    <th className='px-0.5 text-left font-normal whitespace-nowrap' />
                                    <th className='w-1/6 px-0.5 text-left font-normal' />
                                    {columns.map((column) => (
                                        <th
                                            key={column}
                                            className='w-1/6 px-0.5 text-center font-normal'
                                        >
                                            {column}
                                        </th>
                                    ))}
                                </tr>
                            </thead>

                            <tbody className='text-foreground'>
                                {rows.map((row, index) => {
                                    const rawLabel =
                                        row.line?.label ??
                                        seasonLabelFromCode(row.code);

                                    return (
                                        <tr key={index}>
                                            <td className='px-0.5 text-left text-muted-foreground whitespace-nowrap'>
                                                {shortSeasonLabel(rawLabel)}
                                            </td>

                                            <td className='px-0.5 text-left text-muted-foreground'>
                                                {row.line?.leagueAbbreviation ?? '—'}
                                            </td>

                                            {statValues(row.line, isGoalie).map((value, valueIndex) => (
                                                <td
                                                    key={valueIndex}
                                                    className='px-0.5 text-center'
                                                >
                                                    {value}
                                                </td>
                                            ))}
                                        </tr>
                                    );
                                })}
                            </tbody>
                        </table>

                        {/* Contracts: same layout rules as desktop. */}
                        {hasTwoContracts ? (
                            <div className='mt-1 translate-y-[3px] flex w-full items-center justify-between text-xs text-muted-foreground'>
                                <span>{currentContractLabel}</span>

                                <span
                                    aria-hidden='true'
                                    className='text-[0.7rem] opacity-80'
                                >
                                    →
                                </span>

                                <span className='text-[0.7rem] opacity-80'>
                                    {secondContractLabel}
                                </span>
                            </div>
                        ) : (
                            <div className='mt-1 translate-y-[3px] flex w-full items-center justify-center text-xs text-muted-foreground'>
                                <span>{currentContractLabel}</span>
                            </div>
                        )}
                    </div>
                </div>
            </div>
        </article>
    );
}