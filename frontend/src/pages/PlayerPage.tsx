import { useEffect, useState } from 'react';
import { Link, useLocation, useNavigate, useParams } from 'react-router-dom';
import {
    getPlayerDetail,
    type CareerRow,
    type GameLogRow,
    type Month,
    type PlayerDetail,
} from '@/api/client';
import { cn } from '@/lib/utils';
import { useAura } from '@/lib/auraContext';
import {
    auraAlphaHex,
    auraPulseClass,
    auraPulseStyle,
    auraRangeFor,
    isAuraOff,
    AURA_STRIP_PULSE_REST_SCALE,
    AURA_STRIP_PULSE_PEAK_SCALE,
} from '@/lib/auraConfig';
import { getNhlTeamAuraColor } from '@/lib/nhlTeamColors';
import { getLastNonPlayerLocation } from '@/lib/playerNavigation';
import { useAuth } from '@/lib/AuthContext';
import ReactCountryFlag from 'react-country-flag';
import { NhlTeamLogo } from '@/components/nhl/NhlTeamLogo';
import { NeonTitle } from '@/components/ui/NeonTitle';
import { Banknote, Ruler } from 'lucide-react';

// ---------------------------------------------------------------------
// Formatters
// ---------------------------------------------------------------------

const COUNTRY_CODE_MAP: Record<string, string> = {
    CAN: 'CA',
    USA: 'US',
    SWE: 'SE',
    FIN: 'FI',
    RUS: 'RU',
    CZE: 'CZ',
    SVK: 'SK',
    CHE: 'CH',
    DEU: 'DE',
    AUT: 'AT',
    DNK: 'DK',
    NOR: 'NO',
    LVA: 'LV',
    SVN: 'SI',
    BLR: 'BY',
    KAZ: 'KZ',
    GBR: 'GB',
    ENG: 'GB',
    FRA: 'FR',
    POL: 'PL',
};

function toFlagCode(country: string | null | undefined): string | null {
    if (!country) return null;
    return COUNTRY_CODE_MAP[country.toUpperCase()] ?? country.toUpperCase();
}

const dateFormatter = new Intl.DateTimeFormat('fr-CA', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
});

const shortDateFormatter = new Intl.DateTimeFormat('fr-CA', {
    day: 'numeric',
    month: 'short',
});

const CURRENT_SEASON_CODE = 20262027;

function compactSalary(salary: number): string {
    const millions = salary / 1_000_000;
    const rounded = millions.toFixed(2).replace(/\.?0+$/, '');
    return `${rounded}M`;
}

function contractLabel(
    salary: number,
    yearsRemaining: number,
): string {
    const salaryText = compactSalary(salary);
    const years = yearsRemaining > 1
        ? `${yearsRemaining} ans`
        : '1 an';
    return `${salaryText} · ${years}`;
}

function shortDate(value: string | null): string {
    if (!value) return '—';
    return dateFormatter.format(new Date(value));
}

function shortGameDate(value: string): string {
    return shortDateFormatter.format(new Date(value));
}

function teamDisplay(row: CareerRow): string {
    if (row.teamName && row.teamName.trim().length > 0) {
        return row.teamName;
    }
    return '—';
}

function isNhlRow(row: CareerRow): boolean {
    return row.leagueAbbreviation.toUpperCase() === 'NHL';
}

function normalizePosition(position: string): string {
    return position
        .trim()
        .toUpperCase()
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .replace(/\s+/g, ' ');
}

function displayPosition(position: string): string {
    switch (normalizePosition(position)) {
        case 'L':
        case 'LW':
        case 'LEFT WING':
        case 'LEFTWING':
        case 'AG':
        case 'AILIER GAUCHE':
            return 'AG';

        case 'R':
        case 'RW':
        case 'RIGHT WING':
        case 'RIGHTWING':
        case 'AD':
        case 'AILIER DROIT':
            return 'AD';

        default:
            return position;
    }
}

/**
 * Given a player's draft year (e.g. 2019), returns the season code of
 * the boundary below which the draft line should be drawn.
 *
 * If the player was drafted in 2019, the line goes between the 2019-20
 * season and the 2018-19 season, i.e. right below the 2018-19 row and
 * right above the 2019-20 row. We return the 2019-20 season code, and
 * every row whose season is STRICTLY LOWER than it goes below the line.
 */
function draftedBoundarySeason(draftYear: number): number {
    // The season that starts the year he was drafted: 2019 -> 20192020
    return draftYear * 10000 + (draftYear + 1);
}

/**
 * Best-effort lookup of a player's first draft-eligible year when the
 * NHL never drafted him. The NHL draft cutoff is Sept 15, so:
 *   - Born on or before Sep 15 of year Y  -> first eligible in year Y+18
 *   - Born after Sep 15 of year Y         -> first eligible in year Y+19
 *
 * If we don't have a birth date, we return null and the table simply
 * skips the line for that player.
 */
function firstEligibleDraftYear(
    birthDate: string | null | undefined,
): number | null {
    if (!birthDate) return null;

    const d = new Date(birthDate);
    if (Number.isNaN(d.getTime())) return null;

    const year = d.getUTCFullYear();
    const month = d.getUTCMonth() + 1; // 1..12
    const day = d.getUTCDate();

    const bornAfterCutoff =
        month > 9 || (month === 9 && day > 15);

    return bornAfterCutoff ? year + 19 : year + 18;
}

const POSITION_GROUPS: Record<string, 'F' | 'D' | 'G'> = {
    // Forwards
    'C': 'F',
    'CENTER': 'F',
    'CENTRE': 'F',
    'L': 'F',
    'R': 'F',
    'LW': 'F',
    'RW': 'F',
    'W': 'F',
    'F': 'F',
    'LEFT WING': 'F',
    'RIGHT WING': 'F',
    'LEFTWING': 'F',
    'RIGHTWING': 'F',
    'WINGER': 'F',
    'FORWARD': 'F',
    'AG': 'F',
    'AD': 'F',
    'A': 'F',
    'AILIER': 'F',
    'AILIER GAUCHE': 'F',
    'AILIER DROIT': 'F',
    'AVANT': 'F',
    'ATTAQUANT': 'F',

    // Defensemen
    'D': 'D',
    'DEFENSE': 'D',
    'DEFENCE': 'D',
    'DEFENSEMAN': 'D',
    'DEFENCEMAN': 'D',
    'LD': 'D',
    'RD': 'D',
    'LEFT DEFENSE': 'D',
    'RIGHT DEFENSE': 'D',
    'DEFENSEUR': 'D',
    'ARRIERE': 'D',

    // Goalies
    'G': 'G',
    'GK': 'G',
    'GB': 'G',
    'GOALIE': 'G',
    'GOALTENDER': 'G',
    'GARDIEN': 'G',
};

function positionGroup(
    position: string | null | undefined,
): 'F' | 'D' | 'G' | '' {
    if (!position) return '';
    return POSITION_GROUPS[normalizePosition(position)] ?? '';
}

const NHL_TEAM_ABBREVIATIONS: Record<string, string> = {
    'Anaheim Ducks': 'ANA',
    'Boston Bruins': 'BOS',
    'Buffalo Sabres': 'BUF',
    'Calgary Flames': 'CGY',
    'Carolina Hurricanes': 'CAR',
    'Chicago Blackhawks': 'CHI',
    'Colorado Avalanche': 'COL',
    'Columbus Blue Jackets': 'CBJ',
    'Dallas Stars': 'DAL',
    'Detroit Red Wings': 'DET',
    'Edmonton Oilers': 'EDM',
    'Florida Panthers': 'FLA',
    'Los Angeles Kings': 'LAK',
    'Minnesota Wild': 'MIN',
    'Montréal Canadiens': 'MTL',
    'Montreal Canadiens': 'MTL',
    'Nashville Predators': 'NSH',
    'New Jersey Devils': 'NJD',
    'New York Islanders': 'NYI',
    'New York Rangers': 'NYR',
    'Ottawa Senators': 'OTT',
    'Philadelphia Flyers': 'PHI',
    'Pittsburgh Penguins': 'PIT',
    'San Jose Sharks': 'SJS',
    'Seattle Kraken': 'SEA',
    'St. Louis Blues': 'STL',
    'Tampa Bay Lightning': 'TBL',
    'Toronto Maple Leafs': 'TOR',
    'Utah Mammoth': 'UTA',
    'Utah Hockey Club': 'UTA',
    'Vancouver Canucks': 'VAN',
    'Vegas Golden Knights': 'VGK',
    'Washington Capitals': 'WSH',
    'Winnipeg Jets': 'WPG',
};

function teamAbbreviation(fullName: string | null | undefined): string {
    if (!fullName) return '';
    return NHL_TEAM_ABBREVIATIONS[fullName.trim()] ?? fullName;
}

const NHL_TEAM_FULL_NAMES: Record<string, string> = (() => {
    const result: Record<string, string> = {};

    for (const [fullName, abbreviation] of Object.entries(
        NHL_TEAM_ABBREVIATIONS,
    )) {
        if (!result[abbreviation]) {
            result[abbreviation] = fullName;
        }
    }

    return result;
})();

function teamFullName(abbreviation: string | null | undefined): string {
    if (!abbreviation) return '';
    return NHL_TEAM_FULL_NAMES[abbreviation.trim()] ?? abbreviation;
}

/**
 * VOR (Value Over Replacement) reference thresholds.
 *
 * The default values apply to every season. A handful of shortened
 * NHL seasons (lockouts, COVID) get their own values, because a
 * replacement-level player produces fewer points when the season is
 * shorter, so the "above replacement" threshold has to be lower too.
 *
 * To add a season: drop a new entry in SEASON_VOR_OVERRIDES. Any
 * season not listed falls back to the default block below.
 */
const DEFAULT_VOR: Record<'F' | 'D' | 'G', number> = {
    F: 45,
    D: 25,
    G: 65,
};

const SEASON_VOR_OVERRIDES: Record<number, Record<'F' | 'D' | 'G', number>> = {
    20122013: { F: 22, D: 13, G: 38 },
    20192020: { F: 36, D: 22, G: 55 },
    20202021: { F: 28, D: 17, G: 44 },
};

function vorThreshold(
    group: 'F' | 'D' | 'G' | '',
    season?: number,
): number {
    if (group !== 'F' && group !== 'D' && group !== 'G') {
        return 0;
    }

    const seasonOverride =
        season != null ? SEASON_VOR_OVERRIDES[season] : undefined;

    if (seasonOverride) {
        return seasonOverride[group];
    }

    return DEFAULT_VOR[group];
}

function formatDecimal(value: number, digits = 2): string {
    return value.toFixed(digits);
}

function parseAtoiToSeconds(value: string | null | undefined): number | null {
    if (!value) return null;

    const parts = value.trim().split(':');

    if (parts.length === 2) {
        const minutes = Number(parts[0]);
        const seconds = Number(parts[1]);

        if (!Number.isFinite(minutes) || !Number.isFinite(seconds)) {
            return null;
        }

        return minutes * 60 + seconds;
    }

    if (parts.length === 3) {
        const hours = Number(parts[0]);
        const minutes = Number(parts[1]);
        const seconds = Number(parts[2]);

        if (
            !Number.isFinite(hours) ||
            !Number.isFinite(minutes) ||
            !Number.isFinite(seconds)
        ) {
            return null;
        }

        return hours * 3600 + minutes * 60 + seconds;
    }

    return null;
}

function formatAtoiFromSeconds(seconds: number | null): string | null {
    if (seconds == null) return null;

    const total = Math.round(seconds);
    const minutes = Math.floor(total / 60);
    const secs = total % 60;

    return `${minutes}:${String(secs).padStart(2, '0')}`;
}

function careerRowsForDisplay(
    rows: CareerRow[],
    showAll: boolean,
    injectCurrentSeason: boolean,
): CareerRow[] {
    const currentExists = rows.some((r) => r.season === CURRENT_SEASON_CODE);

    const withCurrent =
        currentExists || !injectCurrentSeason
            ? rows
            : [
                {
                    season: CURRENT_SEASON_CODE,
                    seasonLabel: '26-27',
                    leagueAbbreviation: 'NHL',
                    teamName: null,
                    gameTypeId: 2,
                    gamesPlayed: 0,
                    goals: 0,
                    assists: 0,
                    points: 0,
                    penaltyMinutes: 0,
                    plusMinus: 0,
                    powerPlayGoals: 0,
                    powerPlayPoints: 0,
                    shorthandedGoals: 0,
                    shorthandedPoints: 0,
                    gameWinningGoals: 0,
                    overtimeGoals: 0,
                    shots: 0,
                    shootingPercentage: 0,
                    averageTimeOnIce: null,
                    faceoffWinningPercentage: null,
                    wins: 0,
                    losses: 0,
                    overtimeLosses: 0,
                    shutouts: 0,
                    saves: 0,
                    shotsAgainst: 0,
                    savePercentage: 0,
                    goalsAgainst: 0,
                    goalsAgainstAverage: 0,
                    hatTricks: null,
                } as CareerRow,
                ...rows,
            ];

    if (showAll) {
        return withCurrent;
    }

    const currentStartYear = Math.floor(CURRENT_SEASON_CODE / 10000);
    const cutoffStartYear = currentStartYear - 3;
    const cutoff = cutoffStartYear * 10000 + (cutoffStartYear + 1);

    return withCurrent.filter((r) => r.season >= cutoff);
}

function withCurrentTeamName(
    rows: CareerRow[],
    currentTeamAbbreviation: string | null | undefined,
): CareerRow[] {
    if (!currentTeamAbbreviation) return rows;

    const fullName = teamFullName(currentTeamAbbreviation);

    return rows.map((row) =>
        row.season === CURRENT_SEASON_CODE &&
            (row.teamName == null || row.teamName === '')
            ? { ...row, teamName: fullName }
            : row,
    );
}

function combineNhlSeasonRows(rows: CareerRow[]): CareerRow[] {
    const result: CareerRow[] = [];

    const nhlFullNames: Map<number, string[]> = new Map();
    const nhlAbbrevs: Map<number, string[]> = new Map();

    const totalToiSeconds: Map<number, number> = new Map();
    const totalToiGp: Map<number, number> = new Map();

    const indexByKey = new Map<string, number>();

    for (let i = 0; i < rows.length; i++) {
        const row = rows[i];
        const isNhl = row.leagueAbbreviation.toUpperCase() === 'NHL';

        if (!isNhl) {
            indexByKey.set(`raw-${i}`, result.length);
            result.push(row);
            continue;
        }

        const key = `nhl-${row.season}-${row.gameTypeId}`;
        const existingIndex = indexByKey.get(key);

        const rowToiSeconds = parseAtoiToSeconds(row.averageTimeOnIce);

        if (existingIndex == null) {
            indexByKey.set(key, result.length);

            const newIndex = result.length;
            result.push(row);

            nhlFullNames.set(
                newIndex,
                row.teamName ? [row.teamName] : [],
            );
            nhlAbbrevs.set(
                newIndex,
                row.teamName ? [teamAbbreviation(row.teamName)] : [],
            );

            if (rowToiSeconds != null) {
                totalToiSeconds.set(
                    newIndex,
                    row.gamesPlayed * rowToiSeconds,
                );
                totalToiGp.set(newIndex, row.gamesPlayed);
            }

            continue;
        }

        const existing = result[existingIndex];

        if (row.teamName) {
            nhlFullNames.get(existingIndex)?.push(row.teamName);
            nhlAbbrevs.get(existingIndex)?.push(teamAbbreviation(row.teamName));
        }

        if (rowToiSeconds != null) {
            totalToiSeconds.set(
                existingIndex,
                (totalToiSeconds.get(existingIndex) ?? 0) +
                row.gamesPlayed * rowToiSeconds,
            );
            totalToiGp.set(
                existingIndex,
                (totalToiGp.get(existingIndex) ?? 0) + row.gamesPlayed,
            );
        }

        result[existingIndex] = {
            ...existing,
            gamesPlayed: existing.gamesPlayed + row.gamesPlayed,
            goals: existing.goals + row.goals,
            assists: existing.assists + row.assists,
            points: existing.points + row.points,
            penaltyMinutes: existing.penaltyMinutes + row.penaltyMinutes,
            plusMinus: existing.plusMinus + row.plusMinus,
            powerPlayGoals: existing.powerPlayGoals + row.powerPlayGoals,
            powerPlayPoints: existing.powerPlayPoints + row.powerPlayPoints,
            shorthandedGoals:
                existing.shorthandedGoals + row.shorthandedGoals,
            shorthandedPoints:
                existing.shorthandedPoints + row.shorthandedPoints,
            gameWinningGoals:
                existing.gameWinningGoals + row.gameWinningGoals,
            overtimeGoals: existing.overtimeGoals + row.overtimeGoals,
            shots: existing.shots + row.shots,
            wins: existing.wins + row.wins,
            losses: existing.losses + row.losses,
            overtimeLosses:
                existing.overtimeLosses + row.overtimeLosses,
            shutouts: existing.shutouts + row.shutouts,
            saves: existing.saves + row.saves,
            shotsAgainst: existing.shotsAgainst + row.shotsAgainst,
            goalsAgainst: existing.goalsAgainst + row.goalsAgainst,
            hatTricks:
                existing.hatTricks == null && row.hatTricks == null
                    ? null
                    : (existing.hatTricks ?? 0) + (row.hatTricks ?? 0),
        };
    }

    nhlAbbrevs.forEach((abbrevs, index) => {
        const uniqueAbbrevs = abbrevs.filter(
            (v, i, arr) => arr.indexOf(v) === i,
        );

        const gpForToi = totalToiGp.get(index) ?? 0;
        const secondsForToi = totalToiSeconds.get(index) ?? 0;

        const mergedAtoi =
            gpForToi > 0
                ? formatAtoiFromSeconds(secondsForToi / gpForToi)
                : result[index].averageTimeOnIce ?? null;

        result[index] = {
            ...result[index],
            teamName:
                uniqueAbbrevs.length >= 2
                    ? uniqueAbbrevs.join(', ')
                    : result[index].teamName,
            averageTimeOnIce: mergedAtoi,
        };
    });

    return result;
}

function sumHatTricks(rows: CareerRow[]): number | null {
    if (rows.length === 0) return null;
    const anyKnown = rows.some((r) => r.hatTricks != null);
    if (!anyKnown) return null;
    return rows.reduce((sum, r) => sum + (r.hatTricks ?? 0), 0);
}

/**
 * Soft jade glow applied to the draft-boundary row in the career
 * tables. Offset downward only so the glow does not visually bleed
 * onto the row above. Not driven by the aura system because it is a
 * one-off decoration, not a user-tunable channel.
 */
const DRAFT_LINE_GLOW =
    '0 2px 3px -1px rgba(0, 168, 107, 0.5), 0 3px 6px -2px rgba(0, 168, 107, 0.28)';

// ---------------------------------------------------------------------
// Table primitives
// ---------------------------------------------------------------------

const thBase = 'px-1 py-1 font-medium whitespace-nowrap min-w-[1.75rem]';
const thLeft = `${thBase} text-center`;
const thRight = `${thBase} text-center`;
const tdBase = 'px-1 py-0.5 whitespace-nowrap min-w-[1.75rem]';
const tdLeft = `${tdBase} text-center`;
const tdRight = `${tdBase} text-center`;

const thSeason = 'pl-1 pr-0 py-1 font-medium whitespace-nowrap text-center';
const tdSeason = 'pl-1 pr-0 py-0.5 whitespace-nowrap text-center';

const thTeam = 'pl-0 pr-0 py-1 font-medium whitespace-nowrap text-center';
const tdTeam = 'pl-0 pr-0 py-0.5 whitespace-nowrap text-center';

const thLge = 'pl-0 pr-1 py-1 font-medium whitespace-nowrap text-center';
const tdLge = 'pl-0 pr-1 py-0.5 whitespace-nowrap text-center';

function TableShell({ children }: { children: React.ReactNode }) {
    return (
        <div className='w-full overflow-x-auto rounded-lg border border-border bg-card pb-1'>
            {children}
        </div>
    );
}

function TableHead({ children }: { children: React.ReactNode }) {
    return (
        <thead className='border-b border-border text-[0.65rem] uppercase tracking-wide text-foreground'>
            {children}
        </thead>
    );
}

function rowClass(index: number): string {
    return cn(
        'border-b border-border/40 last:border-b-0',
        index % 2 === 0 ? 'bg-transparent' : 'bg-secondary/20',
    );
}

const CYAN_TINT_LEAGUES = new Set([
    'AHL',
    'KHL',
    'LIIGA',
    'SHL',
]);

function careerRowClass(row: CareerRow, index: number): string {
    if (isNhlRow(row)) {
        return rowClass(index);
    }

    const league = row.leagueAbbreviation.toUpperCase();

    if (CYAN_TINT_LEAGUES.has(league)) {
        return 'border-b border-border/40 last:border-b-0 bg-[#7DF9FF]/15';
    }

    return 'border-b border-border/40 last:border-b-0 bg-[#D8BFD8]/15';
}

// ---------------------------------------------------------------------
// Small components
// ---------------------------------------------------------------------

function SectionTitle({
    children,
    neon,
    auraColor,
}: {
    children: React.ReactNode;
    neon: boolean;
    auraColor: string;
}) {
    return (
        <h2 className='mt-4 mb-5 text-center'>
            {neon ? (
                <NeonTitle
                    variant='section'
                    showStroke={false}
                    auraColor={auraColor}
                >
                    {children}
                </NeonTitle>
            ) : (
                /* Classic style: plain bold sans-serif, white, no
                   aura. Matches the player name's Classic treatment. */
                <span className='text-xl font-bold text-foreground'>
                    {children}
                </span>
            )}
        </h2>
    );
}

function SubSectionTitle({
    children,
    neon,
    auraColor,
}: {
    children: React.ReactNode;
    neon: boolean;
    auraColor: string;
}) {
    return (
        <h3 className='mt-2 mb-4 text-center'>
            {neon ? (
                <NeonTitle
                    variant='subsection'
                    showStroke={false}
                    auraColor={auraColor}
                >
                    {children}
                </NeonTitle>
            ) : (
                /* Classic style: same font/color as the player name,
                   one size down from the section titles. */
                <span className='text-base font-bold text-foreground'>
                    {children}
                </span>
            )}
        </h3>
    );
}

/**
 * Compact current-season stat strip shown at the top of the player
 * page (where the tab buttons used to be). Each cell is: colored
 * icon, uppercase label, big value, and a colored underline.
 *
 * Skater order:   GP, G, A, PTS, Hat tricks, FP
 * Goalie order:   GP, W, L, OTL, SO, FP
 */
function CurrentSeasonStrip({
    stats,
    isGoalie,
    auraColor,
}: {
    stats: {
        gamesPlayed: number;
        goals: number;
        assists: number;
        points: number;
        hatTricks: number;
        fantasyPoints: number;
        wins?: number;
        losses?: number;
        overtimeLosses?: number;
        shutouts?: number;
    } | null;
    isGoalie: boolean;
    /**
     * Team aura color. When provided, the strip border and glow use
     * this color. When undefined, the strip falls back to the cyan
     * "Classic" palette.
     */
    auraColor?: string;
}) {
    const s = {
        gamesPlayed: stats?.gamesPlayed ?? 0,
        goals: stats?.goals ?? 0,
        assists: stats?.assists ?? 0,
        points: stats?.points ?? 0,
        hatTricks: stats?.hatTricks ?? 0,
        fantasyPoints: stats?.fantasyPoints ?? 0,
        wins: stats?.wins ?? 0,
        losses: stats?.losses ?? 0,
        overtimeLosses: stats?.overtimeLosses ?? 0,
        shutouts: stats?.shutouts ?? 0,
    };

    const aura = useAura('playerSeasonStrip');

    const sizeAt = (layer: number) =>
        auraRangeFor(aura, 'playerSeasonStrip', layer);

    // Aura chain. Team-color version (Neon style) uses the four
    // layers of a single color at decreasing alpha. Cyan version
    // (Classic style) uses the original chain that shipped with the
    // page.
    const auraRest = auraColor
        ? [
            `0 0 2px ${auraColor}`,
            `0 0 ${(sizeAt(0) * AURA_STRIP_PULSE_REST_SCALE).toFixed(2)}px ${auraColor}`,
            `0 0 ${(sizeAt(1) * AURA_STRIP_PULSE_REST_SCALE).toFixed(2)}px ${auraColor}E6`,
            `0 0 ${(sizeAt(2) * AURA_STRIP_PULSE_REST_SCALE).toFixed(2)}px ${auraColor}99`,
            `0 0 ${(sizeAt(3) * AURA_STRIP_PULSE_REST_SCALE).toFixed(2)}px ${auraColor}4D`,
        ].join(', ')
        : [
            `0 0 2px rgba(180, 230, 255, 0.9)`,
            `0 0 ${(sizeAt(0) * AURA_STRIP_PULSE_REST_SCALE).toFixed(2)}px rgba(0, 168, 255, 1)`,
            `0 0 ${(sizeAt(1) * AURA_STRIP_PULSE_REST_SCALE).toFixed(2)}px rgba(0, 168, 255, 0.9)`,
            `0 0 ${(sizeAt(2) * AURA_STRIP_PULSE_REST_SCALE).toFixed(2)}px rgba(0, 168, 255, 0.6)`,
            `0 0 ${(sizeAt(3) * AURA_STRIP_PULSE_REST_SCALE).toFixed(2)}px rgba(0, 168, 255, 0.3)`,
        ].join(', ');

    const auraPeak = auraColor
        ? [
            `0 0 3px ${auraColor}`,
            `0 0 ${(sizeAt(0) * AURA_STRIP_PULSE_PEAK_SCALE).toFixed(2)}px ${auraColor}`,
            `0 0 ${(sizeAt(1) * AURA_STRIP_PULSE_PEAK_SCALE).toFixed(2)}px ${auraColor}`,
            `0 0 ${(sizeAt(2) * AURA_STRIP_PULSE_PEAK_SCALE).toFixed(2)}px ${auraColor}D9`,
            `0 0 ${(sizeAt(3) * AURA_STRIP_PULSE_PEAK_SCALE).toFixed(2)}px ${auraColor}8C`,
        ].join(', ')
        : [
            `0 0 3px rgba(200, 240, 255, 1)`,
            `0 0 ${(sizeAt(0) * AURA_STRIP_PULSE_PEAK_SCALE).toFixed(2)}px rgba(0, 168, 255, 1)`,
            `0 0 ${(sizeAt(1) * AURA_STRIP_PULSE_PEAK_SCALE).toFixed(2)}px rgba(0, 168, 255, 1)`,
            `0 0 ${(sizeAt(2) * AURA_STRIP_PULSE_PEAK_SCALE).toFixed(2)}px rgba(0, 168, 255, 0.85)`,
            `0 0 ${(sizeAt(3) * AURA_STRIP_PULSE_PEAK_SCALE).toFixed(2)}px rgba(0, 168, 255, 0.55)`,
        ].join(', ');

    const auraOn = !isAuraOff(aura);

    const cells = isGoalie
        ? [
            {
                key: 'gp',
                label: 'GP',
                value: s.gamesPlayed,
                color: '#7DD3FC',
                icon: 'skate',
            },
            {
                key: 'w',
                label: 'W',
                value: s.wins,
                color: '#00F0FF',
                icon: 'trophy',
            },
            {
                key: 'l',
                label: 'L',
                value: s.losses,
                color: '#A855F7',
                icon: 'x-circle',
            },
            {
                key: 'otl',
                label: 'OTL',
                value: s.overtimeLosses,
                color: '#22C55E',
                icon: 'clock',
            },
            {
                key: 'so',
                label: 'SO',
                value: s.shutouts,
                color: '#EC4899',
                icon: 'shield-check',
            },
            {
                key: 'fp',
                label: 'FP',
                value: s.fantasyPoints,
                color: '#F59E0B',
                icon: 'star',
            },
        ]
        : [
            {
                key: 'gp',
                label: 'GP',
                value: s.gamesPlayed,
                color: '#7DD3FC',
                icon: 'skate',
            },
            {
                key: 'g',
                label: 'G',
                value: s.goals,
                color: '#22C55E',
                icon: 'net',
            },
            {
                key: 'a',
                label: 'A',
                value: s.assists,
                color: '#A855F7',
                icon: 'stick',
            },
            {
                key: 'pts',
                label: 'PTS',
                value: s.points,
                color: '#00F0FF',
                icon: 'puck',
            },
            {
                key: 'ht',
                label: '3B',
                value: s.hatTricks,
                color: '#EC4899',
                icon: 'tophat',
            },
            {
                key: 'fp',
                label: 'FP',
                value: s.fantasyPoints,
                color: '#F59E0B',
                icon: 'star',
            },
        ];

    return (
        <div
            className={cn(
                'w-full rounded-lg border bg-[#080D1A] p-1.5',
                auraOn ? auraPulseClass('box') : '',
            )}
            style={{
                borderColor: auraColor
                    ? `${auraColor}66`
                    : 'rgba(0, 168, 255, 0.4)',
                ...(auraOn ? auraPulseStyle(auraRest, auraPeak) : {}),
            }}
        >
            <div className='flex w-full gap-1.5'>
                {cells.map((cell) => (
                    <div
                        key={cell.key}
                        className='relative flex flex-1 flex-col items-center justify-center gap-0.5 rounded-md'
                    >
                        <StatIcon name={cell.icon} color={cell.color} />

                        <span
                            className='whitespace-nowrap text-[0.6rem] font-bold uppercase tracking-wide'
                            style={{ color: cell.color }}
                        >
                            {cell.label}
                        </span>

                        <span className='text-xl font-bold text-white tabular-nums'>
                            {cell.value}
                        </span>
                    </div>
                ))}
            </div>
        </div>
    );
}

/**
 * Tiny inline SVGs for the stat strip. Kept inline so no external
 * icon set is needed for the four shapes we don't already have from
 * lucide.
 */
function StatIcon({
    name,
    color,
}: {
    name: string;
    color: string;
}) {
    const stroke = color;
    const fill = 'none';
    const common = {
        xmlns: 'http://www.w3.org/2000/svg',
        width: 20,
        height: 20,
        viewBox: '0 0 24 24',
        fill,
        stroke,
        strokeWidth: 1.8,
        strokeLinecap: 'round' as const,
        strokeLinejoin: 'round' as const,
    };

    switch (name) {
        case 'skate':
            return (
                <svg {...common}>
                    <path d='M3 16h11l3 2h4v3H3z' />
                    <path d='M3 16v-4h5l3 4' />
                    <path d='M8 12V6h4l2 6' />
                </svg>
            );

        case 'net':
            return (
                <svg {...common}>
                    <path d='M3 6h18v14H3z' />
                    <path d='M3 10h18M3 14h18M7 6v14M11 6v14M15 6v14M19 6v14' />
                </svg>
            );

        case 'stick':
            return (
                <svg {...common}>
                    <path d='M4 4l14 14' />
                    <path d='M18 18l3 3' />
                    <path d='M15 18l4 4' />
                </svg>
            );

        case 'star':
            return (
                <svg {...common}>
                    <path d='M12 3l2.7 6.2 6.8.6-5.1 4.5 1.5 6.7L12 17.8 6.1 21l1.5-6.7L2.5 9.8l6.8-.6z' />
                </svg>
            );

        case 'puck':
            return (
                <svg {...common}>
                    <ellipse cx='12' cy='15' rx='9' ry='3.5' />
                    <path d='M3 15v-2c0-1.9 4-3.5 9-3.5s9 1.6 9 3.5v2' />
                    <ellipse cx='12' cy='13' rx='9' ry='3.5' />
                </svg>
            );

        case 'tophat':
            return (
                <svg {...common}>
                    <path d='M6 4h12l-1 12H7z' />
                    <path d='M4 18h16' />
                    <path d='M5 18c0-1 3-2 7-2s7 1 7 2' />
                </svg>
            );

        case 'trophy':
            return (
                <svg {...common}>
                    <path d='M8 4h8v5a4 4 0 0 1-8 0z' />
                    <path d='M8 5H5v2a3 3 0 0 0 3 3' />
                    <path d='M16 5h3v2a3 3 0 0 1-3 3' />
                    <path d='M12 13v4' />
                    <path d='M9 20h6' />
                    <path d='M10 17h4' />
                </svg>
            );

        case 'x-circle':
            return (
                <svg {...common}>
                    <circle cx='12' cy='12' r='9' />
                    <path d='M8.5 8.5l7 7M15.5 8.5l-7 7' />
                </svg>
            );

        case 'clock':
            return (
                <svg {...common}>
                    <circle cx='12' cy='12' r='9' />
                    <path d='M12 7v5l3.5 2' />
                </svg>
            );

        case 'shield-check':
            return (
                <svg {...common}>
                    <path d='M12 3l8 3v6c0 4.5-3.4 8.2-8 9-4.6-.8-8-4.5-8-9V6z' />
                    <path d='M9 12.5l2 2 4-4' />
                </svg>
            );

        default:
            return null;
    }
}

function InjuryBadge({
    isInjured,
    injuryKind,
    shortDescription,
    size = 16,
    onClick,
}: {
    isInjured: boolean;
    injuryKind: string;
    shortDescription: string | null;
    size?: number;
    onClick?: () => void;
}) {
    if (!isInjured) return null;

    const isSuspension = injuryKind === 'Suspension';
    const crossColor = isSuspension ? '#fbbf24' : '#ef4444';
    const glowColor = isSuspension
        ? 'drop-shadow(0 0 3px rgba(251, 191, 36, 0.9))'
        : 'drop-shadow(0 0 3px rgba(239, 68, 68, 0.9))';
    const label = isSuspension ? 'Suspension' : 'Blessé';

    const icon = (
        <svg
            viewBox='0 0 24 24'
            width={size}
            height={size}
            xmlns='http://www.w3.org/2000/svg'
        >
            <rect x='9' y='3' width='6' height='18' fill={crossColor} />
            <rect x='3' y='9' width='18' height='6' fill={crossColor} />
        </svg>
    );

    // When the caller wires onClick, render as a button so the
    // injury details can be opened directly from the icon. Otherwise
    // fall back to a plain non-interactive span.
    if (onClick) {
        return (
            <button
                type='button'
                onClick={onClick}
                title={shortDescription ?? label}
                aria-label={label}
                className='inline-flex shrink-0 cursor-pointer items-center justify-center transition-transform hover:scale-110 focus:outline-none focus-visible:ring-2 focus-visible:ring-ring/50'
                style={{ width: size, height: size, filter: glowColor }}
            >
                {icon}
            </button>
        );
    }

    return (
        <span
            title={shortDescription ?? label}
            aria-label={label}
            className='inline-flex shrink-0 items-center justify-center'
            style={{ width: size, height: size, filter: glowColor }}
        >
            {icon}
        </span>
    );
}

/**
 * Small badge showing the player's current location within his NHL
 * club: on the NHL roster, sent to the AHL, injured, or not on either
 * active roster. Renders nothing when RosterLocation is null (the
 * feature has never run for this player).
 */
function RosterLocationBadge({
    location,
    onInjuredClick,
}: {
    location: string | null;
    onInjuredClick?: () => void;
}) {
    if (!location) return null;

    const config: Record<
        string,
        { label: string; className: string }
    > = {
        NhlRoster: {
            label: 'LNH',
            className:
                'border-emerald-500/40 bg-emerald-500/15 text-emerald-300',
        },
        AhlRoster: {
            label: 'AHL',
            className:
                'border-sky-500/40 bg-sky-500/15 text-sky-300',
        },
        Injured: {
            label: 'Blessé',
            className:
                'border-red-500/40 bg-red-500/15 text-red-300',
        },
        NotOnActiveRoster: {
            label: 'Hors de la LNH',
            className:
                'border-zinc-500/40 bg-zinc-500/15 text-zinc-300',
        },
    };

    const entry = config[location];
    if (!entry) return null;

    const badgeClass =
        'ml-2 inline-flex items-center rounded border px-1.5 py-0.5 text-[0.6rem] font-semibold uppercase tracking-wide';

    // Injured is the only location that opens the injury modal.
    // When the caller does not wire onInjuredClick, fall back to a
    // plain non-interactive span so this component is safe to reuse.
    if (location === 'Injured' && onInjuredClick) {
        return (
            <button
                type='button'
                onClick={onInjuredClick}
                aria-label='Voir les détails de la blessure'
                className={`${badgeClass} ${entry.className} cursor-pointer transition-colors hover:brightness-125 focus:outline-none focus-visible:ring-2 focus-visible:ring-ring/50`}
            >
                {entry.label}
            </button>
        );
    }

    return (
        <span className={`${badgeClass} ${entry.className}`}>
            {entry.label}
        </span>
    );
}

interface TotalsRowProps {
    regularSeason: boolean;
    showFantasyPoints?: boolean;
    showVor?: boolean;
    careerRows: CareerRow[];
    nhlTotals: PlayerDetail['nhlTotals'];
    isGoalie: boolean;
}

function TotalsRow({
    regularSeason,
    showFantasyPoints = false,
    showVor = false,
    careerRows,
    nhlTotals,
    isGoalie,
}: TotalsRowProps) {
    const rowClassName =
        'border-t border-[#7DF9FF]/30 bg-[#7DF9FF]/30 font-semibold';

    if (isGoalie) {
        if (regularSeason) {
            return (
                <tr className={rowClassName}>
                    <td className={tdLeft}>Totals</td>
                    <td className={tdLeft}>—</td>
                    <td className={tdLeft}>NHL</td>
                    <td className={cn(tdRight, 'text-[#7DD3FC]')}>
                        {nhlTotals.gamesPlayed}
                    </td>
                    <td className={cn(tdRight, 'text-[#00F0FF]')}>
                        {nhlTotals.wins}
                    </td>
                    <td className={tdRight}>{nhlTotals.losses}</td>
                    <td className={tdRight}>{nhlTotals.overtimeLosses}</td>
                    <td className={tdRight}>{nhlTotals.shutouts}</td>
                    <td className={tdRight}>—</td>
                    <td className={tdRight}>
                        {nhlTotals.shotsAgainst > 0
                            ? formatDecimal(nhlTotals.savePercentage, 3)
                            : '—'}
                    </td>
                    <td className={tdRight}>
                        {nhlTotals.gamesPlayed > 0
                            ? formatDecimal(
                                nhlTotals.goalsAgainst / nhlTotals.gamesPlayed,
                                2,
                            )
                            : '—'}
                    </td>
                    <td className={tdRight}>{nhlTotals.saves}</td>
                    <td className={tdRight}>{nhlTotals.shotsAgainst}</td>
                </tr>
            );
        }

        return (
            <tr className={rowClassName}>
                <td className={tdLeft}>Totals</td>
                <td className={tdLeft}>—</td>
                <td className={tdLeft}>NHL</td>
                <td className={cn(tdRight, 'text-[#7DD3FC]')}>
                    {nhlTotals.playoffGamesPlayed}
                </td>
                <td className={cn(tdRight, 'text-[#00F0FF]')}>
                    {nhlTotals.playoffWins}
                </td>
                <td className={tdRight}>{nhlTotals.playoffLosses}</td>
                <td className={tdRight}>{nhlTotals.playoffOvertimeLosses}</td>
                <td className={tdRight}>{nhlTotals.playoffShutouts}</td>
                <td className={tdRight}>—</td>
                <td className={tdRight}>—</td>
                <td className={tdRight}>—</td>
                <td className={tdRight}>—</td>
                <td className={tdRight}>—</td>
            </tr>
        );
    }

    if (regularSeason) {
        const hatTricks = sumHatTricks(careerRows);

        return (
            <tr className={rowClassName}>
                <td className={tdLeft}>Totals</td>
                <td className={tdLeft}>—</td>
                <td className={tdLeft}>NHL</td>
                <td className={cn(tdRight, 'text-[#7DD3FC]')}>
                    {nhlTotals.gamesPlayed}
                </td>
                <td className={tdRight}>{nhlTotals.goals}</td>
                <td className={tdRight}>{nhlTotals.assists}</td>
                <td className={cn(tdRight, 'text-[#00F0FF]')}>
                    {nhlTotals.points}
                </td>
                {showFantasyPoints && (
                    <td className={tdRight}>—</td>
                )}
                {showVor && (
                    <td className={tdRight}>—</td>
                )}
                <td className={tdRight}>
                    {hatTricks == null ? '—' : hatTricks}
                </td>
                <td className={tdRight}>{nhlTotals.penaltyMinutes}</td>
                <td className={tdRight}>
                    {nhlTotals.plusMinus > 0
                        ? `+${nhlTotals.plusMinus}`
                        : nhlTotals.plusMinus}
                </td>
                <td className={tdRight}>{nhlTotals.powerPlayPoints}</td>
                <td className={tdRight}>{nhlTotals.shots}</td>
                <td className={tdRight}>{nhlTotals.gameWinningGoals}</td>
                <td className={tdRight}>—</td>
            </tr>
        );
    }

    const playoffHatTricks = sumHatTricks(careerRows);

    return (
        <tr className={rowClassName}>
            <td className={tdLeft}>Totals</td>
            <td className={tdLeft}>—</td>
            <td className={tdLeft}>NHL</td>
            <td className={cn(tdRight, 'text-[#7DD3FC]')}>
                {nhlTotals.playoffGamesPlayed}
            </td>
            <td className={tdRight}>{nhlTotals.playoffGoals}</td>
            <td className={tdRight}>{nhlTotals.playoffAssists}</td>
            <td className={cn(tdRight, 'text-[#00F0FF]')}>
                {nhlTotals.playoffPoints}
            </td>
            <td className={tdRight}>
                {playoffHatTricks == null ? '—' : playoffHatTricks}
            </td>
            <td className={tdRight}>
                {nhlTotals.playoffPenaltyMinutes}
            </td>
            <td className={tdRight}>—</td>
            <td className={tdRight}>
                {nhlTotals.playoffPowerPlayPoints}
            </td>
            <td className={tdRight}>{nhlTotals.playoffShots}</td>
            <td className={tdRight}>
                {nhlTotals.playoffGameWinningGoals}
            </td>
            <td className={tdRight}>—</td>
        </tr>
    );
}

function SkaterCareerTable({
    rows,
    showFantasyPoints = false,
    showVor = false,
    positionGroup: positionGrp = '',
    totalsRow = null,
    plainRows = false,
    variant = 'default',
    draftBoundarySeason = null,
}: {
    rows: CareerRow[];
    showFantasyPoints?: boolean;
    showVor?: boolean;
    positionGroup?: 'F' | 'D' | 'G' | '';
    totalsRow?: React.ReactNode;
    plainRows?: boolean;
    variant?: 'default' | 'youthMinor';
    draftBoundarySeason?: number | null;
}) {
    if (rows.length === 0) {
        return (
            <TableShell>
                <div className='p-3 text-sm text-muted-foreground'>
                    Aucune donnée.
                </div>
            </TableShell>
        );
    }

    const isYouthMinor = variant === 'youthMinor';

    return (
        <TableShell>
            <table className='w-full min-w-[620px] text-[0.65rem] tabular-nums'>
                <TableHead>
                    <tr>
                        <th className={cn(thSeason, 'text-[0.5rem]')}>Season</th>
                        <th className={thTeam}>Team</th>
                        <th className={thLge}>Lge</th>
                        <th className={cn(thRight, 'text-[#7DD3FC]')}>GP</th>
                        <th className={thRight}>G</th>
                        <th className={thRight}>A</th>
                        <th className={cn(thRight, 'font-bold text-[#00F0FF]')}>Pts</th>
                        {!isYouthMinor && showFantasyPoints && (
                            <th className={cn(thRight, 'font-bold text-[#F59E0B]')}>FP</th>
                        )}
                        {!isYouthMinor && showVor && (
                            <th className={cn(thRight, 'font-bold text-foreground')}>VOR</th>
                        )}
                        {!isYouthMinor && (
                            <th className={thRight}>3B</th>
                        )}
                        <th className={thRight}>PIM</th>
                        <th className={thRight}>+/-</th>
                        <th className={thRight}>ATOI</th>
                        {!isYouthMinor && (
                            <>
                                <th className={thRight}>PPP</th>
                                <th className={thRight}>SOG</th>
                                <th className={thRight}>GWG</th>
                            </>
                        )}
                    </tr>
                </TableHead>
                <tbody className='text-foreground'>
                    {rows.map((row, index) => {
                        // Draw the draft line on the border BETWEEN two
                        // rows, not as a separate <tr>:
                        //   - if this row's season is >= the draft
                        //     boundary season, no line
                        //   - if the NEXT row's season is < the draft
                        //     boundary season, draw the line on THIS
                        //     row's bottom border
                        //
                        // Because rows are sorted descending by season,
                        // the line ends up exactly between the last
                        // post-draft season and the first pre-draft
                        // season.
                        const nextRow = rows[index + 1];
                        const hasNextRow = nextRow !== undefined;

                        const isLastPostDraftRow =
                            draftBoundarySeason != null &&
                            hasNextRow &&
                            row.season >= draftBoundarySeason &&
                            nextRow.season < draftBoundarySeason;

                        return (
                            <tr
                                key={`${row.season}-${row.leagueAbbreviation}-${row.teamName}-${index}`}
                                className={cn(
                                    plainRows
                                        ? rowClass(index)
                                        : careerRowClass(row, index),
                                    isLastPostDraftRow &&
                                    'border-b border-[#00A86B]/50',
                                )}
                                style={
                                    isLastPostDraftRow
                                        ? { boxShadow: DRAFT_LINE_GLOW }
                                        : undefined
                                }
                            >
                                <td className={tdSeason}>{row.seasonLabel}</td>
                                <td className={tdTeam}>{teamDisplay(row)}</td>
                                <td className={tdLge}>{row.leagueAbbreviation}</td>
                                <td
                                    className={cn(
                                        tdRight,
                                        isNhlRow(row)
                                            ? 'text-[#7DD3FC]'
                                            : 'text-foreground',
                                    )}
                                >
                                    {row.gamesPlayed}
                                </td>
                                <td className={tdRight}>{row.goals}</td>
                                <td className={tdRight}>{row.assists}</td>
                                <td
                                    className={cn(
                                        tdRight,
                                        isNhlRow(row)
                                            ? 'text-[#00F0FF]'
                                            : 'text-foreground',
                                    )}
                                >
                                    {row.points}
                                </td>
                                {!isYouthMinor && showFantasyPoints && (
                                    <td
                                        className={cn(
                                            tdRight,
                                            isNhlRow(row)
                                                ? 'text-[#F59E0B]'
                                                : 'text-foreground',
                                        )}
                                    >
                                        {row.hatTricks == null
                                            ? '—'
                                            : row.points + row.hatTricks * 3}
                                    </td>
                                )}
                                {!isYouthMinor && showVor && (() => {
                                    if (row.hatTricks == null) {
                                        return <td className={tdRight}>—</td>;
                                    }

                                    const fp = row.points + row.hatTricks * 3;

                                    // Per-season VOR threshold so shortened
                                    // seasons (lockouts, COVID) use their own
                                    // replacement-level values.
                                    const seasonVor = vorThreshold(
                                        positionGrp,
                                        row.season,
                                    );

                                    const vorValue = fp - seasonVor;

                                    return (
                                        <td
                                            className={cn(
                                                tdRight,
                                                vorValue > 0
                                                    ? 'text-emerald-400'
                                                    : vorValue < 0
                                                        ? 'text-rose-400'
                                                        : 'text-[#D4AF37]',
                                            )}
                                        >
                                            {vorValue > 0 ? '+' : ''}
                                            {vorValue}
                                        </td>
                                    );
                                })()}
                                {!isYouthMinor && (
                                    <td className={tdRight}>
                                        {row.hatTricks == null ? '—' : row.hatTricks}
                                    </td>
                                )}
                                <td className={tdRight}>{row.penaltyMinutes}</td>
                                <td className={tdRight}>
                                    {row.plusMinus > 0 ? `+${row.plusMinus}` : row.plusMinus}
                                </td>
                                <td className={tdRight}>{row.averageTimeOnIce ?? '—'}</td>
                                {!isYouthMinor && (
                                    <>
                                        <td className={tdRight}>{row.powerPlayPoints}</td>
                                        <td className={tdRight}>{row.shots}</td>
                                        <td className={tdRight}>{row.gameWinningGoals}</td>
                                    </>
                                )}
                            </tr>
                        );
                    })}
                    {totalsRow}
                </tbody>
            </table>
        </TableShell>
    );
}

function GoalieCareerTable({
    rows,
    showFantasyPoints = false,
    totalsRow = null,
    plainRows = false,
    variant = 'default',
    draftBoundarySeason = null,
}: {
    rows: CareerRow[];
    showFantasyPoints?: boolean;
    totalsRow?: React.ReactNode;
    plainRows?: boolean;
    variant?: 'default' | 'youthMinor';
    draftBoundarySeason?: number | null;
}) {
    if (rows.length === 0) {
        return (
            <TableShell>
                <div className='p-3 text-sm text-muted-foreground'>
                    Aucune donnée.
                </div>
            </TableShell>
        );
    }

    const isYouthMinor = variant === 'youthMinor';

    return (
        <TableShell>
            <table className='w-full min-w-[600px] text-[0.7rem] tabular-nums'>
                <TableHead>
                    <tr>
                        <th className={thSeason}>Season</th>
                        <th className={thTeam}>Team</th>
                        <th className={thLge}>Lge</th>
                        <th className={cn(thRight, 'text-[#7DD3FC]')}>GP</th>
                        {!isYouthMinor && (
                            <>
                                <th className={cn(thRight, 'font-bold text-[#00F0FF]')}>W</th>
                                <th className={thRight}>L</th>
                                <th className={thRight}>OTL</th>
                                <th className={thRight}>SO</th>
                                {showFantasyPoints && (
                                    <th className={cn(thRight, 'font-bold text-[#F59E0B]')}>FP</th>
                                )}
                                <th className={thRight}>SV%</th>
                                <th className={thRight}>GAA</th>
                                <th className={thRight}>SV</th>
                                <th className={thRight}>SA</th>
                            </>
                        )}
                    </tr>
                </TableHead>
                <tbody className='text-foreground'>
                    {rows.map((row, index) => {
                        const nextRow = rows[index + 1];
                        const hasNextRow = nextRow !== undefined;

                        const isLastPostDraftRow =
                            draftBoundarySeason != null &&
                            hasNextRow &&
                            row.season >= draftBoundarySeason &&
                            nextRow.season < draftBoundarySeason;

                        return (
                            <tr
                                key={`${row.season}-${row.leagueAbbreviation}-${row.teamName}-${index}`}
                                className={cn(
                                    plainRows
                                        ? rowClass(index)
                                        : careerRowClass(row, index),
                                    isLastPostDraftRow &&
                                    'border-b border-[#00A86B]/50',
                                )}
                                style={
                                    isLastPostDraftRow
                                        ? { boxShadow: DRAFT_LINE_GLOW }
                                        : undefined
                                }
                            >
                                <td className={tdSeason}>{row.seasonLabel}</td>
                                <td className={tdTeam}>{teamDisplay(row)}</td>
                                <td className={tdLge}>{row.leagueAbbreviation}</td>
                                <td
                                    className={cn(
                                        tdRight,
                                        isNhlRow(row)
                                            ? 'text-[#7DD3FC]'
                                            : 'text-foreground',
                                    )}
                                >
                                    {row.gamesPlayed}
                                </td>
                                {!isYouthMinor && (
                                    <>
                                        <td
                                            className={cn(
                                                tdRight,
                                                isNhlRow(row)
                                                    ? 'text-[#00F0FF]'
                                                    : 'text-foreground',
                                            )}
                                        >
                                            {row.wins}
                                        </td>
                                        <td className={tdRight}>{row.losses}</td>
                                        <td className={tdRight}>{row.overtimeLosses}</td>
                                        <td className={tdRight}>{row.shutouts}</td>
                                        {showFantasyPoints && (
                                            <td
                                                className={cn(
                                                    tdRight,
                                                    isNhlRow(row)
                                                        ? 'text-[#F59E0B]'
                                                        : 'text-foreground',
                                                )}
                                            >
                                                {
                                                    // Goalie fantasy points
                                                    // per league rules:
                                                    //   goals + assists
                                                    //   + 2 per win
                                                    //   + 1 per OTL
                                                    //   + 1 per shutout
                                                    row.points +
                                                    row.wins * 2 +
                                                    row.overtimeLosses +
                                                    row.shutouts
                                                }
                                            </td>
                                        )}
                                        <td className={tdRight}>
                                            {formatDecimal(row.savePercentage, 3)}
                                        </td>
                                        <td className={tdRight}>
                                            {formatDecimal(row.goalsAgainstAverage, 2)}
                                        </td>
                                        <td className={tdRight}>{row.saves}</td>
                                        <td className={tdRight}>{row.shotsAgainst}</td>
                                    </>
                                )}
                            </tr>
                        );
                    })}
                    {totalsRow}
                </tbody>
            </table>
        </TableShell>
    );
}

function GameLogTable({
    rows,
    isGoalie,
}: {
    rows: GameLogRow[];
    isGoalie: boolean;
}) {
    if (rows.length === 0) {
        return (
            <TableShell>
                <div className='p-3 text-sm text-muted-foreground'>
                    Aucune partie récente.
                </div>
            </TableShell>
        );
    }

    return (
        <TableShell>
            <table className='w-full min-w-[560px] text-xs tabular-nums'>
                <TableHead>
                    <tr>
                        <th className={thLeft}>Date</th>
                        <th className={thLeft}>Opp</th>
                        <th className={thLeft}>Loc</th>
                        {isGoalie ? (
                            <>
                                <th className={thRight}>Déc.</th>
                                <th className={thRight}>BA</th>
                                <th className={thRight}>AR</th>
                                <th className={thRight}>FP</th>
                            </>
                        ) : (
                            <>
                                <th className={thRight}>B</th>
                                <th className={thRight}>A</th>
                                <th className={cn(thRight, 'font-bold text-[#00F0FF]')}>Pts</th>
                                <th className={thRight}>PIM</th>
                                <th className={thRight}>+/-</th>
                                <th className={thRight}>SOG</th>
                                <th className={thRight}>FP</th>
                            </>
                        )}
                    </tr>
                </TableHead>
                <tbody className='text-foreground'>
                    {rows.map((game, index) => {
                        const result = isGoalie
                            ? game.goalieWin
                                ? 'W'
                                : game.goalieOvertimeLoss
                                    ? 'OTL'
                                    : 'L'
                            : null;

                        return (
                            <tr key={game.nhlGameId} className={rowClass(index)}>
                                <td className={tdLeft}>
                                    {shortGameDate(game.gameDate)}
                                </td>
                                <td className={tdLeft}>
                                    {game.opponentAbbreviation}
                                </td>
                                <td className={tdLeft}>
                                    {game.isHomeGame ? 'H' : 'R'}
                                </td>
                                {isGoalie ? (
                                    <>
                                        <td className={tdRight}>
                                            {result}
                                            {game.shutout ? ' (SO)' : ''}
                                        </td>
                                        <td className={tdRight}>
                                            {game.goalsAgainst}
                                        </td>
                                        <td className={tdRight}>{game.saves}</td>
                                        <td className={tdRight}>
                                            {game.fantasyPoints}
                                        </td>
                                    </>
                                ) : (
                                    <>
                                        <td className={tdRight}>{game.goals}</td>
                                        <td className={tdRight}>{game.assists}</td>
                                        <td className={cn(tdRight, 'text-[#00F0FF]')}>{game.points}</td>
                                        <td className={tdRight}>
                                            {game.penaltyMinutes}
                                        </td>
                                        <td className={tdRight}>
                                            {game.plusMinus > 0
                                                ? `+${game.plusMinus}`
                                                : game.plusMinus}
                                        </td>
                                        <td className={tdRight}>{game.shots}</td>
                                        <td className={tdRight}>
                                            {game.fantasyPoints}
                                        </td>
                                    </>
                                )}
                            </tr>
                        );
                    })}
                </tbody>
            </table>
        </TableShell>
    );
}

function MonthTable({
    months,
    isGoalie,
}: {
    months: Month[];
    isGoalie: boolean;
}) {
    if (months.length === 0) {
        return null;
    }

    const cell = (value: number, hasGames: boolean): number | '—' =>
        hasGames ? value : '—';

    return (
        <TableShell>
            <table className='w-full min-w-[360px] text-[0.65rem] tabular-nums'>
                <TableHead>
                    <tr>
                        <th className={thLeft}>Mois</th>
                        {isGoalie ? (
                            <>
                                <th className={cn(thRight, 'text-[#7DD3FC]')}>GP</th>
                                <th className={cn(thRight, 'font-bold text-[#00F0FF]')}>W</th>
                                <th className={thRight}>L</th>
                                <th className={thRight}>OTL</th>
                                <th className={thRight}>SO</th>
                                <th className={thRight}>AR</th>
                                <th className={thRight}>FP</th>
                            </>
                        ) : (
                            <>
                                <th className={cn(thRight, 'text-[#7DD3FC]')}>GP</th>
                                <th className={thRight}>B</th>
                                <th className={thRight}>A</th>
                                <th className={cn(thRight, 'font-bold text-[#00F0FF]')}>Pts</th>
                                <th className={thRight}>PIM</th>
                                <th className={thRight}>+/-</th>
                                <th className={thRight}>SOG</th>
                                <th className={thRight}>FP</th>
                            </>
                        )}
                    </tr>
                </TableHead>
                <tbody className='text-foreground'>
                    {months.map((m, index) => {
                        const hasGames = m.gamesPlayed > 0;

                        return (
                            <tr key={`${m.label}-${index}`} className={rowClass(index)}>
                                <td className={tdLeft}>{m.label}</td>
                                {isGoalie ? (
                                    <>
                                        <td className={cn(tdRight, 'text-[#7DD3FC]')}>
                                            {cell(m.gamesPlayed, hasGames)}
                                        </td>
                                        <td className={cn(tdRight, 'text-[#00F0FF]')}>
                                            {cell(m.wins, hasGames)}
                                        </td>
                                        <td className={tdRight}>
                                            {cell(m.losses, hasGames)}
                                        </td>
                                        <td className={tdRight}>
                                            {cell(m.overtimeLosses, hasGames)}
                                        </td>
                                        <td className={tdRight}>
                                            {cell(m.shutouts, hasGames)}
                                        </td>
                                        <td className={tdRight}>
                                            {cell(m.saves, hasGames)}
                                        </td>
                                        <td className={tdRight}>
                                            {cell(m.fantasyPoints, hasGames)}
                                        </td>
                                    </>
                                ) : (
                                    <>
                                        <td className={cn(tdRight, 'text-[#7DD3FC]')}>
                                            {cell(m.gamesPlayed, hasGames)}
                                        </td>
                                        <td className={tdRight}>
                                            {cell(m.goals, hasGames)}
                                        </td>
                                        <td className={tdRight}>
                                            {cell(m.assists, hasGames)}
                                        </td>
                                        <td className={cn(tdRight, 'text-[#00F0FF]')}>
                                            {cell(m.points, hasGames)}
                                        </td>
                                        <td className={tdRight}>
                                            {cell(m.penaltyMinutes, hasGames)}
                                        </td>
                                        <td className={tdRight}>
                                            {hasGames
                                                ? m.plusMinus > 0
                                                    ? `+${m.plusMinus}`
                                                    : m.plusMinus
                                                : '—'}
                                        </td>
                                        <td className={tdRight}>
                                            {cell(m.shots, hasGames)}
                                        </td>
                                        <td className={tdRight}>
                                            {cell(m.fantasyPoints, hasGames)}
                                        </td>
                                    </>
                                )}
                            </tr>
                        );
                    })}
                </tbody>
            </table>
        </TableShell>
    );
}

// ---------------------------------------------------------------------
// The page
// ---------------------------------------------------------------------

export default function PlayerPage() {
    const navigate = useNavigate();
    const location = useLocation();
    const { nhlPlayerId } = useParams<{ nhlPlayerId: string }>();

    const { playerPageStyle } = useAuth();
    const isNeon = playerPageStyle === 'Neon';

    const [player, setPlayer] = useState<PlayerDetail | null>(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [showGameLog, setShowGameLog] = useState(false);
    const [showInjuryModal, setShowInjuryModal] = useState(false);

    const closeAura = useAura('playerPageCloseButton');
    const pageTeamLogoAura = useAura('playerPageTeamLogo');

    useEffect(() => {
        if (!showInjuryModal) return;

        function onKeyDown(event: KeyboardEvent) {
            if (event.key === 'Escape') {
                setShowInjuryModal(false);
            }
        }

        document.addEventListener('keydown', onKeyDown);
        return () => {
            document.removeEventListener('keydown', onKeyDown);
        };
    }, [showInjuryModal]);

    useEffect(() => {
        const state = location.state as
            | { fromCardId?: string }
            | null
            | undefined;

        void state;
    }, [location.state]);

    useEffect(() => {
        if (!nhlPlayerId) {
            setError('Identifiant de joueur manquant.');
            setLoading(false);
            return;
        }

        let cancelled = false;

        getPlayerDetail(Number(nhlPlayerId))
            .then((data) => {
                if (!cancelled) {
                    setPlayer(data);
                }
            })
            .catch((err) => {
                if (!cancelled) {
                    setError(
                        err instanceof Error
                            ? err.message
                            : 'Impossible de charger ce joueur.',
                    );
                }
            })
            .finally(() => {
                if (!cancelled) {
                    setLoading(false);
                }
            });

        return () => {
            cancelled = true;
        };
    }, [nhlPlayerId]);

    // Close: jump past every PlayerPage we opened and land on the last
    // non-player page (typically /mon-equipe, with the scroll position
    // restored by MonEquipePage via the pendingRestore store).
    //
    // If no non-player page was recorded -- direct URL entry, hard
    // reload on a player page, tab restored from a discarded state --
    // fall back to the user's own Mon équipe page.
    //
    // `replace: true` collapses the entire player-page chain out of
    // history, so a hardware / gesture Back after Fermer does not
    // re-enter the middle of the chain.
    function handleClose() {
        const stored = getLastNonPlayerLocation();

        if (stored != null) {
            navigate(
                {
                    pathname: stored.pathname,
                    search: stored.search,
                    hash: stored.hash,
                },
                { replace: true },
            );
            return;
        }

        navigate('/mon-equipe', { replace: true });
    }

    const closeRest = [
        `0 0 ${auraRangeFor(closeAura, 'playerPageCloseButton', 0).toFixed(2)}px #F2F5FA`,
        `0 0 ${auraRangeFor(closeAura, 'playerPageCloseButton', 1).toFixed(2)}px #00A8FF`,
        `0 0 ${auraRangeFor(closeAura, 'playerPageCloseButton', 2).toFixed(2)}px rgba(0, 168, 255, 0.7)`,
        `0 0 ${auraRangeFor(closeAura, 'playerPageCloseButton', 3).toFixed(2)}px rgba(0, 168, 255, 0.4)`,
    ].join(', ');

    const closePeak = [
        `0 0 ${auraRangeFor(closeAura, 'playerPageCloseButton', 0).toFixed(2)}px #F2F5FA`,
        `0 0 ${auraRangeFor(closeAura, 'playerPageCloseButton', 1).toFixed(2)}px #00A8FF`,
        `0 0 ${auraRangeFor(closeAura, 'playerPageCloseButton', 2).toFixed(2)}px #00A8FF`,
        `0 0 ${auraRangeFor(closeAura, 'playerPageCloseButton', 3).toFixed(2)}px rgba(0, 168, 255, 0.9)`,
    ].join(', ');

    // Use the aura-only color so the logo glow stays visible for
    // teams with a dark primary (UTA, SEA, TBL, etc.). The base
    // team color is intentionally not used here.
    const pageTeamLogoColor = getNhlTeamAuraColor(
        player?.nhlTeamAbbreviation ?? undefined,
    );

    const pageTeamLogoRest = [
        `drop-shadow(0 0 ${auraRangeFor(pageTeamLogoAura, 'playerPageTeamLogo', 0).toFixed(2)}px ${pageTeamLogoColor}${auraAlphaHex(pageTeamLogoAura, 0x88, 0xFF)})`,
        `drop-shadow(0 0 ${auraRangeFor(pageTeamLogoAura, 'playerPageTeamLogo', 1).toFixed(2)}px ${pageTeamLogoColor}${auraAlphaHex(pageTeamLogoAura, 0x44, 0xEE)})`,
        `drop-shadow(0 0 ${auraRangeFor(pageTeamLogoAura, 'playerPageTeamLogo', 2).toFixed(2)}px ${pageTeamLogoColor}${auraAlphaHex(pageTeamLogoAura, 0x22, 0xBB)})`,
    ].join(' ');

    const pageTeamLogoPeak = [
        `drop-shadow(0 0 ${auraRangeFor(pageTeamLogoAura, 'playerPageTeamLogo', 0).toFixed(2)}px ${pageTeamLogoColor}${auraAlphaHex(pageTeamLogoAura, 0xAA, 0xFF)})`,
        `drop-shadow(0 0 ${auraRangeFor(pageTeamLogoAura, 'playerPageTeamLogo', 1).toFixed(2)}px ${pageTeamLogoColor}${auraAlphaHex(pageTeamLogoAura, 0x55, 0xEE)})`,
        `drop-shadow(0 0 ${auraRangeFor(pageTeamLogoAura, 'playerPageTeamLogo', 2).toFixed(2)}px ${pageTeamLogoColor}${auraAlphaHex(pageTeamLogoAura, 0x33, 0xBB)})`,
    ].join(' ');

    const closeButtonClass = cn(
        'pointer-events-auto cursor-pointer rounded-md bg-transparent px-3 py-1.5 text-sm font-bold text-foreground transition-colors hover:bg-secondary',
        !isAuraOff(closeAura) ? auraPulseClass('text') : '',
    );

    const closeButtonStyle = {
        ...(!isAuraOff(closeAura)
            ? auraPulseStyle(closeRest, closePeak)
            : {}),
    } as React.CSSProperties;

    function CloseButtonLayer() {
        return (
            <div className='pointer-events-none fixed inset-x-0 top-0 z-40'>
                <div className='mx-auto flex w-full max-w-5xl justify-end px-2 pt-[calc(var(--header-height,4rem))] sm:px-3'>
                    <button
                        type='button'
                        onClick={handleClose}
                        className={closeButtonClass}
                        style={closeButtonStyle}
                    >
                        ✕ Fermer
                    </button>
                </div>
            </div>
        );
    }

    if (loading) {
        return <p className='text-muted-foreground'>Chargement...</p>;
    }

    if (error || !player) {
        return (
            <div className='space-y-3'>
                <CloseButtonLayer />
                <p className='text-destructive'>
                    {error ?? 'Joueur introuvable.'}
                </p>
            </div>
        );
    }

    const isGoalie = player.position === 'G';

    const shootsDisplay =
        player.shootsCatches === 'L'
            ? 'Gaucher'
            : player.shootsCatches === 'R'
                ? 'Droitier'
                : null;

    const heightLine =
        player.heightInInches != null
            ? `${Math.floor(player.heightInInches / 12)}.${player.heightInInches % 12}`
            : null;

    const weightLine =
        player.weightInPounds != null
            ? `${player.weightInPounds} lbs`
            : null;

    const fullHeightWeight = [heightLine, weightLine]
        .filter((v): v is string => Boolean(v))
        .join(' • ');

    const birthDateDisplay = (() => {
        if (!player.birthDate) return null;

        const d = new Date(player.birthDate);
        const day = String(d.getUTCDate()).padStart(2, '0');
        const month = String(d.getUTCMonth() + 1).padStart(2, '0');
        const year = d.getUTCFullYear();

        return `${day}/${month}/${year}`;
    })();

    const birthCountryFlagCode = toFlagCode(player.birthCountry);

    const sortedContracts = [...player.contracts].sort(
        (a, b) => a.startSeason - b.startSeason,
    );

    const currentContract =
        sortedContracts.find(
            (c) =>
                c.startSeason <= CURRENT_SEASON_CODE &&
                c.endSeason >= CURRENT_SEASON_CODE,
        ) ?? sortedContracts[0] ?? null;

    const secondContract =
        currentContract == null
            ? null
            : sortedContracts.find(
                (c) => c.startSeason > currentContract.endSeason,
            ) ?? null;

    const currentContractLabel = currentContract
        ? contractLabel(currentContract.salary, currentContract.yearsRemaining)
        : null;

    const secondContractLabel = secondContract
        ? contractLabel(secondContract.salary, secondContract.yearsRemaining)
        : null;

    const hasNhlTotals =
        player.nhlTotals.gamesPlayed > 0 ||
        player.nhlTotals.playoffGamesPlayed > 0;

    const positionGrp = positionGroup(player.position);

    // Draft boundary: the season code right below which we draw the
    // magenta line on the career tables. For a drafted player, that's
    // the season that starts in his draft year (e.g. drafted 2019 ->
    // 20192020). For an undrafted player, we use his first eligible
    // draft year based on his birth date. If we know neither, the line
    // is simply not drawn.
    const draftYearForLine =
        player.draftYear ?? firstEligibleDraftYear(player.birthDate);

    const draftBoundarySeason =
        draftYearForLine != null
            ? draftedBoundarySeason(draftYearForLine)
            : null;

    return (
        <>
            <CloseButtonLayer />

            <section className='mx-auto -mt-3 w-full max-w-5xl space-y-4'>
                {player.heroImageUrl && (
                    <div className='aspect-[22/9] w-full overflow-hidden rounded-lg border border-border bg-black'>
                        <img
                            src={player.heroImageUrl}
                            alt=''
                            className='h-full w-full scale-[1.12] object-cover object-top'
                            loading='lazy'
                        />
                    </div>
                )}

                <div className='relative -mt-2 sm:flex sm:flex-row sm:items-start sm:gap-4'>
                    <div className='min-w-0 space-y-1 sm:flex-1'>
                        <div className='flex flex-wrap items-center justify-center gap-x-3 gap-y-1 sm:justify-start'>
                            <span className='relative inline-block'>
                                <h1 className='mt-[9px] mb-[14px] leading-none'>
                                    {isNeon ? (
                                        <NeonTitle
                                            variant='section'
                                            auraColor={pageTeamLogoColor}
                                            showStroke={false}
                                        >
                                            {player.firstName} {player.lastName}
                                        </NeonTitle>
                                    ) : (
                                        /* Classic style: plain white bold
                                           sans-serif, no aura, no stroke. */
                                        <span className='text-xl font-bold text-foreground'>
                                            {player.firstName} {player.lastName}
                                        </span>
                                    )}
                                </h1>

                                {player.isInjured && (
                                    <span className='absolute left-full top-0 ml-2 flex h-7 items-center'>
                                        <InjuryBadge
                                            isInjured={player.isInjured}
                                            injuryKind={player.injuryKind}
                                            shortDescription={player.injuryShortDescription}
                                            size={20}
                                            onClick={() => setShowInjuryModal(true)}
                                        />
                                    </span>
                                )}
                            </span>

                            <span className='hidden rounded border border-border px-2 py-0.5 text-xs uppercase tracking-wide text-muted-foreground sm:inline-block'>
                                {player.status}
                            </span>
                        </div>

                        {player.position && (
                            <p className='mt-1 flex h-5 items-center text-sm text-foreground'>
                                <span>
                                    <span className='font-bold'>
                                        {displayPosition(player.position)}
                                    </span>
                                    {shootsDisplay && (
                                        <span className='mx-1 inline-block font-black [text-shadow:0_0_1px_currentColor,0_0_1px_currentColor]'>
                                            •
                                        </span>
                                    )}
                                    {shootsDisplay}
                                </span>

                                <RosterLocationBadge
                                    location={player.rosterLocation}
                                    onInjuredClick={() =>
                                        setShowInjuryModal(true)
                                    }
                                />

                                {player.nhlTeamLogoUrl && (
                                    <img
                                        src={player.nhlTeamLogoUrl}
                                        alt={player.nhlTeamAbbreviation ?? ''}
                                        className={`h-8 w-8 shrink-0 ${!isAuraOff(pageTeamLogoAura) ? auraPulseClass('filter') : ''}`}
                                        style={
                                            !isAuraOff(pageTeamLogoAura)
                                                ? auraPulseStyle(pageTeamLogoRest, pageTeamLogoPeak)
                                                : undefined
                                        }
                                    />
                                )}
                            </p>
                        )}

                        {(birthDateDisplay || player.age != null) && (
                            <p className='text-sm text-foreground'>
                                {birthDateDisplay}
                                {birthDateDisplay && player.age != null && (
                                    <span className='mx-1 inline-block font-black [text-shadow:0_0_1px_currentColor,0_0_1px_currentColor]'>
                                        •
                                    </span>
                                )}
                                {player.age != null && `${player.age} ans`}
                            </p>
                        )}

                        {(player.birthCity || birthCountryFlagCode) && (
                            <p className='flex items-center text-sm text-foreground'>
                                <span>{player.birthCity}</span>

                                {birthCountryFlagCode && (
                                    <span
                                        title={player.birthCountry ?? ''}
                                        style={{ display: 'inline-block', lineHeight: 0 }}
                                        className='ml-2'
                                    >
                                        <ReactCountryFlag
                                            countryCode={birthCountryFlagCode}
                                            svg
                                            style={{
                                                width: '1.25rem',
                                                height: '1.25rem',
                                                display: 'inline-block',
                                            }}
                                        />
                                    </span>
                                )}
                            </p>
                        )}

                        {fullHeightWeight && (
                            <p className='flex items-center text-sm text-foreground'>
                                <Ruler className='mr-1.5 h-3.5 w-3.5 shrink-0 text-[#D4C5A0]' />
                                <span>
                                    {heightLine}
                                    {heightLine && weightLine && (
                                        <span className='mx-1 inline-block font-black [text-shadow:0_0_1px_currentColor,0_0_1px_currentColor]'>
                                            •
                                        </span>
                                    )}
                                    {weightLine}
                                </span>
                            </p>
                        )}

                        {player.draftYear && player.draftOverallPick && (
                            <p className='flex items-center pb-1 text-xs text-white'>
                                <span className='inline-flex items-center gap-1.5'>
                                    Drafted by
                                    {player.draftTeamAbbreviation && (
                                        <NhlTeamLogo
                                            abbreviation={player.draftTeamAbbreviation}
                                            size={16}
                                        />
                                    )}
                                </span>
                                <span className='mx-1.5'>•</span>
                                <span>
                                    Round {player.draftRound} #{player.draftOverallPick}
                                </span>
                                <span className='mx-1.5 inline-block font-black [text-shadow:0_0_1px_currentColor,0_0_1px_currentColor]'>
                                    •
                                </span>
                                <span>{player.draftYear}</span>
                            </p>
                        )}

                        {player.fantasyTeamName && (
                            <p className='text-sm text-foreground'>
                                <span className='font-bold'>Équipe:</span>{' '}
                                {player.fantasyTeamId != null ? (
                                    <Link
                                        to={`/mon-equipe?teamId=${player.fantasyTeamId}`}
                                        className='font-bold text-[#00E5D4] hover:underline [text-shadow:0_0_4px_rgba(0,229,212,0.7)]'
                                    >
                                        {player.fantasyTeamName}
                                    </Link>
                                ) : (
                                    <span className='font-bold text-[#00E5D4] [text-shadow:0_0_4px_rgba(0,229,212,0.7)]'>
                                        {player.fantasyTeamName}
                                    </span>
                                )}
                            </p>
                        )}

                        {currentContractLabel && (
                            <p className='flex items-center text-sm text-foreground'>
                                <Banknote className='mr-1.5 h-3.5 w-3.5 shrink-0 text-green-500' />
                                <span>
                                    {secondContractLabel ? (
                                        <>
                                            <span>{currentContractLabel}</span>
                                            <span
                                                aria-hidden='true'
                                                className='mx-1 text-white opacity-80'
                                            >
                                                →
                                            </span>
                                            <span>{secondContractLabel}</span>
                                        </>
                                    ) : (
                                        <span>{currentContractLabel}</span>
                                    )}
                                </span>
                            </p>
                        )}
                    </div>

                    {player.headshotUrl && (
                        <img
                            src={player.headshotUrl}
                            alt={`${player.firstName} ${player.lastName}`}
                            className='absolute right-3 top-[3.5rem] h-29 w-29 shrink-0 rounded-md bg-white object-cover sm:static sm:mt-0 sm:h-32 sm:w-32'
                            loading='lazy'
                            /* Team-colored halo around the headshot
                               frame. Two layers: a tight ring for
                               edge definition, then a softer wide
                               bloom. Uses the same color as the
                               team logo aura and the name. The
                               `CC` suffix is ~80% alpha, `66` is
                               ~40%. */
                            style={
                                isNeon
                                    ? {
                                        boxShadow: `0 0 12px ${pageTeamLogoColor}FF, 0 0 26px ${pageTeamLogoColor}99`,
                                    }
                                    : undefined
                            }
                        />
                    )}
                </div>

                <div className='mt-6 w-full'>
                    <CurrentSeasonStrip
                        stats={player.currentSeasonStats}
                        isGoalie={isGoalie}
                        auraColor={isNeon ? pageTeamLogoColor : undefined}
                    />
                </div>

                <div className='grid grid-cols-1 gap-y-4 md:grid-cols-2 md:gap-x-1'>
                    <div>
                        <div>
                            <SubSectionTitle neon={isNeon} auraColor={pageTeamLogoColor}>
                                Saison régulière
                            </SubSectionTitle>
                            {isGoalie ? (
                                <GoalieCareerTable
                                    rows={combineNhlSeasonRows(
                                        withCurrentTeamName(
                                            careerRowsForDisplay(
                                                player.regularSeason,
                                                true,
                                                true,
                                            ),
                                            player.nhlTeamAbbreviation,
                                        ),
                                    )}
                                    draftBoundarySeason={draftBoundarySeason}
                                    showFantasyPoints
                                    totalsRow={
                                        hasNhlTotals ? (
                                            <TotalsRow
                                                regularSeason
                                                careerRows={player.regularSeason}
                                                nhlTotals={player.nhlTotals}
                                                isGoalie
                                            />
                                        ) : null
                                    }
                                />
                            ) : (
                                <SkaterCareerTable
                                    rows={combineNhlSeasonRows(
                                        withCurrentTeamName(
                                            careerRowsForDisplay(
                                                player.regularSeason,
                                                true,
                                                true,
                                            ),
                                            player.nhlTeamAbbreviation,
                                        ),
                                    )}
                                    draftBoundarySeason={draftBoundarySeason}
                                    showFantasyPoints
                                    showVor
                                    positionGroup={positionGrp}
                                    totalsRow={
                                        hasNhlTotals ? (
                                            <TotalsRow
                                                regularSeason
                                                showFantasyPoints
                                                showVor
                                                careerRows={player.regularSeason}
                                                nhlTotals={player.nhlTotals}
                                                isGoalie={false}
                                            />
                                        ) : null
                                    }
                                />
                            )}
                        </div>
                    </div>

                    <div>
                        <div>
                            <SubSectionTitle neon={isNeon} auraColor={pageTeamLogoColor}>
                                Séries
                            </SubSectionTitle>
                            {isGoalie ? (
                                <GoalieCareerTable
                                    rows={careerRowsForDisplay(
                                        player.playoffs,
                                        true,
                                        false,
                                    )}
                                    draftBoundarySeason={draftBoundarySeason}
                                    showFantasyPoints
                                    totalsRow={
                                        hasNhlTotals ? (
                                            <TotalsRow
                                                regularSeason={false}
                                                careerRows={player.playoffs}
                                                nhlTotals={player.nhlTotals}
                                                isGoalie
                                            />
                                        ) : null
                                    }
                                />
                            ) : (
                                <SkaterCareerTable
                                    rows={careerRowsForDisplay(
                                        player.playoffs,
                                        true,
                                        false,
                                    )}
                                    draftBoundarySeason={draftBoundarySeason}
                                    totalsRow={
                                        hasNhlTotals ? (
                                            <TotalsRow
                                                regularSeason={false}
                                                careerRows={player.playoffs}
                                                nhlTotals={player.nhlTotals}
                                                isGoalie={false}
                                            />
                                        ) : null
                                    }
                                />
                            )}
                        </div>
                    </div>
                </div>

                {player.seasonMonths.length > 0 && (
                    <>
                        <SectionTitle neon={isNeon} auraColor={pageTeamLogoColor}>
                            Par mois (saison courante)
                        </SectionTitle>
                        <MonthTable
                            months={player.seasonMonths}
                            isGoalie={isGoalie}
                        />
                    </>
                )}

                <SectionTitle neon={isNeon} auraColor={pageTeamLogoColor}>
                    Fiches de match
                </SectionTitle>
                <button
                    type='button'
                    onClick={() => setShowGameLog((v) => !v)}
                    className='cursor-pointer rounded-md border border-border px-3 py-1.5 text-sm text-foreground transition-colors hover:bg-secondary'
                >
                    {showGameLog ? '▼ Masquer' : '▶ Afficher'} les fiches
                    de match
                </button>

                {showGameLog && (
                    <div className='mt-3'>
                        <GameLogTable
                            rows={player.recentGames}
                            isGoalie={isGoalie}
                        />
                    </div>
                )}

                <SectionTitle neon={isNeon} auraColor={pageTeamLogoColor}>
                    Historique des blessures
                </SectionTitle>

                {player.injuryHistory.length === 0 ? (
                    <p className='text-sm text-muted-foreground'>
                        Aucune blessure enregistrée.
                    </p>
                ) : (
                    <TableShell>
                        <table className='w-full min-w-[640px] text-xs tabular-nums'>
                            <TableHead>
                                <tr>
                                    <th className={thLeft}>Statut</th>
                                    <th className={thLeft}>Équipe</th>
                                    <th className={thLeft}>Vue le</th>
                                    <th className={thLeft}>
                                        Dernière vue
                                    </th>
                                    <th className={thLeft}>Résolue le</th>
                                    <th className={thLeft}>Note</th>
                                </tr>
                            </TableHead>
                            <tbody className='text-foreground'>
                                {player.injuryHistory.map((spell, index) => (
                                    <tr
                                        key={`${spell.firstSeenAt}-${index}`}
                                        className={rowClass(index)}
                                    >
                                        <td className={tdLeft}>
                                            {spell.injuryStatus}
                                        </td>
                                        <td className={tdLeft}>
                                            {spell.teamAbbreviation}
                                        </td>
                                        <td className={tdLeft}>
                                            {shortDate(spell.firstSeenAt)}
                                        </td>
                                        <td className={tdLeft}>
                                            {shortDate(spell.lastSeenAt)}
                                        </td>
                                        <td className={tdLeft}>
                                            {spell.resolvedAt
                                                ? shortDate(spell.resolvedAt)
                                                : 'En cours'}
                                        </td>
                                        <td
                                            className={`${tdLeft} max-w-md whitespace-normal text-[0.7rem] text-muted-foreground`}
                                        >
                                            {spell.injuryDescription ?? '—'}
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </TableShell>
                )}

                <SubSectionTitle neon={isNeon} auraColor={pageTeamLogoColor}>
                    Tournois
                </SubSectionTitle>
                {isGoalie ? (
                    <GoalieCareerTable rows={player.tournaments} plainRows />
                ) : (
                    <SkaterCareerTable rows={player.tournaments} plainRows />
                )}

                <div className='mt-6'>
                    <SubSectionTitle neon={isNeon} auraColor={pageTeamLogoColor}>
                        Youth / Minor
                    </SubSectionTitle>
                    {isGoalie ? (
                        <GoalieCareerTable
                            rows={player.youthMinor}
                            variant='youthMinor'
                        />
                    ) : (
                        <SkaterCareerTable
                            rows={player.youthMinor}
                            variant='youthMinor'
                        />
                    )}
                </div>
            </section>

            {showInjuryModal && player.isInjured && (
                <div
                    className='fixed inset-0 z-[100] flex items-center justify-center bg-black/60 px-4'
                    onClick={() => setShowInjuryModal(false)}
                    role='dialog'
                    aria-modal='true'
                    aria-label='Détails de la blessure'
                >
                    <div
                        className='w-full max-w-md rounded-lg border border-destructive/40 bg-card shadow-2xl'
                        onClick={(event) => event.stopPropagation()}
                    >
                        <div className='flex items-center justify-between border-b border-border px-4 py-3'>
                            <h3 className='text-base font-semibold text-foreground'>
                                {player.injuryKind === 'Suspension'
                                    ? 'Suspension'
                                    : 'Blessure'}
                            </h3>

                            <button
                                type='button'
                                onClick={() => setShowInjuryModal(false)}
                                aria-label='Fermer'
                                className='cursor-pointer rounded-md p-1 text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground'
                            >
                                ✕
                            </button>
                        </div>

                        <div className='space-y-3 px-4 py-3 text-sm'>
                            <div className='flex items-center justify-between gap-2'>
                                <span className='font-semibold text-foreground'>
                                    {player.injuryKind === 'Suspension'
                                        ? 'Suspension'
                                        : 'Blessé'}
                                </span>

                                <span className='text-foreground'>
                                    {player.injuryStatus ?? 'Statut inconnu'}
                                </span>
                            </div>

                            {player.injuryReturnDate && (
                                <p className='text-foreground'>
                                    <span className='font-medium'>
                                        Retour prévu :{' '}
                                    </span>
                                    {shortDate(player.injuryReturnDate)}
                                </p>
                            )}

                            {(player.injuryType ||
                                player.injurySide ||
                                player.injuryDetail) && (
                                    <p className='text-foreground'>
                                        {player.injuryType}
                                        {player.injurySide &&
                                            player.injurySide !== 'Not Specified' &&
                                            ` (${player.injurySide})`}
                                        {player.injuryDetail &&
                                            player.injuryDetail !== 'Not Specified' &&
                                            ` — ${player.injuryDetail}`}
                                    </p>
                                )}

                            {player.injuryShortDescription && (
                                <p className='text-foreground'>
                                    {player.injuryShortDescription}
                                </p>
                            )}

                            {player.injuryLongDescription &&
                                player.injuryLongDescription
                                    .trim()
                                    .toLowerCase() !==
                                (
                                    player.injuryShortDescription ?? ''
                                )
                                    .trim()
                                    .toLowerCase() && (
                                    <p className='text-foreground'>
                                        {player.injuryLongDescription}
                                    </p>
                                )}

                            <p className='text-xs text-foreground'>
                                Dernière mise à jour :{' '}
                                {shortDate(player.injuryUpdatedAt)}
                            </p>
                        </div>
                    </div>
                </div>
            )}
        </>
    );
}