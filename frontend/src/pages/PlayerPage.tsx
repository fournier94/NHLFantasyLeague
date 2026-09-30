import { useEffect, useRef, useState } from 'react';
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
} from '@/lib/auraConfig';
import { getNhlTeamColor } from '@/lib/nhlTeamColors';
import ReactCountryFlag from 'react-country-flag';
import { NhlTeamLogo } from '@/components/nhl/NhlTeamLogo';
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

function vorThreshold(group: 'F' | 'D' | 'G' | ''): number {
    switch (group) {
        case 'F': return 45;
        case 'D': return 25;
        case 'G': return 65;
        default: return 0;
    }
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

// ---------------------------------------------------------------------
// Table primitives
// ---------------------------------------------------------------------

const thBase = 'px-1 py-1 font-medium whitespace-nowrap';
const thLeft = `${thBase} text-center`;
const thRight = `${thBase} text-center`;
const tdBase = 'px-1 py-0.5 whitespace-nowrap';
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

function SectionTitle({ children }: { children: React.ReactNode }) {
    return (
        <h2 className='mt-6 mb-2 text-center text-lg font-semibold text-foreground md:text-xl'>
            {children}
        </h2>
    );
}

function SubSectionTitle({ children }: { children: React.ReactNode }) {
    return (
        <h3 className='mb-1 text-center text-base font-medium text-white'>
            {children}
        </h3>
    );
}

function InjuryBadge({
    isInjured,
    injuryKind,
    shortDescription,
    size = 16,
}: {
    isInjured: boolean;
    injuryKind: string;
    shortDescription: string | null;
    size?: number;
}) {
    if (!isInjured) return null;

    const isSuspension = injuryKind === 'Suspension';
    const crossColor = isSuspension ? '#fbbf24' : '#ef4444';
    const glowColor = isSuspension
        ? 'drop-shadow(0 0 3px rgba(251, 191, 36, 0.9))'
        : 'drop-shadow(0 0 3px rgba(239, 68, 68, 0.9))';
    const label = isSuspension ? 'Suspension' : 'Blessé';

    return (
        <span
            title={shortDescription ?? label}
            aria-label={label}
            className='inline-flex shrink-0 items-center justify-center'
            style={{ width: size, height: size, filter: glowColor }}
        >
            <svg
                viewBox='0 0 24 24'
                width={size}
                height={size}
                xmlns='http://www.w3.org/2000/svg'
            >
                <rect x='9' y='3' width='6' height='18' fill={crossColor} />
                <rect x='3' y='9' width='18' height='6' fill={crossColor} />
            </svg>
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
    vor = 0,
    totalsRow = null,
    plainRows = false,
    variant = 'default',
}: {
    rows: CareerRow[];
    showFantasyPoints?: boolean;
    showVor?: boolean;
    vor?: number;
    totalsRow?: React.ReactNode;
    plainRows?: boolean;
    variant?: 'default' | 'youthMinor';
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
                            <th className={cn(thRight, 'font-bold text-[#D4AF37]')}>FP</th>
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
                    {rows.map((row, index) => (
                        <tr
                            key={`${row.season}-${row.leagueAbbreviation}-${row.teamName}-${index}`}
                            className={
                                plainRows
                                    ? rowClass(index)
                                    : careerRowClass(row, index)
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
                                            ? 'text-[#D4AF37]'
                                            : 'text-foreground',
                                    )}
                                >
                                    {row.hatTricks == null
                                        ? '—'
                                        : row.points + row.hatTricks * 2}
                                </td>
                            )}
                            {!isYouthMinor && showVor && (() => {
                                if (row.hatTricks == null) {
                                    return <td className={tdRight}>—</td>;
                                }

                                const fp = row.points + row.hatTricks * 2;
                                const vorValue = fp - vor;

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
                    ))}
                    {totalsRow}
                </tbody>
            </table>
        </TableShell>
    );
}

function GoalieCareerTable({
    rows,
    totalsRow = null,
    plainRows = false,
    variant = 'default',
}: {
    rows: CareerRow[];
    totalsRow?: React.ReactNode;
    plainRows?: boolean;
    variant?: 'default' | 'youthMinor';
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
                                <th className={thRight}>SV%</th>
                                <th className={thRight}>GAA</th>
                                <th className={thRight}>SV</th>
                                <th className={thRight}>SA</th>
                            </>
                        )}
                    </tr>
                </TableHead>
                <tbody className='text-foreground'>
                    {rows.map((row, index) => (
                        <tr
                            key={`${row.season}-${row.leagueAbbreviation}-${row.teamName}-${index}`}
                            className={
                                plainRows
                                    ? rowClass(index)
                                    : careerRowClass(row, index)
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
                    ))}
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
            <table className='w-full min-w-[480px] text-xs tabular-nums'>
                <TableHead>
                    <tr>
                        <th className={thLeft}>Mois</th>
                        <th className={thLeft}>Dates</th>
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

                        const dates =
                            m.startDate && m.endDate
                                ? `${shortGameDate(m.startDate)} – ${shortGameDate(m.endDate)}`
                                : '—';

                        return (
                            <tr key={`${m.label}-${index}`} className={rowClass(index)}>
                                <td className={tdLeft}>{m.label}</td>
                                <td className={`${tdLeft} text-muted-foreground`}>
                                    {dates}
                                </td>
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

    const [player, setPlayer] = useState<PlayerDetail | null>(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [showGameLog, setShowGameLog] = useState(false);
    const [showInjuryDetails, setShowInjuryDetails] = useState(false);
    const [activeTab, setActiveTab] = useState<'career' | 'journal'>('career');

    const injuryPanelRef = useRef<HTMLDivElement>(null);
    const injuryScrollOnOpenRef = useRef(false);

    const closeAura = useAura('playerPageCloseButton');
    const pageTeamLogoAura = useAura('playerPageTeamLogo');
    const tabAura = useAura('playerPageTabButton');

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

    useEffect(() => {
        if (!showInjuryDetails) {
            injuryScrollOnOpenRef.current = false;
            return;
        }

        if (!injuryScrollOnOpenRef.current) {
            return;
        }

        injuryScrollOnOpenRef.current = false;

        const frame = requestAnimationFrame(() => {
            const el = injuryPanelRef.current;

            if (!el) return;

            const rect = el.getBoundingClientRect();
            const bottomGap = 16;
            const top =
                rect.bottom + window.scrollY - window.innerHeight + bottomGap;

            window.scrollTo({ top, behavior: 'smooth' });
        });

        return () => cancelAnimationFrame(frame);
    }, [showInjuryDetails]);

    function handleClose() {
        if (window.history.length > 1) {
            navigate(-1);
        } else {
            navigate('/joueurs');
        }
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

    // Tab button aura: a small blue text-shadow chain applied to both
    // tab buttons so their labels get a subtle neon glow. The two
    // endpoints are close, giving the pulse a gentle breathing motion.
    const tabRest = [
        `0 0 ${auraRangeFor(tabAura, 'playerPageTabButton', 0).toFixed(2)}px rgba(0, 168, 255, 0.85)`,
        `0 0 ${auraRangeFor(tabAura, 'playerPageTabButton', 1).toFixed(2)}px rgba(0, 168, 255, 0.55)`,
        `0 0 ${auraRangeFor(tabAura, 'playerPageTabButton', 2).toFixed(2)}px rgba(0, 168, 255, 0.3)`,
    ].join(', ');

    const tabPeak = [
        `0 0 ${auraRangeFor(tabAura, 'playerPageTabButton', 0).toFixed(2)}px rgba(0, 168, 255, 1)`,
        `0 0 ${auraRangeFor(tabAura, 'playerPageTabButton', 1).toFixed(2)}px rgba(0, 168, 255, 0.75)`,
        `0 0 ${auraRangeFor(tabAura, 'playerPageTabButton', 2).toFixed(2)}px rgba(0, 168, 255, 0.45)`,
    ].join(', ');

    const pageTeamLogoColor = getNhlTeamColor(
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

    // Both tab buttons share the same glow class/style. The aura is a
    // text-shadow on the button's text content, so it does not affect
    // the border/background box.
    const tabButtonAuraClass =
        !isAuraOff(tabAura) ? auraPulseClass('text') : '';

    const tabButtonAuraStyle =
        !isAuraOff(tabAura)
            ? auraPulseStyle(tabRest, tabPeak)
            : undefined;

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
    const vor = vorThreshold(positionGrp);

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
                                <h1 className='text-xl font-bold text-foreground'>
                                    {player.firstName} {player.lastName}
                                </h1>

                                {player.isInjured && (
                                    <span className='absolute left-full top-0 ml-2 flex h-7 items-center'>
                                        <InjuryBadge
                                            isInjured={player.isInjured}
                                            injuryKind={player.injuryKind}
                                            shortDescription={player.injuryShortDescription}
                                            size={20}
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
                            className='absolute right-0 top-[2.5rem] h-29 w-29 shrink-0 rounded-md bg-white object-cover sm:static sm:mt-0 sm:h-32 sm:w-32'
                            loading='lazy'
                        />
                    )}
                </div>

                {player.isInjured && (
                    <div
                        ref={injuryPanelRef}
                        className='rounded-lg border border-destructive/40 bg-destructive/10 text-sm'
                    >
                        <button
                            type='button'
                            onClick={() => {
                                setShowInjuryDetails((v) => {
                                    const next = !v;
                                    injuryScrollOnOpenRef.current = next;
                                    return next;
                                });
                            }}
                            aria-expanded={showInjuryDetails}
                            className='relative flex w-full cursor-pointer flex-col items-center gap-y-1 rounded-lg px-8 py-2 text-center font-semibold text-foreground transition-colors hover:bg-destructive/10'
                        >
                            <div className='flex flex-wrap items-center justify-center gap-x-2'>
                                <span>
                                    {player.injuryKind === 'Suspension'
                                        ? 'Suspension'
                                        : 'Blessé'}
                                </span>

                                <span className='font-normal text-muted-foreground'>•</span>

                                <span>
                                    {player.injuryStatus ?? 'Statut inconnu'}
                                </span>
                            </div>

                            {player.injuryReturnDate && (
                                <div className='flex w-full items-center justify-center'>
                                    <span>
                                        Retour prévu :{' '}
                                        <span className='font-normal'>
                                            {shortDate(player.injuryReturnDate)}
                                        </span>
                                    </span>
                                </div>
                            )}

                            <span
                                aria-hidden='true'
                                className='absolute right-3 top-1/2 -translate-y-1/2 text-xs font-normal'
                            >
                                {showInjuryDetails ? '▲' : '▼'}
                            </span>
                        </button>

                        {showInjuryDetails && (
                            <div className='px-3 pb-3'>
                                {(player.injuryType ||
                                    player.injurySide ||
                                    player.injuryDetail) && (
                                        <p className='mt-1 text-foreground'>
                                            {player.injuryType}
                                            {player.injurySide &&
                                                player.injurySide !== 'Not Specified' &&
                                                ` (${player.injurySide})`}
                                            {player.injuryDetail &&
                                                player.injuryDetail !== 'Not Specified' &&
                                                ` — ${player.injuryDetail}`}
                                        </p>
                                    )}

                                {player.injuryFantasyStatus &&
                                    player.injuryFantasyStatus.trim().toLowerCase() !==
                                    (player.injuryStatus ?? '')
                                        .trim()
                                        .toLowerCase() && (
                                        <p className='mt-1 text-foreground'>
                                            Statut fantaisie :{' '}
                                            {player.injuryFantasyStatus}
                                        </p>
                                    )}

                                {player.injuryShortDescription && (
                                    <p className='mt-1 text-foreground'>
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
                                        <p className='mt-1 text-muted-foreground'>
                                            {player.injuryLongDescription}
                                        </p>
                                    )}

                                <p className='mt-1 text-xs text-muted-foreground'>
                                    Dernière mise à jour :{' '}
                                    {shortDate(player.injuryUpdatedAt)}
                                </p>
                            </div>
                        )}
                    </div>
                )}

                <div className='mt-6 flex justify-center gap-3'>
                    <button
                        type='button'
                        onClick={() => setActiveTab('career')}
                        className={cn(
                            'cursor-pointer rounded-md px-5 py-2 text-base font-semibold transition-colors duration-200 focus:outline-none focus-visible:outline-none focus-visible:ring-0',
                            activeTab === 'career' && !isAuraOff(tabAura)
                                ? tabButtonAuraClass
                                : '[text-shadow:none]',
                            activeTab === 'career'
                                ? isAuraOff(tabAura)
                                    ? 'border border-[#00A8FF] bg-[#080D1A] text-[#F2F5FA] shadow-none'
                                    : 'border border-[#00A8FF] bg-[#080D1A] text-[#F2F5FA] shadow-[0_0_6px_rgba(255,255,255,0.9),0_0_12px_rgba(0,168,255,0.9),0_0_24px_rgba(0,168,255,0.55),0_0_48px_rgba(0,168,255,0.3),inset_0_0_8px_rgba(0,168,255,0.25)]'
                                : 'border border-border bg-transparent text-muted-foreground shadow-none hover:border-[#00A8FF]/60 hover:text-[#F2F5FA]',
                        )}
                        style={
                            activeTab === 'career' && !isAuraOff(tabAura)
                                ? tabButtonAuraStyle
                                : undefined
                        }
                    >
                        Carrière
                    </button>

                    <button
                        type='button'
                        onClick={() => setActiveTab('journal')}
                        className={cn(
                            'cursor-pointer rounded-md px-5 py-2 text-base font-semibold transition-colors duration-200 focus:outline-none focus-visible:outline-none focus-visible:ring-0',
                            activeTab === 'journal' && !isAuraOff(tabAura)
                                ? tabButtonAuraClass
                                : '[text-shadow:none]',
                            activeTab === 'journal'
                                ? isAuraOff(tabAura)
                                    ? 'border border-[#00A8FF] bg-[#080D1A] text-[#F2F5FA] shadow-none'
                                    : 'border border-[#00A8FF] bg-[#080D1A] text-[#F2F5FA] shadow-[0_0_6px_rgba(255,255,255,0.9),0_0_12px_rgba(0,168,255,0.9),0_0_24px_rgba(0,168,255,0.55),0_0_48px_rgba(0,168,255,0.3),inset_0_0_8px_rgba(0,168,255,0.25)]'
                                : 'border border-border bg-transparent text-muted-foreground shadow-none hover:border-[#00A8FF]/60 hover:text-[#F2F5FA]',
                        )}
                        style={
                            activeTab === 'journal' && !isAuraOff(tabAura)
                                ? tabButtonAuraStyle
                                : undefined
                        }
                    >
                        Game logs
                    </button>
                </div>

                {activeTab === 'career' && (
                    <>
                        <div className='grid grid-cols-1 gap-y-4 md:grid-cols-2 md:gap-x-1'>
                            <div>
                                <div>
                                    <SubSectionTitle>Saison régulière</SubSectionTitle>
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
                                            showFantasyPoints
                                            showVor
                                            vor={vor}
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
                                    <SubSectionTitle>Séries</SubSectionTitle>
                                    {isGoalie ? (
                                        <GoalieCareerTable
                                            rows={careerRowsForDisplay(
                                                player.playoffs,
                                                true,
                                                false,
                                            )}
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

                        <SubSectionTitle>Tournois</SubSectionTitle>
                        {isGoalie ? (
                            <GoalieCareerTable rows={player.tournaments} plainRows />
                        ) : (
                            <SkaterCareerTable rows={player.tournaments} plainRows />
                        )}

                        <div className='mt-6'>
                            <SubSectionTitle>Youth / Minor</SubSectionTitle>
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

                        <SectionTitle>Historique des blessures</SectionTitle>

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
                    </>
                )}

                {activeTab === 'journal' && (
                    <>
                        {player.seasonMonths.length > 0 && (
                            <>
                                <SectionTitle>
                                    Par mois (saison courante)
                                </SectionTitle>
                                <MonthTable
                                    months={player.seasonMonths}
                                    isGoalie={isGoalie}
                                />
                            </>
                        )}

                        <SectionTitle>Fiches de match</SectionTitle>
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
                    </>
                )}
            </section>
        </>
    );
}