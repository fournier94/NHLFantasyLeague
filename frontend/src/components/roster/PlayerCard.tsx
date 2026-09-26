import { useState } from 'react';
import type {
    PlayerContractLine,
    RosterEntry,
    SeasonStatLine,
} from '@/api/client';
import { cn } from '@/lib/utils';
import { NhlTeamLogo } from '@/components/nhl/NhlTeamLogo';
import { getNhlTeamColor } from '@/lib/nhlTeamColors';
import { useAura } from '@/lib/auraContext';
import {
    auraAlphaHex,
    auraPulseClass,
    auraPulseStyle,
    auraRangeFor,
    isAuraOff,
} from '@/lib/auraConfig';

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

export function PlayerCard({
    entry,
    className = '',
}: PlayerCardProps) {
    const [imageFailed, setImageFailed] = useState(false);
    const isGoalie = entry.position === 'G';
    const columns = isGoalie ? goalieColumns : skaterColumns;

    // Five channels: background, name (drives name + position), logo,
    // picture, and the white text glow for the stats table + contracts.
    const bgAura = useAura('playerCardBackground');
    const nameAura = useAura('playerCardName');
    const logoAura = useAura('playerCardLogo');
    const pictureAura = useAura('playerCardPicture');
    const textAura = useAura('playerCardText');

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

    // --- Background auras (team color) -----------------------------------
    const bgInnerAlpha = auraAlphaHex(bgAura, 0x14, 0x48);
    const bgMidAlpha = auraAlphaHex(bgAura, 0x08, 0x28);
    const bgCenterInnerAlpha = auraAlphaHex(bgAura, 0x0c, 0x30);
    const bgCenterMidAlpha = auraAlphaHex(bgAura, 0x06, 0x1c);

    const bgCornerSpread = auraRangeFor(bgAura, 'playerCardBackground', 0);
    const bgCenterSpread = auraRangeFor(bgAura, 'playerCardBackground', 1);

    const backgroundStyle = !isAuraOff(bgAura)
        ? {
            background: `
                radial-gradient(
                    circle at 100% 0%,
                    ${playerTeamColor}${bgInnerAlpha} 0%,
                    ${playerTeamColor}${bgMidAlpha} 10%,
                    transparent ${bgCornerSpread}%
                ),
                radial-gradient(
                    circle at 100% 100%,
                    ${playerTeamColor}${bgInnerAlpha} 0%,
                    ${playerTeamColor}${bgMidAlpha} 10%,
                    transparent ${bgCornerSpread}%
                ),
                radial-gradient(
                    ellipse at 50% 0%,
                    ${playerTeamColor}${bgCenterInnerAlpha} 0%,
                    ${playerTeamColor}${bgCenterMidAlpha} 12%,
                    transparent ${bgCenterSpread}%
                ),
                radial-gradient(
                    ellipse at 50% 100%,
                    ${playerTeamColor}${bgCenterInnerAlpha} 0%,
                    ${playerTeamColor}${bgCenterMidAlpha} 12%,
                    transparent ${bgCenterSpread}%
                )
            `,
        }
        : undefined;

    // --- Name aura (team color) -----------------------------------------
    // Drives both the player name and the position label. The position
    // gets slightly smaller sizes (about 40% of the name's) so it does
    // not overpower its small font size, but the same intensity slider
    // controls both.
    const nameRest = [
        `0 0 ${auraRangeFor(nameAura, 'playerCardName', 0).toFixed(2)}px ${playerTeamColor}${auraAlphaHex(nameAura, 0x66, 0xCC)}`,
        `0 0 ${auraRangeFor(nameAura, 'playerCardName', 1).toFixed(2)}px ${playerTeamColor}${auraAlphaHex(nameAura, 0x33, 0xAA)}`,
        `0 0 ${auraRangeFor(nameAura, 'playerCardName', 2).toFixed(2)}px ${playerTeamColor}${auraAlphaHex(nameAura, 0x1A, 0x77)}`,
    ].join(', ');

    const namePeak = [
        `0 0 ${auraRangeFor(nameAura, 'playerCardName', 0).toFixed(2)}px ${playerTeamColor}${auraAlphaHex(nameAura, 0x88, 0xFF)}`,
        `0 0 ${auraRangeFor(nameAura, 'playerCardName', 1).toFixed(2)}px ${playerTeamColor}${auraAlphaHex(nameAura, 0x55, 0xDD)}`,
        `0 0 ${auraRangeFor(nameAura, 'playerCardName', 2).toFixed(2)}px ${playerTeamColor}${auraAlphaHex(nameAura, 0x33, 0xCC)}`,
    ].join(', ');

    // Position: same channel, team color, sizes scaled to 40%.
    const positionRest = [
        `0 0 ${(auraRangeFor(nameAura, 'playerCardName', 0) * 0.4).toFixed(2)}px ${playerTeamColor}${auraAlphaHex(nameAura, 0x66, 0xCC)}`,
        `0 0 ${(auraRangeFor(nameAura, 'playerCardName', 1) * 0.4).toFixed(2)}px ${playerTeamColor}${auraAlphaHex(nameAura, 0x33, 0xAA)}`,
        `0 0 ${(auraRangeFor(nameAura, 'playerCardName', 2) * 0.4).toFixed(2)}px ${playerTeamColor}${auraAlphaHex(nameAura, 0x1A, 0x77)}`,
    ].join(', ');

    const positionPeak = [
        `0 0 ${(auraRangeFor(nameAura, 'playerCardName', 0) * 0.4).toFixed(2)}px ${playerTeamColor}${auraAlphaHex(nameAura, 0x88, 0xFF)}`,
        `0 0 ${(auraRangeFor(nameAura, 'playerCardName', 1) * 0.4).toFixed(2)}px ${playerTeamColor}${auraAlphaHex(nameAura, 0x55, 0xDD)}`,
        `0 0 ${(auraRangeFor(nameAura, 'playerCardName', 2) * 0.4).toFixed(2)}px ${playerTeamColor}${auraAlphaHex(nameAura, 0x33, 0xCC)}`,
    ].join(', ');

    // --- Logo aura (team color, filter drop-shadow) -----------------------
    const logoRest = [
        `drop-shadow(0 0 ${auraRangeFor(logoAura, 'playerCardLogo', 0).toFixed(2)}px ${playerTeamColor}${auraAlphaHex(logoAura, 0x88, 0xFF)})`,
        `drop-shadow(0 0 ${auraRangeFor(logoAura, 'playerCardLogo', 1).toFixed(2)}px ${playerTeamColor}${auraAlphaHex(logoAura, 0x44, 0xEE)})`,
        `drop-shadow(0 0 ${auraRangeFor(logoAura, 'playerCardLogo', 2).toFixed(2)}px ${playerTeamColor}${auraAlphaHex(logoAura, 0x22, 0xBB)})`,
    ].join(' ');

    const logoPeak = [
        `drop-shadow(0 0 ${auraRangeFor(logoAura, 'playerCardLogo', 0).toFixed(2)}px ${playerTeamColor}${auraAlphaHex(logoAura, 0xAA, 0xFF)})`,
        `drop-shadow(0 0 ${auraRangeFor(logoAura, 'playerCardLogo', 1).toFixed(2)}px ${playerTeamColor}${auraAlphaHex(logoAura, 0x55, 0xEE)})`,
        `drop-shadow(0 0 ${auraRangeFor(logoAura, 'playerCardLogo', 2).toFixed(2)}px ${playerTeamColor}${auraAlphaHex(logoAura, 0x33, 0xBB)})`,
    ].join(' ');

    // --- Picture aura (team color, box-shadow) ----------------------------
    const pictureRest = [
        `0 0 ${auraRangeFor(pictureAura, 'playerCardPicture', 0).toFixed(2)}px ${playerTeamColor}${auraAlphaHex(pictureAura, 0x88, 0xFF)}`,
        `0 0 ${auraRangeFor(pictureAura, 'playerCardPicture', 1).toFixed(2)}px ${playerTeamColor}${auraAlphaHex(pictureAura, 0x44, 0xDD)}`,
        `0 0 ${auraRangeFor(pictureAura, 'playerCardPicture', 2).toFixed(2)}px ${playerTeamColor}${auraAlphaHex(pictureAura, 0x22, 0xAA)}`,
        `0 0 ${auraRangeFor(pictureAura, 'playerCardPicture', 3).toFixed(2)}px ${playerTeamColor}${auraAlphaHex(pictureAura, 0x00, 0x88)}`,
    ].join(', ');

    const picturePeak = [
        `0 0 ${auraRangeFor(pictureAura, 'playerCardPicture', 0).toFixed(2)}px ${playerTeamColor}${auraAlphaHex(pictureAura, 0xAA, 0xFF)}`,
        `0 0 ${auraRangeFor(pictureAura, 'playerCardPicture', 1).toFixed(2)}px ${playerTeamColor}${auraAlphaHex(pictureAura, 0x55, 0xEE)}`,
        `0 0 ${auraRangeFor(pictureAura, 'playerCardPicture', 2).toFixed(2)}px ${playerTeamColor}${auraAlphaHex(pictureAura, 0x33, 0xEE)}`,
        `0 0 ${auraRangeFor(pictureAura, 'playerCardPicture', 3).toFixed(2)}px ${playerTeamColor}${auraAlphaHex(pictureAura, 0x00, 0xBB)}`,
    ].join(', ');

    // --- Text aura (white, used for the stats table + contracts) ---------
    const textInnerRest = auraRangeFor(textAura, 'playerCardText', 0);
    const textMidRest = auraRangeFor(textAura, 'playerCardText', 1);
    const textInnerPeak = auraRangeFor(textAura, 'playerCardText', 0);
    const textMidPeak = auraRangeFor(textAura, 'playerCardText', 1);

    const textRest = [
        `0 0 ${textInnerRest.toFixed(2)}px rgba(255, 255, 255, ${(0.18 + (textInnerRest - 1) * 0.05).toFixed(2)})`,
        `0 0 ${textMidRest.toFixed(2)}px rgba(255, 255, 255, ${(0.06 + (textMidRest - 2) * 0.03).toFixed(2)})`,
    ].join(', ');

    const textPeak = [
        `0 0 ${textInnerPeak.toFixed(2)}px rgba(255, 255, 255, ${(0.25 + (textInnerPeak - 1) * 0.07).toFixed(2)})`,
        `0 0 ${textMidPeak.toFixed(2)}px rgba(255, 255, 255, ${(0.10 + (textMidPeak - 2) * 0.04).toFixed(2)})`,
    ].join(', ');

    return (
        <article
            className={cn(
                'relative h-34 overflow-hidden rounded-lg border border-border bg-card p-3 md:h-auto md:min-h-46',
                className,
            )}
        >
            {!isAuraOff(bgAura) && (
                <div
                    aria-hidden='true'
                    className='pointer-events-none absolute inset-0'
                    style={backgroundStyle}
                />
            )}

            <div className='relative z-10 hidden md:block'>
                <div className='flex items-center justify-center gap-2 pl-54 pr-12'>
                    <h3
                        className={`truncate text-center text-xl font-semibold text-white ${!isAuraOff(nameAura) ? auraPulseClass('text') : ''}`}
                        style={
                            !isAuraOff(nameAura)
                                ? auraPulseStyle(nameRest, namePeak)
                                : undefined
                        }
                    >
                        {displayName}
                    </h3>

                    <span
                        className={`shrink-0 text-xs uppercase tracking-wide text-white ${!isAuraOff(nameAura) ? auraPulseClass('text') : ''}`}
                        style={
                            !isAuraOff(nameAura)
                                ? auraPulseStyle(positionRest, positionPeak)
                                : undefined
                        }
                    >
                        {entry.position}
                    </span>

                    <div
                        className={`shrink-0 ${!isAuraOff(logoAura) ? auraPulseClass('filter') : ''}`}
                        style={
                            !isAuraOff(logoAura)
                                ? auraPulseStyle(logoRest, logoPeak)
                                : undefined
                        }
                    >
                        <NhlTeamLogo
                            abbreviation={entry.nhlTeamAbbreviation}
                            size={24}
                        />
                    </div>
                </div>

                <div className='mt-2'>
                    <div
                        className={`absolute left-3 top-1/2 h-38 w-38 -translate-y-1/2 rounded-md ${!isAuraOff(pictureAura) ? auraPulseClass('box') : ''}`}
                        style={
                            !isAuraOff(pictureAura)
                                ? auraPulseStyle(pictureRest, picturePeak)
                                : undefined
                        }
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
                                            className={`w-1/6 px-1 text-center font-normal ${!isAuraOff(textAura) ? auraPulseClass('text') : ''}`}
                                            style={
                                                !isAuraOff(textAura)
                                                    ? auraPulseStyle(textRest, textPeak)
                                                    : undefined
                                            }
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
                                                className={`px-1 text-left text-white ${!isAuraOff(textAura) ? auraPulseClass('text') : ''}`}
                                                style={
                                                    !isAuraOff(textAura)
                                                        ? auraPulseStyle(textRest, textPeak)
                                                        : undefined
                                                }
                                            >
                                                {shortSeasonLabel(rawLabel)}
                                            </td>

                                            <td
                                                className={`px-1 text-left text-white ${!isAuraOff(textAura) ? auraPulseClass('text') : ''}`}
                                                style={
                                                    !isAuraOff(textAura)
                                                        ? auraPulseStyle(textRest, textPeak)
                                                        : undefined
                                                }
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
                                                        className={`px-1 text-center text-white ${!isAuraOff(textAura) ? auraPulseClass('text') : ''}`}
                                                        style={
                                                            !isAuraOff(textAura)
                                                                ? auraPulseStyle(textRest, textPeak)
                                                                : undefined
                                                        }
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
                                className={`relative top-[35px] mt-2 flex w-full items-center justify-between text-xs text-white ${!isAuraOff(textAura) ? auraPulseClass('text') : ''}`}
                                style={
                                    !isAuraOff(textAura)
                                        ? auraPulseStyle(textRest, textPeak)
                                        : undefined
                                }
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
                                className={`relative top-[35px] mt-2 flex w-full items-center justify-center text-xs text-white ${!isAuraOff(textAura) ? auraPulseClass('text') : ''}`}
                                style={
                                    !isAuraOff(textAura)
                                        ? auraPulseStyle(textRest, textPeak)
                                        : undefined
                                }
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
                <div
                    className={`flex h-24 w-24 shrink-0 items-center justify-center overflow-hidden rounded-md bg-white ${!isAuraOff(pictureAura) ? auraPulseClass('box') : ''}`}
                    style={
                        !isAuraOff(pictureAura)
                            ? auraPulseStyle(pictureRest, picturePeak)
                            : undefined
                    }
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
                            className={`text-sm font-semibold text-black ${!isAuraOff(textAura) ? auraPulseClass('text') : ''}`}
                            style={
                                !isAuraOff(textAura)
                                    ? auraPulseStyle(textRest, textPeak)
                                    : undefined
                            }
                        >
                            {initials}
                        </span>
                    )}
                </div>

                <div className='relative min-w-0 flex-1'>
                    <div className='absolute left-0 right-0 top-[-4px] flex items-center justify-center gap-1.5'>
                        <p
                            className={`truncate text-sm font-semibold text-white ${!isAuraOff(nameAura) ? auraPulseClass('text') : ''}`}
                            style={
                                !isAuraOff(nameAura)
                                    ? auraPulseStyle(nameRest, namePeak)
                                    : undefined
                            }
                        >
                            {displayName}
                        </p>

                        <span
                            className={`shrink-0 text-xs uppercase tracking-wide text-white ${!isAuraOff(nameAura) ? auraPulseClass('text') : ''}`}
                            style={
                                !isAuraOff(nameAura)
                                    ? auraPulseStyle(positionRest, positionPeak)
                                    : undefined
                            }
                        >
                            {entry.position}
                        </span>

                        <div
                            className={`shrink-0 ${!isAuraOff(logoAura) ? auraPulseClass('filter') : ''}`}
                            style={
                                !isAuraOff(logoAura)
                                    ? auraPulseStyle(logoRest, logoPeak)
                                    : undefined
                            }
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
                                            className={`w-1/6 px-0.5 text-center font-normal text-white ${!isAuraOff(textAura) ? auraPulseClass('text') : ''}`}
                                            style={
                                                !isAuraOff(textAura)
                                                    ? auraPulseStyle(textRest, textPeak)
                                                    : undefined
                                            }
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
                                                className={`whitespace-nowrap px-0.5 text-left text-white ${!isAuraOff(textAura) ? auraPulseClass('text') : ''}`}
                                                style={
                                                    !isAuraOff(textAura)
                                                        ? auraPulseStyle(textRest, textPeak)
                                                        : undefined
                                                }
                                            >
                                                {shortSeasonLabel(rawLabel)}
                                            </td>

                                            <td
                                                className={`px-0.5 text-left text-white ${!isAuraOff(textAura) ? auraPulseClass('text') : ''}`}
                                                style={
                                                    !isAuraOff(textAura)
                                                        ? auraPulseStyle(textRest, textPeak)
                                                        : undefined
                                                }
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
                                                        className={`px-0.5 text-center text-white ${!isAuraOff(textAura) ? auraPulseClass('text') : ''}`}
                                                        style={
                                                            !isAuraOff(textAura)
                                                                ? auraPulseStyle(textRest, textPeak)
                                                                : undefined
                                                        }
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
                                className={`mt-1 flex w-full translate-y-[3px] items-center justify-between text-xs text-white ${!isAuraOff(textAura) ? auraPulseClass('text') : ''}`}
                                style={
                                    !isAuraOff(textAura)
                                        ? auraPulseStyle(textRest, textPeak)
                                        : undefined
                                }
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
                                className={`mt-1 flex w-full translate-y-[3px] items-center justify-center text-xs text-white ${!isAuraOff(textAura) ? auraPulseClass('text') : ''}`}
                                style={
                                    !isAuraOff(textAura)
                                        ? auraPulseStyle(textRest, textPeak)
                                        : undefined
                                }
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