import { useEffect, useRef, useState } from 'react';
import { Link, useLocation, useNavigate, useParams } from 'react-router-dom';
import {
    getPlayerDetail,
    type CareerRow,
    type GameLogRow,
    type PlayerDetail,
    type Quarter,
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

/** Maps the Alpha-3 country codes stored in the DB to the Alpha-2 codes react-country-flag expects. */
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

/** Normalizes a position string: uppercase, no accents, single spaces. */
function normalizePosition(position: string): string {
    return position
        .trim()
        .toUpperCase()
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .replace(/\s+/g, ' ');
}

/** Maps NHL position codes to the French abbreviations used in this league. */
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
 * Collapses every position string into one of "F", "D", "G", or "" (unknown).
 * Uses an explicit allowlist of known English and French position strings
 * so a French "Ailier Droit" (AD) is never confused with a defenseman
 * because it contains the letter D.
 */
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

/** Value over replacement threshold per position group. */
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

/**
 * Returns the rows to display for a career table: the current season
 * (injected with zeros if missing) plus the previous 3 seasons, OR the
 * full list when `showAll` is true. Rows are kept in the order they
 * arrive in (most recent first).
 */
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

/**
 * Aggregates a set of game-log rows into the totals the fantasy table
 * needs. `hatTricks` only counts games where the player scored 3+ goals.
 */
function aggregateGameLog(rows: GameLogRow[]) {
    const gamesPlayed = rows.length;
    const goals = rows.reduce((sum, g) => sum + g.goals, 0);
    const assists = rows.reduce((sum, g) => sum + g.assists, 0);
    const points = goals + assists;
    const hatTricks = rows.filter((g) => g.goals >= 3).length;
    const totalFantasyPoints = rows.reduce(
        (sum, g) => sum + g.fantasyPoints,
        0,
    );

    return {
        gamesPlayed,
        goals,
        assists,
        points,
        hatTricks,
        totalFantasyPoints,
    };
}

// ---------------------------------------------------------------------
// Table primitives (dark theme, matching MonÉquipe)
// ---------------------------------------------------------------------

const thBase = 'px-2 py-1 font-medium whitespace-nowrap';
const thLeft = `${thBase} text-left`;
const thRight = `${thBase} text-right`;
const tdBase = 'px-2 py-0.5 whitespace-nowrap';
const tdLeft = `${tdBase} text-left`;
const tdRight = `${tdBase} text-right`;

function TableShell({ children }: { children: React.ReactNode }) {
    return (
        <div className='w-full overflow-x-auto rounded-lg border border-border bg-card pb-1'>
            {children}
        </div>
    );
}

function TableHead({ children }: { children: React.ReactNode }) {
    return (
        <thead className='border-b border-border text-[0.65rem] uppercase tracking-wide text-muted-foreground'>
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
        <h3 className='mb-1 text-sm font-medium text-white'>
            {children}
        </h3>
    );
}

/**
 * Renders the injury or suspension icon, or null when the player is
 * not injured. Same shape as the one in PlayerCard so the two pages
 * look consistent.
 */
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

function SkaterCareerTable({ rows }: { rows: CareerRow[] }) {
    if (rows.length === 0) {
        return (
            <TableShell>
                <div className='p-3 text-sm text-muted-foreground'>
                    Aucune donnée.
                </div>
            </TableShell>
        );
    }

    return (
        <TableShell>
            <table className='w-full min-w-[640px] text-xs tabular-nums'>
                <TableHead>
                    <tr>
                        <th className={thLeft}>Season</th>
                        <th className={thLeft}>Team</th>
                        <th className={thLeft}>Lge</th>
                        <th className={thRight}>GP</th>
                        <th className={thRight}>G</th>
                        <th className={thRight}>A</th>
                        <th className={thRight}>Pts</th>
                        <th className={thRight}>PIM</th>
                        <th className={thRight}>+/-</th>
                        <th className={thRight}>PPP</th>
                        <th className={thRight}>SOG</th>
                        <th className={thRight}>GWG</th>
                        <th className={thRight}>ATOI</th>
                    </tr>
                </TableHead>
                <tbody className='text-foreground'>
                    {rows.map((row, index) => (
                        <tr
                            key={`${row.season}-${row.leagueAbbreviation}-${row.teamName}-${index}`}
                            className={rowClass(index)}
                        >
                            <td className={tdLeft}>{row.seasonLabel}</td>
                            <td className={tdLeft}>{teamDisplay(row)}</td>
                            <td className={tdLeft}>{row.leagueAbbreviation}</td>
                            <td className={tdRight}>{row.gamesPlayed}</td>
                            <td className={tdRight}>{row.goals}</td>
                            <td className={tdRight}>{row.assists}</td>
                            <td className={tdRight}>{row.points}</td>
                            <td className={tdRight}>{row.penaltyMinutes}</td>
                            <td className={tdRight}>
                                {row.plusMinus > 0 ? `+${row.plusMinus}` : row.plusMinus}
                            </td>
                            <td className={tdRight}>{row.powerPlayPoints}</td>
                            <td className={tdRight}>{row.shots}</td>
                            <td className={tdRight}>{row.gameWinningGoals}</td>
                            <td className={tdRight}>{row.averageTimeOnIce ?? '—'}</td>
                        </tr>
                    ))}
                </tbody>
            </table>
        </TableShell>
    );
}

function GoalieCareerTable({ rows }: { rows: CareerRow[] }) {
    if (rows.length === 0) {
        return (
            <TableShell>
                <div className='p-3 text-sm text-muted-foreground'>
                    Aucune donnée.
                </div>
            </TableShell>
        );
    }

    return (
        <TableShell>
            <table className='w-full min-w-[600px] text-xs tabular-nums'>
                <TableHead>
                    <tr>
                        <th className={thLeft}>Season</th>
                        <th className={thLeft}>Team</th>
                        <th className={thLeft}>Lge</th>
                        <th className={thRight}>GP</th>
                        <th className={thRight}>W</th>
                        <th className={thRight}>L</th>
                        <th className={thRight}>OTL</th>
                        <th className={thRight}>SO</th>
                        <th className={thRight}>SV%</th>
                        <th className={thRight}>GAA</th>
                        <th className={thRight}>SV</th>
                        <th className={thRight}>SA</th>
                    </tr>
                </TableHead>
                <tbody className='text-foreground'>
                    {rows.map((row, index) => (
                        <tr
                            key={`${row.season}-${row.leagueAbbreviation}-${row.teamName}-${index}`}
                            className={rowClass(index)}
                        >
                            <td className={tdLeft}>{row.seasonLabel}</td>
                            <td className={tdLeft}>{teamDisplay(row)}</td>
                            <td className={tdLeft}>{row.leagueAbbreviation}</td>
                            <td className={tdRight}>{row.gamesPlayed}</td>
                            <td className={tdRight}>{row.wins}</td>
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
                        </tr>
                    ))}
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
                                <th className={thRight}>Pts</th>
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
                                        <td className={tdRight}>{game.points}</td>
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

function QuarterTable({
    quarters,
    isGoalie,
}: {
    quarters: Quarter[];
    isGoalie: boolean;
}) {
    const rows = quarters.length === 4 ? quarters : [];

    if (rows.length === 0) {
        return null;
    }

    const cell = (value: number, hasGames: boolean): number | '—' =>
        hasGames ? value : '—';

    return (
        <TableShell>
            <table className='w-full min-w-[480px] text-xs tabular-nums'>
                <TableHead>
                    <tr>
                        <th className={thLeft}>Quart</th>
                        <th className={thLeft}>Dates</th>
                        {isGoalie ? (
                            <>
                                <th className={thRight}>GP</th>
                                <th className={thRight}>W</th>
                                <th className={thRight}>L</th>
                                <th className={thRight}>OTL</th>
                                <th className={thRight}>SO</th>
                                <th className={thRight}>AR</th>
                                <th className={thRight}>FP</th>
                            </>
                        ) : (
                            <>
                                <th className={thRight}>GP</th>
                                <th className={thRight}>B</th>
                                <th className={thRight}>A</th>
                                <th className={thRight}>Pts</th>
                                <th className={thRight}>PIM</th>
                                <th className={thRight}>+/-</th>
                                <th className={thRight}>SOG</th>
                                <th className={thRight}>FP</th>
                            </>
                        )}
                    </tr>
                </TableHead>
                <tbody className='text-foreground'>
                    {rows.map((q, index) => {
                        const hasGames = q.gamesPlayed > 0;

                        const dates =
                            q.startDate && q.endDate
                                ? `${shortGameDate(q.startDate)} – ${shortGameDate(q.endDate)}`
                                : '—';

                        return (
                            <tr key={q.label} className={rowClass(index)}>
                                <td className={tdLeft}>{q.label}</td>
                                <td className={`${tdLeft} text-muted-foreground`}>
                                    {dates}
                                </td>
                                {isGoalie ? (
                                    <>
                                        <td className={tdRight}>
                                            {cell(q.gamesPlayed, hasGames)}
                                        </td>
                                        <td className={tdRight}>
                                            {cell(q.wins, hasGames)}
                                        </td>
                                        <td className={tdRight}>
                                            {cell(q.losses, hasGames)}
                                        </td>
                                        <td className={tdRight}>
                                            {cell(q.overtimeLosses, hasGames)}
                                        </td>
                                        <td className={tdRight}>
                                            {cell(q.shutouts, hasGames)}
                                        </td>
                                        <td className={tdRight}>
                                            {cell(q.saves, hasGames)}
                                        </td>
                                        <td className={tdRight}>
                                            {cell(q.fantasyPoints, hasGames)}
                                        </td>
                                    </>
                                ) : (
                                    <>
                                        <td className={tdRight}>
                                            {cell(q.gamesPlayed, hasGames)}
                                        </td>
                                        <td className={tdRight}>
                                            {cell(q.goals, hasGames)}
                                        </td>
                                        <td className={tdRight}>
                                            {cell(q.assists, hasGames)}
                                        </td>
                                        <td className={tdRight}>
                                            {cell(q.points, hasGames)}
                                        </td>
                                        <td className={tdRight}>
                                            {cell(q.penaltyMinutes, hasGames)}
                                        </td>
                                        <td className={tdRight}>
                                            {hasGames
                                                ? q.plusMinus > 0
                                                    ? `+${q.plusMinus}`
                                                    : q.plusMinus
                                                : '—'}
                                        </td>
                                        <td className={tdRight}>
                                            {cell(q.shots, hasGames)}
                                        </td>
                                        <td className={tdRight}>
                                            {cell(q.fantasyPoints, hasGames)}
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
    const [showYouthMinor, setShowYouthMinor] = useState(false);
    const [showGameLog, setShowGameLog] = useState(false);
    const [showAllRegularSeason, setShowAllRegularSeason] = useState(false);
    const [showAllPlayoffs, setShowAllPlayoffs] = useState(false);
    const [showInjuryDetails, setShowInjuryDetails] = useState(false);

    const regularSeasonRef = useRef<HTMLDivElement>(null);
    const playoffsRef = useRef<HTMLDivElement>(null);
    const regularSeasonInitialized = useRef(false);
    const playoffsInitialized = useRef(false);

    const injuryPanelRef = useRef<HTMLDivElement>(null);
    const injuryScrollOnOpenRef = useRef(false);

    // Close button aura channel.
    const closeAura = useAura('playerPageCloseButton');

    // Player page team logo aura channel. Has its own admin slider,
    // independent of the player-card logo slider.
    const pageTeamLogoAura = useAura('playerPageTeamLogo');

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

    // After expanding/collapsing the Regular Season table, scroll it to
    // the top of the viewport (just below the sticky header). Skips the
    // very first render so it does not fire on page load.
    useEffect(() => {
        if (!regularSeasonInitialized.current) {
            regularSeasonInitialized.current = true;
            return;
        }

        if (!regularSeasonRef.current) return;

        const headerHeight = parseFloat(
            getComputedStyle(document.documentElement)
                .getPropertyValue('--header-height') || '64',
        );

        const top =
            regularSeasonRef.current.getBoundingClientRect().top +
            window.scrollY -
            headerHeight -
            8;

        window.scrollTo({ top, behavior: 'smooth' });
    }, [showAllRegularSeason]);

    // Same for the Playoffs table.
    useEffect(() => {
        if (!playoffsInitialized.current) {
            playoffsInitialized.current = true;
            return;
        }

        if (!playoffsRef.current) return;

        const headerHeight = parseFloat(
            getComputedStyle(document.documentElement)
                .getPropertyValue('--header-height') || '64',
        );

        const top =
            playoffsRef.current.getBoundingClientRect().top +
            window.scrollY -
            headerHeight -
            8;

        window.scrollTo({ top, behavior: 'smooth' });
    }, [showAllPlayoffs]);

    // When the injury panel is expanded, scroll so the bottom of the
    // panel sits at the bottom of the viewport (with a small gap). Only
    // fires on open, never on close. requestAnimationFrame lets the
    // browser lay out the newly rendered rows before we measure.
    useEffect(() => {
        if (!showInjuryDetails) {
            injuryScrollOnOpenRef.current = false;
            return;
        }

        if (!injuryScrollOnOpenRef.current) {
            // Flag was not set, meaning this opening was not triggered
            // by the user's click on the injury button. Skip.
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

    // Close button: go back to wherever the user came from. If there is
    // no history, fall back to /joueurs so we never leave the user stuck.
    function handleClose() {
        if (window.history.length > 1) {
            navigate(-1);
        } else {
            navigate('/joueurs');
        }
    }

    // Aura strings for the Close button, same shape as the other text
    // auras in the app. Uses the primary blue (#00A8FF) so it matches
    // the mobile page title.
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

    // Team logo aura on the player page, in the NHL team's primary
    // color. Three drop-shadow layers, pulsing between a soft rest and
    // a brighter peak. Uses the dedicated playerPageTeamLogo channel.
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

    // The fixed layer: it spans the whole viewport horizontally, and
    // the inner max-w container re-aligns the button with the page
    // content. The top offset is header-height + 0.75rem, so the
    // button's top edge sits fully below the header, not under it.
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

    const currentSeasonStats = player.currentSeasonStats ?? null;
    const lastSeasonStats = player.lastSeasonStats ?? null;

    const seasonTotals = currentSeasonStats
        ? {
            gamesPlayed: currentSeasonStats.gamesPlayed,
            goals: currentSeasonStats.goals,
            assists: currentSeasonStats.assists,
            points: currentSeasonStats.points,
            hatTricks: currentSeasonStats.hatTricks ?? 0,
            totalFantasyPoints: currentSeasonStats.fantasyPoints ?? 0,
        }
        : aggregateGameLog(player.recentGames);

    const lastSeasonTotals = lastSeasonStats
        ? {
            gamesPlayed: lastSeasonStats.gamesPlayed,
            goals: lastSeasonStats.goals,
            assists: lastSeasonStats.assists,
            points: lastSeasonStats.points,
            hatTricks: lastSeasonStats.hatTricks ?? 0,
            totalFantasyPoints: lastSeasonStats.fantasyPoints ?? 0,
        }
        : {
            gamesPlayed: 0,
            goals: 0,
            assists: 0,
            points: 0,
            hatTricks: 0,
            totalFantasyPoints: 0,
        };

    const last10Totals = aggregateGameLog(player.recentGames.slice(0, 10));

    function buildRow(
        label: string,
        totals: typeof seasonTotals,
        computeVor: boolean,
    ) {
        const ppg =
            totals.gamesPlayed > 0
                ? totals.points / totals.gamesPlayed
                : 0;

        const dollarPerPoint =
            totals.totalFantasyPoints > 0 && currentContract
                ? currentContract.salary / totals.totalFantasyPoints
                : null;

        // VOR needs a full-season sample, so only the 25-26 row
        // (which uses last season's final totals) passes computeVor.
        const vorValue = computeVor
            ? totals.totalFantasyPoints - vor
            : null;

        return {
            label,
            gamesPlayed: totals.gamesPlayed,
            goals: totals.goals,
            assists: totals.assists,
            points: totals.points,
            hatTricks: totals.hatTricks,
            pointsPerGame: ppg,
            dollarPerPoint,
            valueOverReplacement: vorValue,
            totalFantasyPoints: totals.totalFantasyPoints,
        };
    }

    const fantasyStatRows = [
        buildRow('26-27', seasonTotals, false),
        buildRow('Last 10', last10Totals, false),
        buildRow('25-26', lastSeasonTotals, true),
    ];

    return (
        <>
            <CloseButtonLayer />

            <section className='mx-auto -mt-3 w-full max-w-5xl space-y-4'>
                {/* Hero banner, using the page margins. */}
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

                {/* Identity + headshot (negative top margin cancels part of the section's space-y-4) */}
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

                        <div className='mt-2 w-full rounded-md border border-border bg-card pb-1'>
                            <table className='w-full table-auto text-[0.7rem] tabular-nums'>
                                <thead className='border-b border-border text-[0.6rem] uppercase tracking-wide text-foreground'>
                                    <tr>
                                        <th className='px-2 py-1 text-left font-medium'>&nbsp;</th>
                                        <th className='px-2 py-1 text-center font-medium'>PJ</th>
                                        <th className='px-2 py-1 text-center font-medium'>B</th>
                                        <th className='px-2 py-1 text-center font-medium'>A</th>
                                        <th className='px-2 py-1 text-center font-bold text-[#D4AF37]'>PTS</th>
                                        <th className='px-2 py-1 text-center font-medium'>3B</th>
                                        <th className='px-2 py-1 text-center font-medium'>PPG</th>
                                        <th className='px-2 py-1 text-center font-bold text-foreground'>VOR</th>
                                        <th className='px-2 py-1 text-center font-bold text-[#D4AF37]'>FP</th>
                                    </tr>
                                </thead>
                                <tbody className='text-foreground'>
                                    {fantasyStatRows.map((row, i) => {
                                        const isLastYear = row.label === '25-26';

                                        return (
                                            <tr
                                                key={row.label}
                                                className={
                                                    isLastYear
                                                        ? 'border-t border-primary/30 bg-primary/10'
                                                        : i % 2 === 0
                                                            ? 'bg-transparent'
                                                            : 'bg-secondary/20'
                                                }
                                            >
                                                <td className='px-2 py-1 text-left font-bold text-foreground'>
                                                    {row.label}
                                                </td>
                                                <td className='px-2 py-1 text-center'>
                                                    {row.gamesPlayed}
                                                </td>
                                                <td className='px-2 py-1 text-center'>
                                                    {row.goals}
                                                </td>
                                                <td className='px-2 py-1 text-center'>
                                                    {row.assists}
                                                </td>
                                                <td className='px-2 py-1 text-center text-[#D4AF37]'>
                                                    {row.points}
                                                </td>
                                                <td className='px-2 py-1 text-center'>
                                                    {row.hatTricks}
                                                </td>
                                                <td className='px-2 py-1 text-center'>
                                                    {row.pointsPerGame.toFixed(2)}
                                                </td>
                                                <td
                                                    className={`px-2 py-1 text-center ${row.label === 'Total' || row.label === 'Last 10'
                                                            ? 'text-foreground'
                                                            : row.valueOverReplacement == null
                                                                ? 'text-[#D4AF37]'
                                                                : row.valueOverReplacement > 0
                                                                    ? 'text-emerald-400'
                                                                    : row.valueOverReplacement < 0
                                                                        ? 'text-rose-400'
                                                                        : 'text-[#D4AF37]'
                                                        }`}
                                                >
                                                    {row.valueOverReplacement == null
                                                        ? '—'
                                                        : `${row.valueOverReplacement > 0 ? '+' : ''}${row.valueOverReplacement}`}
                                                </td>
                                                <td className='px-2 py-1 text-center text-[#D4AF37]'>
                                                    {row.totalFantasyPoints}
                                                </td>
                                            </tr>
                                        );
                                    })}
                                </tbody>
                            </table>
                        </div>
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

                {/* Current injury panel */}
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

                {/* Career */}
                <SectionTitle>Carrière</SectionTitle>

                <div className='grid grid-cols-1 gap-0 md:grid-cols-2 md:gap-x-1'>
                    <div>
                        <div ref={regularSeasonRef}>
                            <SubSectionTitle>Saison régulière</SubSectionTitle>
                            {isGoalie ? (
                                <GoalieCareerTable
                                    rows={careerRowsForDisplay(
                                        player.regularSeason,
                                        showAllRegularSeason,
                                        true,
                                    )}
                                />
                            ) : (
                                <SkaterCareerTable
                                    rows={careerRowsForDisplay(
                                        player.regularSeason,
                                        showAllRegularSeason,
                                        true,
                                    )}
                                />
                            )}
                        </div>

                        <div className='mt-1 flex justify-center'>
                            <button
                                type='button'
                                onClick={() => setShowAllRegularSeason((v) => !v)}
                                className='cursor-pointer rounded border border-border px-2 py-0.5 text-xs text-foreground transition-colors hover:bg-secondary [text-shadow:0_0_8px_rgba(0,168,255,1)]'
                            >
                                {showAllRegularSeason
                                    ? '▲ Afficher moins'
                                    : '▼ Afficher plus'}
                            </button>
                        </div>
                    </div>

                    <div>
                        <div ref={playoffsRef}>
                            <SubSectionTitle>Séries</SubSectionTitle>
                            {isGoalie ? (
                                <GoalieCareerTable
                                    rows={careerRowsForDisplay(
                                        player.playoffs,
                                        showAllPlayoffs,
                                        false,
                                    )}
                                />
                            ) : (
                                <SkaterCareerTable
                                    rows={careerRowsForDisplay(
                                        player.playoffs,
                                        showAllPlayoffs,
                                        false,
                                    )}
                                />
                            )}
                        </div>

                        <div className='mt-1 flex justify-center'>
                            <button
                                type='button'
                                onClick={() => setShowAllPlayoffs((v) => !v)}
                                className='cursor-pointer rounded border border-border px-2 py-0.5 text-xs text-foreground transition-colors hover:bg-secondary [text-shadow:0_0_8px_rgba(0,168,255,1)]'
                            >
                                {showAllPlayoffs
                                    ? '▲ Afficher moins'
                                    : '▼ Afficher plus'}
                            </button>
                        </div>
                    </div>
                </div>

                {hasNhlTotals && (
                    <div className='mt-2'>
                        <SubSectionTitle>NHL Totals</SubSectionTitle>

                        {isGoalie ? (
                            <TableShell>
                                <table className='w-full min-w-[640px] text-xs tabular-nums'>
                                    <TableHead>
                                        <tr>
                                            <th className={thLeft}>&nbsp;</th>
                                            <th className={thRight}>GP</th>
                                            <th className={thRight}>W</th>
                                            <th className={thRight}>L</th>
                                            <th className={thRight}>OTL</th>
                                            <th className={thRight}>SO</th>
                                            <th className={thRight}>SV%</th>
                                            <th className={thRight}>SV</th>
                                            <th className={thRight}>SA</th>
                                            <th className={thRight}>GA</th>
                                        </tr>
                                    </TableHead>
                                    <tbody className='text-foreground'>
                                        <tr className={rowClass(0)}>
                                            <td className={`${tdLeft} font-semibold`}>
                                                Regular Season
                                            </td>
                                            <td className={`${tdRight} font-semibold`}>
                                                {player.nhlTotals.gamesPlayed}
                                            </td>
                                            <td className={`${tdRight} font-semibold`}>
                                                {player.nhlTotals.wins}
                                            </td>
                                            <td className={`${tdRight} font-semibold`}>
                                                {player.nhlTotals.losses}
                                            </td>
                                            <td className={`${tdRight} font-semibold`}>
                                                {player.nhlTotals.overtimeLosses}
                                            </td>
                                            <td className={`${tdRight} font-semibold`}>
                                                {player.nhlTotals.shutouts}
                                            </td>
                                            <td className={`${tdRight} font-semibold`}>
                                                {player.nhlTotals.shotsAgainst > 0
                                                    ? formatDecimal(
                                                        player.nhlTotals.savePercentage,
                                                        3,
                                                    )
                                                    : '—'}
                                            </td>
                                            <td className={`${tdRight} font-semibold`}>
                                                {player.nhlTotals.saves}
                                            </td>
                                            <td className={`${tdRight} font-semibold`}>
                                                {player.nhlTotals.shotsAgainst}
                                            </td>
                                            <td className={`${tdRight} font-semibold`}>
                                                {player.nhlTotals.goalsAgainst}
                                            </td>
                                        </tr>
                                        <tr className={rowClass(1)}>
                                            <td className={`${tdLeft} font-semibold`}>
                                                Playoffs
                                            </td>
                                            <td className={`${tdRight} font-semibold`}>
                                                {player.nhlTotals.playoffGamesPlayed}
                                            </td>
                                            <td className={`${tdRight} font-semibold`}>
                                                {player.nhlTotals.playoffWins}
                                            </td>
                                            <td className={`${tdRight} font-semibold`}>
                                                {player.nhlTotals.playoffLosses}
                                            </td>
                                            <td className={`${tdRight} font-semibold`}>
                                                {player.nhlTotals.playoffOvertimeLosses}
                                            </td>
                                            <td className={`${tdRight} font-semibold`}>
                                                {player.nhlTotals.playoffShutouts}
                                            </td>
                                            <td className={`${tdRight} font-semibold`}>
                                                —
                                            </td>
                                            <td className={`${tdRight} font-semibold`}>
                                                —
                                            </td>
                                            <td className={`${tdRight} font-semibold`}>
                                                —
                                            </td>
                                            <td className={`${tdRight} font-semibold`}>
                                                —
                                            </td>
                                        </tr>
                                    </tbody>
                                </table>
                            </TableShell>
                        ) : (
                            <TableShell>
                                <table className='w-full min-w-[640px] text-xs tabular-nums'>
                                    <TableHead>
                                        <tr>
                                            <th className={thLeft}>&nbsp;</th>
                                            <th className={thRight}>GP</th>
                                            <th className={thRight}>G</th>
                                            <th className={thRight}>A</th>
                                            <th className={thRight}>Pts</th>
                                            <th className={thRight}>PIM</th>
                                            <th className={thRight}>+/-</th>
                                            <th className={thRight}>PPP</th>
                                            <th className={thRight}>SOG</th>
                                            <th className={thRight}>GWG</th>
                                        </tr>
                                    </TableHead>
                                    <tbody className='text-foreground'>
                                        <tr className={rowClass(0)}>
                                            <td className={`${tdLeft} font-semibold`}>
                                                Regular Season
                                            </td>
                                            <td className={`${tdRight} font-semibold`}>
                                                {player.nhlTotals.gamesPlayed}
                                            </td>
                                            <td className={`${tdRight} font-semibold`}>
                                                {player.nhlTotals.goals}
                                            </td>
                                            <td className={`${tdRight} font-semibold`}>
                                                {player.nhlTotals.assists}
                                            </td>
                                            <td className={`${tdRight} font-semibold`}>
                                                {player.nhlTotals.points}
                                            </td>
                                            <td className={`${tdRight} font-semibold`}>
                                                {player.nhlTotals.penaltyMinutes}
                                            </td>
                                            <td className={`${tdRight} font-semibold`}>
                                                {player.nhlTotals.plusMinus > 0
                                                    ? `+${player.nhlTotals.plusMinus}`
                                                    : player.nhlTotals.plusMinus}
                                            </td>
                                            <td className={`${tdRight} font-semibold`}>
                                                {player.nhlTotals.powerPlayPoints}
                                            </td>
                                            <td className={`${tdRight} font-semibold`}>
                                                {player.nhlTotals.shots}
                                            </td>
                                            <td className={`${tdRight} font-semibold`}>
                                                {player.nhlTotals.gameWinningGoals}
                                            </td>
                                        </tr>
                                        <tr className={rowClass(1)}>
                                            <td className={`${tdLeft} font-semibold`}>
                                                Playoffs
                                            </td>
                                            <td className={`${tdRight} font-semibold`}>
                                                {player.nhlTotals.playoffGamesPlayed}
                                            </td>
                                            <td className={`${tdRight} font-semibold`}>
                                                {player.nhlTotals.playoffGoals}
                                            </td>
                                            <td className={`${tdRight} font-semibold`}>
                                                {player.nhlTotals.playoffAssists}
                                            </td>
                                            <td className={`${tdRight} font-semibold`}>
                                                {player.nhlTotals.playoffPoints}
                                            </td>
                                            <td className={`${tdRight} font-semibold`}>
                                                {player.nhlTotals.playoffPenaltyMinutes}
                                            </td>
                                            <td className={`${tdRight} font-semibold`}>
                                                —
                                            </td>
                                            <td className={`${tdRight} font-semibold`}>
                                                {player.nhlTotals.playoffPowerPlayPoints}
                                            </td>
                                            <td className={`${tdRight} font-semibold`}>
                                                {player.nhlTotals.playoffShots}
                                            </td>
                                            <td className={`${tdRight} font-semibold`}>
                                                {player.nhlTotals.playoffGameWinningGoals}
                                            </td>
                                        </tr>
                                    </tbody>
                                </table>
                            </TableShell>
                        )}
                    </div>
                )}

                {/* Quarters */}
                {player.seasonQuarters.length === 4 && (
                    <>
                        <SectionTitle>
                            Par quart (saison courante)
                        </SectionTitle>
                        <QuarterTable
                            quarters={player.seasonQuarters}
                            isGoalie={isGoalie}
                        />
                    </>
                )}

                {/* Fiches de match */}
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

                {/* Tournaments */}
                <SectionTitle>Tournois</SectionTitle>
                {isGoalie ? (
                    <GoalieCareerTable rows={player.tournaments} />
                ) : (
                    <SkaterCareerTable rows={player.tournaments} />
                )}

                {/* Youth / minor (collapsed) */}
                <div className='mt-6'>
                    <button
                        type='button'
                        onClick={() => setShowYouthMinor((v) => !v)}
                        className='cursor-pointer text-sm font-semibold text-primary hover:underline'
                    >
                        {showYouthMinor ? '▼' : '▶'} Youth / Minor (
                        {player.youthMinor.length})
                    </button>

                    {showYouthMinor && (
                        <div className='mt-2'>
                            {isGoalie ? (
                                <GoalieCareerTable rows={player.youthMinor} />
                            ) : (
                                <SkaterCareerTable rows={player.youthMinor} />
                            )}
                        </div>
                    )}
                </div>

                {/* Injury history */}
                <SectionTitle>Historique des blessures</SectionTitle>

                {player.injuryHistory.filter((s) => s.resolvedAt === null).length === 0 ? (
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
                                {player.injuryHistory
                                    .filter((s) => s.resolvedAt === null)
                                    .map((spell, index) => (
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
            </section>
        </>
    );
}