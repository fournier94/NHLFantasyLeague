import { useState } from 'react';
import type {
    PlayerContractLine,
    RosterEntry,
    SeasonStatLine,
} from '@/api/client';
import { cn } from '@/lib/utils';
import { NhlTeamLogo } from '@/components/nhl/NhlTeamLogo';
import { getNhlTeamColor } from '@/lib/nhlTeamColors';

// Goalies show PJ/V/D/DP; skaters show PJ/B/A/PTS.
const skaterColumns = ['PJ', 'B', 'A', 'PTS'];
const goalieColumns = ['PJ', 'V', 'D', 'DP'];

const TWO_SEASONS_AGO_CODE = 20242025;
const PREVIOUS_SEASON_CODE = 20252026;
const CURRENT_SEASON_CODE = 20262027;

function seasonLabelFromCode(code: number): string {
    const startYear = Math.floor(code / 10000);
    const endYear = code % 100;

    return `${startYear}-${endYear.toString().padStart(2, '0')}`;
}

function statValues(
    line: SeasonStatLine | null,
    isGoalie: boolean,
): (string | number)[] {
    if (!line) {
        return ['-', '-', '-', '-'];
    }

    return isGoalie
        ? [line.gamesPlayed, line.wins, line.losses, line.overtimeLosses]
        : [line.gamesPlayed, line.goals, line.assists, line.points];
}

function shortName(firstName: string, lastName: string): string {
    const initial = firstName.trim().charAt(0);

    return initial
        ? `${initial.toUpperCase()}. ${lastName}`
        : lastName;
}

function shortSeasonLabel(label: string): string {
    return label.replace(/^20/, '');
}

function compactSalary(salary: number): string {
    const millions = salary / 1_000_000;
    const rounded = millions.toFixed(2).replace(/\.?0+$/, '');

    return `${rounded}M`;
}

function contractLabel(
    contract: PlayerContractLine | null,
): string | null {
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
    className?: string;
}

const whiteTextGlow = `
    0 0 3px rgba(255, 255, 255, 0.35),
    0 0 6px rgba(255, 255, 255, 0.15)
`;

export function PlayerCard({
    entry,
    className = '',
}: PlayerCardProps) {
    const [imageFailed, setImageFailed] = useState(false);
    const isGoalie = entry.position === 'G';
    const columns = isGoalie ? goalieColumns : skaterColumns;

    const rows: { code: number; line: SeasonStatLine | null }[] = [
        { code: CURRENT_SEASON_CODE, line: entry.currentSeason },
        { code: PREVIOUS_SEASON_CODE, line: entry.lastSeason },
        { code: TWO_SEASONS_AGO_CODE, line: entry.twoSeasonsAgo },
    ];

    const showImage =
        Boolean(entry.headshotUrl) && !imageFailed;

    const initials = `${entry.firstName.charAt(0)}${entry.lastName.charAt(0)}`;
    const displayName = shortName(
        entry.firstName,
        entry.lastName,
    );

    const currentContractLabel =
        contractLabel(entry.currentContract) ??
        compactSalary(entry.fantasySalary);

    const secondContractLabel =
        contractLabel(entry.secondContract);

    const hasTwoContracts = Boolean(secondContractLabel);

    const playerTeamColor = getNhlTeamColor(
        entry.nhlTeamAbbreviation,
    );

    return (
        <article
            className={cn(
                'relative h-34 overflow-hidden rounded-lg border border-border bg-card p-3 md:h-auto md:min-h-46',
                className,
            )}
        >
            {/* Subtle team-color auras emanating inward from the card edges. */}
            <div
                aria-hidden='true'
                className='pointer-events-none absolute inset-0'
                style={{
                    background: `
                        radial-gradient(
                            circle at 100% 0%,
                            ${playerTeamColor}38 0%,
                            ${playerTeamColor}20 10%,
                            transparent 30%
                        ),
                        radial-gradient(
                            circle at 100% 100%,
                            ${playerTeamColor}38 0%,
                            ${playerTeamColor}20 10%,
                            transparent 30%
                        ),
                        radial-gradient(
                            ellipse at 50% 0%,
                            ${playerTeamColor}28 0%,
                            ${playerTeamColor}14 12%,
                            transparent 28%
                        ),
                        radial-gradient(
                            ellipse at 50% 100%,
                            ${playerTeamColor}28 0%,
                            ${playerTeamColor}14 12%,
                            transparent 28%
                        )
                    `,
                }}
            />

            <div className='relative z-10 hidden md:block'>
                <div className='flex items-center justify-center gap-2 pl-54 pr-12'>
                    {/* Medium team-color aura around the player name. */}
                    <h3
                        className='truncate text-center text-xl font-semibold text-white'
                        style={{
                            textShadow: `
                                0 0 4px ${playerTeamColor}CC,
                                0 0 9px ${playerTeamColor}99,
                                0 0 16px ${playerTeamColor}55
                            `,
                        }}
                    >
                        {displayName}
                    </h3>

                    <span
                        className='shrink-0 text-xs uppercase tracking-wide text-white'
                        style={{
                            textShadow: whiteTextGlow,
                        }}
                    >
                        {entry.position}
                    </span>

                    {/* Strong team-color aura around the NHL logo. */}
                    <div
                        className='shrink-0'
                        style={{
                            filter: `
                                drop-shadow(0 0 4px ${playerTeamColor})
                                drop-shadow(0 0 9px ${playerTeamColor}EE)
                                drop-shadow(0 0 16px ${playerTeamColor}BB)
                            `,
                        }}
                    >
                        <NhlTeamLogo
                            abbreviation={entry.nhlTeamAbbreviation}
                            size={24}
                        />
                    </div>
                </div>

                <div className='mt-2'>
                    {/* Strong team-color aura around the player picture. */}
                    <div
                        className='absolute left-3 top-1/2 h-38 w-38 -translate-y-1/2 rounded-md'
                        style={{
                            boxShadow: `
                                0 0 10px ${playerTeamColor},
                                0 0 22px ${playerTeamColor}DD,
                                0 0 40px ${playerTeamColor}AA,
                                0 0 65px ${playerTeamColor}66
                            `,
                        }}
                    >
                        {showImage ? (
                            <img
                                src={entry.headshotUrl ?? undefined}
                                alt={displayName}
                                className='h-full w-full rounded-md bg-white object-cover'
                                loading='lazy'
                                onError={() => setImageFailed(true)}
                            />
                        ) : (
                            <div className='flex h-full w-full items-center justify-center rounded-md bg-white text-lg font-semibold text-black'>
                                {initials}
                            </div>
                        )}
                    </div>

                    <div className='pl-54'>
                        <table className='relative top-[35px] w-full text-xs tabular-nums'>
                            <thead>
                                <tr className='text-white'>
                                    <th className='w-1/6 px-1 text-left font-normal' />
                                    <th className='w-1/6 px-1 text-left font-normal' />

                                    {columns.map((column) => (
                                        <th
                                            key={column}
                                            className='w-1/6 px-1 text-center font-normal'
                                            style={{
                                                textShadow: whiteTextGlow,
                                            }}
                                        >
                                            {column}
                                        </th>
                                    ))}
                                </tr>
                            </thead>

                            <tbody className='text-white'>
                                {rows.map((row, index) => {
                                    const rawLabel =
                                        row.line?.label ??
                                        seasonLabelFromCode(row.code);

                                    return (
                                        <tr key={index}>
                                            <td
                                                className='px-1 text-left text-white'
                                                style={{
                                                    textShadow: whiteTextGlow,
                                                }}
                                            >
                                                {shortSeasonLabel(rawLabel)}
                                            </td>

                                            <td
                                                className='px-1 text-left text-white'
                                                style={{
                                                    textShadow: whiteTextGlow,
                                                }}
                                            >
                                                {row.line?.leagueAbbreviation ?? '—'}
                                            </td>

                                            {statValues(
                                                row.line,
                                                isGoalie,
                                            ).map(
                                                (
                                                    value,
                                                    valueIndex,
                                                ) => (
                                                    <td
                                                        key={valueIndex}
                                                        className='px-1 text-center text-white'
                                                        style={{
                                                            textShadow: whiteTextGlow,
                                                        }}
                                                    >
                                                        {value}
                                                    </td>
                                                ),
                                            )}
                                        </tr>
                                    );
                                })}
                            </tbody>
                        </table>

                        {hasTwoContracts ? (
                            <div
                                className='relative top-[35px] mt-2 flex w-full items-center justify-between text-xs text-white'
                                style={{
                                    textShadow: whiteTextGlow,
                                }}
                            >
                                <span>
                                    {currentContractLabel}
                                </span>

                                <span
                                    aria-hidden='true'
                                    className='text-[0.7rem] text-white opacity-80'
                                >
                                    →
                                </span>

                                <span className='text-[0.7rem] text-white'>
                                    {secondContractLabel}
                                </span>
                            </div>
                        ) : (
                            <div
                                className='relative top-[35px] mt-2 flex w-full items-center justify-center text-xs text-white'
                                style={{
                                    textShadow: whiteTextGlow,
                                }}
                            >
                                <span>
                                    {currentContractLabel}
                                </span>
                            </div>
                        )}
                    </div>
                </div>
            </div>

            <div className='relative z-10 flex h-full items-center gap-3 md:hidden'>
                {/* Strong team-color aura around the mobile player picture. */}
                <div
                    className='flex h-24 w-24 shrink-0 items-center justify-center overflow-hidden rounded-md bg-white'
                    style={{
                        boxShadow: `
                            0 0 8px ${playerTeamColor},
                            0 0 18px ${playerTeamColor}DD,
                            0 0 32px ${playerTeamColor}AA,
                            0 0 50px ${playerTeamColor}66
                        `,
                    }}
                >
                    {showImage ? (
                        <img
                            src={entry.headshotUrl ?? undefined}
                            alt={displayName}
                            className='h-full w-full object-cover'
                            loading='lazy'
                            onError={() => setImageFailed(true)}
                        />
                    ) : (
                        <span
                            className='text-sm font-semibold text-black'
                            style={{
                                textShadow: whiteTextGlow,
                            }}
                        >
                            {initials}
                        </span>
                    )}
                </div>

                <div className='relative min-w-0 flex-1'>
                    <div className='absolute left-0 right-0 top-[-4px] flex items-center justify-center gap-1.5'>
                        {/* Medium team-color aura around the mobile player name. */}
                        <p
                            className='truncate text-sm font-semibold text-white'
                            style={{
                                textShadow: `
                                    0 0 3px ${playerTeamColor}CC,
                                    0 0 7px ${playerTeamColor}99,
                                    0 0 12px ${playerTeamColor}55
                                `,
                            }}
                        >
                            {displayName}
                        </p>

                        <span
                            className='shrink-0 text-xs uppercase tracking-wide text-white'
                            style={{
                                textShadow: whiteTextGlow,
                            }}
                        >
                            {entry.position}
                        </span>

                        {/* Strong team-color aura around the mobile NHL logo. */}
                        <div
                            className='shrink-0'
                            style={{
                                filter: `
                                    drop-shadow(0 0 3px ${playerTeamColor})
                                    drop-shadow(0 0 7px ${playerTeamColor}EE)
                                    drop-shadow(0 0 12px ${playerTeamColor}BB)
                                `,
                            }}
                        >
                            <NhlTeamLogo
                                abbreviation={entry.nhlTeamAbbreviation}
                                size={18}
                            />
                        </div>
                    </div>

                    <div className='pt-9'>
                        <table className='relative top-[-6px] w-full text-xs tabular-nums'>
                            <thead>
                                <tr className='text-white'>
                                    <th className='whitespace-nowrap px-0.5 text-left font-normal' />
                                    <th className='w-1/6 px-0.5 text-left font-normal' />

                                    {columns.map((column) => (
                                        <th
                                            key={column}
                                            className='w-1/6 px-0.5 text-center font-normal text-white'
                                            style={{
                                                textShadow: whiteTextGlow,
                                            }}
                                        >
                                            {column}
                                        </th>
                                    ))}
                                </tr>
                            </thead>

                            <tbody className='text-white'>
                                {rows.map((row, index) => {
                                    const rawLabel =
                                        row.line?.label ??
                                        seasonLabelFromCode(row.code);

                                    return (
                                        <tr key={index}>
                                            <td
                                                className='whitespace-nowrap px-0.5 text-left text-white'
                                                style={{
                                                    textShadow: whiteTextGlow,
                                                }}
                                            >
                                                {shortSeasonLabel(rawLabel)}
                                            </td>

                                            <td
                                                className='px-0.5 text-left text-white'
                                                style={{
                                                    textShadow: whiteTextGlow,
                                                }}
                                            >
                                                {row.line?.leagueAbbreviation ?? '—'}
                                            </td>

                                            {statValues(
                                                row.line,
                                                isGoalie,
                                            ).map(
                                                (
                                                    value,
                                                    valueIndex,
                                                ) => (
                                                    <td
                                                        key={valueIndex}
                                                        className='px-0.5 text-center text-white'
                                                        style={{
                                                            textShadow: whiteTextGlow,
                                                        }}
                                                    >
                                                        {value}
                                                    </td>
                                                ),
                                            )}
                                        </tr>
                                    );
                                })}
                            </tbody>
                        </table>

                        {hasTwoContracts ? (
                            <div
                                className='mt-1 flex w-full translate-y-[3px] items-center justify-between text-xs text-white'
                                style={{
                                    textShadow: whiteTextGlow,
                                }}
                            >
                                <span>
                                    {currentContractLabel}
                                </span>

                                <span
                                    aria-hidden='true'
                                    className='text-[0.7rem] text-white opacity-80'
                                >
                                    →
                                </span>

                                <span className='text-[0.7rem] text-white'>
                                    {secondContractLabel}
                                </span>
                            </div>
                        ) : (
                            <div
                                className='mt-1 flex w-full translate-y-[3px] items-center justify-center text-xs text-white'
                                style={{
                                    textShadow: whiteTextGlow,
                                }}
                            >
                                <span>
                                    {currentContractLabel}
                                </span>
                            </div>
                        )}
                    </div>
                </div>
            </div>
        </article>
    );
}