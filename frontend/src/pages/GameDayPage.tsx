import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import {
    getGameBoxscore,
    getGamesByDate,
    getPlayerOwnership,
    getTodayGames,
    type GameDayGameSummary,
    type GameDayScheduleResponse,
    type NhlBoxscoreResponse,
    type NhlGoalieStats,
    type NhlSkaterStats,
    type NhlTeamPlayerStats,
    type PlayerOwnership,
} from '@/api/client';
import {
    clearGameDaySnapshot,
    peekGameDaySnapshot,
    saveGameDaySnapshot,
} from '@/lib/gameDayRestoration';
import { NhlTeamLogo } from '@/components/nhl/NhlTeamLogo';
import {
    getNhlTeamColor,
    getNhlTeamTextColor,
} from '@/lib/nhlTeamColors';
import { useAura } from '@/lib/auraContext';
import {
    auraPulseClass,
    auraPulseStyle,
    auraRangeFor,
    isAuraOff,
} from '@/lib/auraConfig';
import { cn } from '@/lib/utils';
import { useAuth } from '@/lib/AuthContext';

// ---------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------

const POLL_LIVE_MS = 2 * 60_000;
const POLL_IDLE_MS = 10 * 60_000;

/**
 * Minimum horizontal distance, in CSS pixels, for a touch drag to
 * count as a swipe on a game card. Below this, the drag is ignored
 * and the normal click-on-tap behavior applies.
 */
const GAMECARD_SWIPE_MIN_PX = 60;

/**
 * Safety timeout for the "next click is suppressed" flag.
 *
 * After a swipe, exactly ONE click is suppressed — the synthetic
 * click the browser fires at the end of the touch sequence. The
 * flag is normally cleared by that click itself. If the browser
 * decides not to fire one (e.g. it interpreted the gesture as a
 * scroll and cancelled the click), this timeout is what clears
 * the flag so the next real tap is not eaten.
 */
const GAMECARD_SWIPE_CLICK_SUPPRESS_MS = 300;

/**
 * Mount-time fetch retry schedule.
 *
 * The first attempt runs immediately. Each subsequent attempt waits
 * for the current delay, then doubles it, up to MOUNT_RETRY_MAX_MS.
 * This keeps a persistent backend outage from turning into a 3-second
 * hammer without capping the total wait so long that a transient
 * hiccup keeps the page on "Chargement..." for minutes.
 */
const MOUNT_RETRY_BASE_MS = 1_000;
const MOUNT_RETRY_MAX_MS = 30_000;

const TIME_FORMATTER = new Intl.DateTimeFormat('fr-CA', {
    hour: 'numeric',
    minute: '2-digit',
    timeZone: 'America/Toronto',
});

// Shared frame style, matching the Classement page.
const FRAME_BG = '#080D1A';
const FRAME_BORDER = '#090212';
const FRAME_GLOW =
    '0 2px 8px rgba(0, 0, 0, 0.45), 0 0 18px rgba(0, 168, 255, 0.20), inset 0 0 16px rgba(0, 168, 255, 0.06)';

// Base dark color for every panel. Kept as a single constant so the
// whole card stays visually coherent.
const PANEL_BG = '#050B18';

// ---------------------------------------------------------------------
// Game-card-only fill color overrides
//
// The two panels on a game card use NHL_TEAM_COLORS as their fill.
// When a team is listed here, its panel uses this color instead.
//
// The rest of the app (PlayerCard backgrounds on Mon équipe, roster
// row tints, admin previews) continues to read NHL_TEAM_COLORS, so
// overrides here are GameDay-only.
//
// UTA is listed because its NHL_TEAM_COLORS entry is almost black
// (#010101), which produces a panel indistinguishable from the dark
// card background. #69B3E7 is Utah's official light blue and reads
// as a clear, distinct panel against PANEL_BG.
// ---------------------------------------------------------------------

const GAMECARD_FILL_OVERRIDES: Record<string, string> = {
    UTA: '#69B3E7',
};

// ---------------------------------------------------------------------
// Date helpers
// ---------------------------------------------------------------------

/** Formats a Date as a local ISO date (yyyy-MM-dd). */
function toIsoDate(d: Date): string {
    const yyyy = d.getFullYear();
    const mm = String(d.getMonth() + 1).padStart(2, '0');
    const dd = String(d.getDate()).padStart(2, '0');
    return `${yyyy}-${mm}-${dd}`;
}

const LONG_DATE_FORMATTER = new Intl.DateTimeFormat('fr-CA', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
});

const SHORT_DATE_FORMATTER = new Intl.DateTimeFormat('fr-CA', {
    day: 'numeric',
    month: 'short',
});

// ---------------------------------------------------------------------
// Game state helpers
// ---------------------------------------------------------------------

function isLive(game: GameDayGameSummary): boolean {
    return game.gameState === 'LIVE' || game.gameState === 'CRIT';
}

function isScheduled(game: GameDayGameSummary): boolean {
    return game.gameState === 'FUT' || game.gameState === 'PRE';
}

function isFinished(game: GameDayGameSummary): boolean {
    return game.gameState === 'FINAL' || game.gameState === 'OFF';
}

function startTimeLabel(iso: string): string {
    try {
        return TIME_FORMATTER.format(new Date(iso));
    } catch {
        return '';
    }
}

function sortGamesByStartTime(
    games: GameDayGameSummary[],
): GameDayGameSummary[] {
    return [...games].sort((a, b) => {
        const ta = new Date(a.startTimeUtc).getTime();
        const tb = new Date(b.startTimeUtc).getTime();

        if (ta !== tb) return ta - tb;

        return a.gameId - b.gameId;
    });
}

function sortSkatersByProduction(
    skaters: NhlSkaterStats[],
): NhlSkaterStats[] {
    return [...skaters].sort((a, b) => {
        if (b.points !== a.points) return b.points - a.points;
        if (b.goals !== a.goals) return b.goals - a.goals;
        if (b.assists !== a.assists) return b.assists - a.assists;

        return a.name.default.localeCompare(b.name.default);
    });
}

/**
 * Collects every distinct NHL player id appearing in a boxscore
 * (skaters and goalies, both teams). Used to fetch the fantasy
 * team ownership for the whole boxscore in one request.
 */
function collectBoxscorePlayerIds(
    box: NhlBoxscoreResponse,
): number[] {
    const ids = new Set<number>();

    const away = box.playerByGameStats.awayTeam;
    const home = box.playerByGameStats.homeTeam;

    for (const s of [
        ...away.forwards,
        ...away.defense,
        ...home.forwards,
        ...home.defense,
    ]) {
        ids.add(s.playerId);
    }

    for (const g of [...away.goalies, ...home.goalies]) {
        ids.add(g.playerId);
    }

    return Array.from(ids);
}

function goalieDecisionLabel(decision: string | null): string {
    if (!decision) return '';
    if (decision === 'W') return 'W';
    if (decision === 'L') return 'L';
    if (decision === 'O') return 'OTL';
    return decision;
}

/**
 * Short French label for a period: "1re", "2e", "3e", "Prol." (OT),
 * "TAB" (shootout). Falls back to "Ne" for anything unexpected.
 * Mirrors the helper used by ClassementPage so the two pages agree.
 */
function formatPeriodLabel(
    number: number,
    type: string | null,
): string {
    if (type === 'OT') return 'Prol.';
    if (type === 'SO') return 'TAB';
    if (number === 1) return '1re';
    if (number === 2) return '2e';
    if (number === 3) return '3e';
    return `${number}e`;
}

// ---------------------------------------------------------------------
// Boxscore subcomponents
// ---------------------------------------------------------------------

function SkaterRow({
    skater,
    ownership,
}: {
    skater: NhlSkaterStats;
    ownership: PlayerOwnership | null;
}) {
    const hasPoints = skater.points > 0;
    const name = skater.name.default;

    const { user } = useAuth();
    const myTeamId = user?.fantasyTeamId ?? null;

    const isMine =
        ownership != null &&
        myTeamId != null &&
        ownership.fantasyTeamId === myTeamId;

    const isOtherOwned = ownership != null && !isMine;

    return (
        <Link
            to={`/joueurs/${skater.playerId}`}
            onClick={(event) => event.stopPropagation()}
            className={cn(
                'flex items-center justify-between gap-2 rounded px-1 py-0.5 text-xs transition-colors',
                isMine && 'bg-white/15 hover:bg-white/25',
                isOtherOwned && 'bg-[#00A8FF]/10 hover:bg-[#00A8FF]/15',
                !ownership && 'hover:bg-[#00A8FF]/10',
            )}
        >
            <div className='flex min-w-0 flex-1 items-center gap-1.5'>
                <span className='truncate text-foreground'>
                    {name}
                </span>
                {ownership && (
                    <span className='max-w-[6rem] shrink-0 truncate rounded border border-[#00A8FF]/40 bg-[#00A8FF]/10 px-1 text-[0.55rem] font-semibold uppercase tracking-wider text-[#7DD3FC]'>
                        {ownership.fantasyTeamName}
                    </span>
                )}
            </div>

            <div className='flex shrink-0 gap-1.5 tabular-nums'>
                <span
                    className={cn(
                        'w-6 text-center',
                        skater.goals > 0
                            ? 'text-white'
                            : 'text-muted-foreground',
                    )}
                >
                    {skater.goals}
                </span>
                <span
                    className={cn(
                        'w-6 text-center',
                        skater.assists > 0
                            ? 'text-white'
                            : 'text-muted-foreground',
                    )}
                >
                    {skater.assists}
                </span>
                <span
                    className={cn(
                        'w-8 text-center font-bold',
                        hasPoints ? 'text-[#00F0FF]' : 'text-muted-foreground',
                    )}
                >
                    {skater.points}
                </span>
                <span className='w-8 text-center text-white'>
                    {skater.shots}
                </span>
                <span className='w-11 text-center text-white'>
                    {skater.toi ?? '—'}
                </span>
            </div>
        </Link>
    );
}

function GoalieRow({
    goalie,
    ownership,
}: {
    goalie: NhlGoalieStats;
    ownership: PlayerOwnership | null;
}) {
    const decision = goalieDecisionLabel(goalie.decision);
    const name = goalie.name.default;

    const { user } = useAuth();
    const myTeamId = user?.fantasyTeamId ?? null;

    const isMine =
        ownership != null &&
        myTeamId != null &&
        ownership.fantasyTeamId === myTeamId;

    const isOtherOwned = ownership != null && !isMine;

    // A loss shows in red so it stands out from the wins and OT
    // losses at a glance. Wins and OT losses stay green.
    const decisionColor =
        decision === 'L' ? '#EF4444' : '#22C55E';

    return (
        <Link
            to={`/joueurs/${goalie.playerId}`}
            onClick={(event) => event.stopPropagation()}
            className={cn(
                'flex items-center justify-between gap-2 rounded px-1 py-0.5 text-xs transition-colors',
                isMine && 'bg-white/15 hover:bg-white/25',
                isOtherOwned && 'bg-[#00A8FF]/10 hover:bg-[#00A8FF]/15',
                !ownership && 'hover:bg-[#00A8FF]/10',
            )}
        >
            <div className='flex min-w-0 flex-1 items-center gap-1.5'>
                <span className='truncate text-foreground'>
                    {name}
                </span>
                {ownership && (
                    <span className='max-w-[6rem] shrink-0 truncate rounded border border-[#00A8FF]/40 bg-[#00A8FF]/10 px-1 text-[0.55rem] font-semibold uppercase tracking-wider text-[#7DD3FC]'>
                        {ownership.fantasyTeamName}
                    </span>
                )}
            </div>

            <div className='flex shrink-0 gap-2 tabular-nums'>
                <span
                    className='w-6 text-center font-bold'
                    style={{ color: decisionColor }}
                >
                    {decision || '—'}
                </span>
                <span className='w-14 text-center text-white'>
                    {goalie.saves}/{goalie.shotsAgainst}
                </span>
            </div>
        </Link>
    );
}

function TeamBoxscore({
    team,
    abbreviation,
    label,
    ownershipByPlayerId,
}: {
    team: NhlTeamPlayerStats;
    abbreviation: string;
    label: string;
    ownershipByPlayerId: Map<number, PlayerOwnership>;
}) {
    const skaters = sortSkatersByProduction([
        ...team.forwards,
        ...team.defense,
    ]);

    const goalies = team.goalies.filter(
        (g) =>
            g.decision != null ||
            g.shotsAgainst > 0 ||
            g.saves > 0 ||
            g.goalsAgainst > 0,
    );

    return (
        <div className='space-y-2'>
            <div className='flex items-center gap-2 border-b border-[#00A8FF]/20 pb-1.5'>
                <div className='relative flex h-7 w-7 shrink-0 items-center justify-center'>
                    <div className='absolute inset-0 flex items-center justify-center scale-[1.2]'>
                        <NhlTeamLogo abbreviation={abbreviation} size={38} />
                    </div>
                </div>
                <span className='text-base font-semibold text-foreground'>
                    {abbreviation}
                </span>
                <span className='text-xs uppercase tracking-wider text-[#7DD3FC]'>
                    {label}
                </span>
            </div>

            {/* Goalie section first. The single starting goalie is
                the most important line in the boxscore, so it sits
                at the top of the team block. */}
            {goalies.length > 0 && (
                <div>
                    <div className='mb-1 flex items-center justify-between gap-2 px-1 text-[0.6rem] uppercase tracking-wider text-[#7DD3FC]'>
                        <span className='flex-1'>Gardien</span>
                        <div className='flex shrink-0 gap-2'>
                            <span className='w-6 text-center'>Déc.</span>
                            <span className='w-14 text-center'>Arrêts</span>
                        </div>
                    </div>
                    {goalies.map((g) => (
                        <GoalieRow
                            key={g.playerId}
                            goalie={g}
                            ownership={
                                ownershipByPlayerId.get(g.playerId) ?? null
                            }
                        />
                    ))}
                </div>
            )}

            {/* Skaters below the goalie. */}
            {skaters.length > 0 && (
                <div>
                    <div className='mb-1 flex items-center justify-between gap-2 px-1 text-[0.6rem] uppercase tracking-wider text-[#7DD3FC]'>
                        <span className='flex-1'>Joueur</span>
                        <div className='flex shrink-0 gap-1.5'>
                            <span className='w-6 text-center'>B</span>
                            <span className='w-6 text-center'>A</span>
                            <span className='w-8 text-center'>PTS</span>
                            <span className='w-8 text-center'>SOG</span>
                            <span className='w-11 text-center text-white'>TOI</span>
                        </div>
                    </div>
                    {skaters.map((s) => (
                        <SkaterRow
                            key={s.playerId}
                            skater={s}
                            ownership={
                                ownershipByPlayerId.get(s.playerId) ?? null
                            }
                        />
                    ))}
                </div>
            )}
        </div>
    );
}

function BoxscorePanel({
    boxscore,
    loading,
    ownershipByPlayerId,
    side,
}: {
    boxscore: NhlBoxscoreResponse | null;
    loading: boolean;
    ownershipByPlayerId: Map<number, PlayerOwnership>;
    side: 'away' | 'home';
}) {
    // The card-level team gradient would otherwise bleed into the
    // expanded boxscore. Pin a solid dark base on both the loading
    // state and the loaded state so the boxscore stays flat.
    const boxscoreStyle: React.CSSProperties = {
        borderColor: 'rgba(0, 168, 255, 0.2)',
        backgroundColor: PANEL_BG,
    };

    if (loading) {
        return (
            <div
                className='border-t px-3 py-4 text-center text-xs text-muted-foreground'
                style={boxscoreStyle}
                onClick={(event) => event.stopPropagation()}
            >
                Chargement du sommaire...
            </div>
        );
    }

    if (!boxscore) return null;

    // Only render the team the user picked. The two sides of the
    // game card are now click-to-pick: left side shows the away
    // team's boxscore, right side shows the home team's boxscore.
    const isAway = side === 'away';

    const team = isAway
        ? boxscore.playerByGameStats.awayTeam
        : boxscore.playerByGameStats.homeTeam;

    const abbreviation = isAway
        ? boxscore.awayTeam.abbrev
        : boxscore.homeTeam.abbrev;

    const label = isAway ? 'Visiteurs' : 'Locaux';

    return (
        <div
            // No max-height, no internal scroll. The panel takes its
            // natural height so the whole boxscore is visible without
            // a nested scrollbar. Since only one team's boxscore is
            // shown at a time (the away OR the home side), the total
            // content fits comfortably on any screen.
            className='space-y-4 border-t px-3 py-2'
            style={boxscoreStyle}
            onClick={(event) => event.stopPropagation()}
        >
            <TeamBoxscore
                team={team}
                abbreviation={abbreviation}
                label={label}
                ownershipByPlayerId={ownershipByPlayerId}
            />
        </div>
    );
}

// ---------------------------------------------------------------------
// Team row inside a game card
// ---------------------------------------------------------------------

/**
 * One side of the game card (away on the left, home on the right).
 *
 * Two colors, deliberately separated:
 *
 *   - `fillColor` — the base team color from NHL_TEAM_COLORS, used
 *     for the solid background that fills the entire side panel.
 *     This is the "true" team color, so a Colorado side reads as
 *     real Avalanche burgundy and a Seattle side reads as the
 *     Kraken's deep navy.
 *
 *   - `stripColor` — the aura override from NHL_TEAM_AURA_COLORS
 *     when one exists (falls back to the base color otherwise),
 *     used exclusively for the neon accent strip on the outer edge.
 *     This is where a bright variant actually matters: a thin strip
 *     of a dark color (LAK #111111, UTA #010101, SEA #001628) would
 *     disappear against the dark panel, so the aura palette is the
 *     right choice here.
 *
 * `dimmed` is used by the parent when the OTHER side of the same
 * card is the currently-viewed one. When true, both the fill and
 * the strip are replaced with a neutral grey so the user can see
 * at a glance which side of the expanded card they are looking at.
 *
 * The glass overlay, the diagonal streaks, and the linear
 * team-color gradient that used to fade toward the center have all
 * been removed. The fill is flat and reaches the inner edge of the
 * panel; the strip is a contained-filament two-layer build with a
 * thick accent "tube" and a thin near-white "filament" inset inside
 * it, and nothing extends outside the strip's own box.
 */
function TeamSide({
    abbreviation,
    placeName,
    commonName,
    record,
    fillColor,
    secondaryColor,
    dimmed = false,
    active = false,
    onLogoClick,
    nhlTeamId,
    onTeamPageClick,
}: {
    abbreviation: string;
    placeName: string;
    commonName: string;
    record: string | null;
    fillColor: string;
    secondaryColor: string;
    dimmed?: boolean;
    active?: boolean;
    onLogoClick?: () => void;
    nhlTeamId: number;
    onTeamPageClick: (nhlTeamId: number) => void;
}) {
    // Black palette used when this side is the "inactive" side of an
    // expanded game card.
    const DIMMED_FILL = '#000000';

    const effectiveFill = dimmed ? DIMMED_FILL : fillColor;

    // Solid fill with approximately 60% opacity.
    const solidTeamColor = `${effectiveFill}99`;

    // Subtle vertical shade.
    const verticalShade =
        'linear-gradient(180deg, ' +
        'rgba(0, 0, 0, 0.18) 0%, ' +
        'rgba(0, 0, 0, 0) 45%, ' +
        'rgba(0, 0, 0, 0.22) 100%)';

    // Slight saturation boost for the active team.
    const saturationFilter =
        active && !dimmed ? 'saturate(1.15)' : undefined;

    // ================================================================
    // PAGE D'ÉQUIPE BUTTON — DESIGN #1
    // Double border + visible inner glow
    // ================================================================

    // Keep the team's color in the button while darkening the surface
    // enough for the border and text to stand out.
    const buttonBg = dimmed
        ? 'rgba(17, 17, 17, 0.96)'
        : `${secondaryColor}A6`;

    const buttonText = dimmed
        ? '#AAAAAA'
        : fillColor;

    // Outer border uses the team's secondary color.
    const buttonBorder = dimmed
        ? '#666666'
        : secondaryColor;

    // A separate, light inset line makes the double-border effect
    // visible even when the team color is similar to the background.
    const buttonShadow = dimmed
        ? [
            'inset 0 0 0 1px rgba(255, 255, 255, 0.14)',
            'inset 0 0 7px rgba(255, 255, 255, 0.04)',
        ].join(', ')
        : [
            // Inner light-colored line: the second border.
            'inset 0 0 0 1px rgba(255, 255, 255, 0.72)',

            // Colored light inside the button.
            `inset 0 0 7px ${secondaryColor}`,

            // Darken the center slightly so the text stays readable.
            'inset 0 0 3px 1px rgba(0, 0, 0, 0.55)',

            // Restrained colored glow around the outside.
            `0 0 5px ${secondaryColor}`,
        ].join(', ');

    return (
        <div
            className='relative flex min-w-0 flex-col items-center justify-center overflow-hidden pt-2 pb-8 text-center transition-[filter] duration-200'
            style={{
                backgroundColor: PANEL_BG,
                backgroundImage: [
                    verticalShade,
                    `linear-gradient(${solidTeamColor}, ${solidTeamColor})`,
                ].join(', '),
                filter: saturationFilter,
            }}
        >
            {/* Team logo and information */}
            <div
                className='relative flex flex-col items-center px-3'
                style={{ zIndex: 3 }}
            >
                <div
                    onClick={
                        onLogoClick
                            ? (event) => {
                                event.stopPropagation();
                                onLogoClick();
                            }
                            : undefined
                    }
                    className={cn(
                        'relative scale-[1.35]',
                        onLogoClick &&
                        'cursor-pointer hover:scale-[1.45] active:scale-[1.25]'
                    )}
                    style={{
                        filter: dimmed ? 'saturate(0.2)' : undefined,
                        zIndex: 10,
                    }}
                >
                    <NhlTeamLogo
                        abbreviation={abbreviation}
                        size={48}
                    />
                </div>

                <div
                    className='truncate text-[0.62rem] uppercase tracking-[0.22em] text-white/80'
                    style={{
                        textShadow: '0 1px 2px rgba(0, 0, 0, 0.55)',
                    }}
                >
                    {placeName}
                </div>

                <div
                    className='truncate text-[0.8rem] font-bold uppercase leading-tight tracking-wide text-white'
                    style={{
                        textShadow: '0 1px 3px rgba(0, 0, 0, 0.6)',
                    }}
                >
                    {commonName}
                </div>

                {record && (
                    <div className='mt-1 text-[0.75rem] font-semibold tabular-nums text-white/90'>
                        {record}
                    </div>
                )}
            </div>

            {/* Page d'équipe — double border + inner glow */}
            <button
                type='button'
                onClick={(e) => {
                    e.stopPropagation();
                    onTeamPageClick(nhlTeamId);
                }}
                className={cn(
                    'absolute bottom-0 left-0 right-0 w-full',
                    'box-border py-1.5',
                    'text-[0.6rem] font-bold uppercase tracking-wider',
                    'transition-[background-color,box-shadow,filter,transform] duration-200',
                    !dimmed &&
                    'hover:brightness-125 active:scale-[0.98]'
                )}
                style={{
                    backgroundColor: buttonBg,
                    color: buttonText,

                    // First border: colored outer frame.
                    border: `1px solid ${buttonBorder}`,

                    // Second border and both glow layers.
                    boxShadow: buttonShadow,

                    // Keep the existing glass effect.
                    backdropFilter: 'blur(8px)',
                    WebkitBackdropFilter: 'blur(8px)',

                    // Ensure the button and its borders remain visible.
                    position: 'absolute',
                    zIndex: 5,
                }}
            >
                Page d'équipe
            </button>
        </div>
    );
}

// ---------------------------------------------------------------------
// Game card
// ---------------------------------------------------------------------

function GameCard({
    game,
    expanded,
    expandedSide,
    boxscore,
    boxscoreLoading,
    ownershipByPlayerId,
    onToggle,
    onTeamLogoClick,
}: {
    game: GameDayGameSummary;
    expanded: boolean;
    expandedSide: 'away' | 'home' | null;
    boxscore: NhlBoxscoreResponse | null;
    boxscoreLoading: boolean;
    ownershipByPlayerId: Map<number, PlayerOwnership>;
    onToggle: (gameId: number, side: 'away' | 'home') => void;
    onTeamLogoClick: (nhlTeamId: number) => void;
}) {
    const live = isLive(game);
    const scheduled = isScheduled(game);
    const clickable = game.hasBoxscore;

    // Two colors per side, used for two different purposes:
    //
    //   - fillColor  — the true team color from NHL_TEAM_COLORS,
    //                  used as the flat background of the side panel.
    //                  A Colorado side reads as real Avalanche
    //                  burgundy, a Seattle side as the Kraken's deep
    //                  navy, etc.
    //
    //   - stripColor — the aura override from NHL_TEAM_AURA_COLORS
    //                  when one exists (falls back to the base color
    //                  otherwise), used only for the thin neon strip
    //                  on the outer edge. Several NHL primaries are
    //                  nearly black (LAK #111111, UTA #010101,
    //                  SEA #001628) and would disappear as a strip
    //                  against the dark panel; the aura palette is
    //                  exactly what keeps the strip visible.
    //
    // The divider lines under the center column also use stripColor
    // so they stay visible for dark teams.
    //
    // Fill colors check the GameDay-specific override first, then
    // fall back to NHL_TEAM_COLORS. Strip colors are untouched by
    // the override and always come from NHL_TEAM_AURA_COLORS.
    const awayFillColor =
        GAMECARD_FILL_OVERRIDES[game.awayAbbreviation.toUpperCase()] ??
        getNhlTeamColor(game.awayAbbreviation);

    const homeFillColor =
        GAMECARD_FILL_OVERRIDES[game.homeAbbreviation.toUpperCase()] ??
        getNhlTeamColor(game.homeAbbreviation);

    // Secondary colors (used for the "Page d'équipe" button background)
    const awaySecondaryColor = getNhlTeamTextColor(game.awayAbbreviation);
    const homeSecondaryColor = getNhlTeamTextColor(game.homeAbbreviation);

    // When this card is expanded, whichever side is NOT currently
    // being viewed is greyed out. This tells the user at a glance
    // which side's boxscore is on screen. When the card is
    // collapsed, neither side is dimmed.
    const awayDimmed = expanded && expandedSide === 'home';
    const homeDimmed = expanded && expandedSide === 'away';

    // Click handlers for the team logos. Only set on unstarted
    // games: on a clickable card the logo click still belongs to
    // the card, so the user expands the side they tapped instead
    // of navigating away. The > 0 guards protect against a lookup
    // miss where the abbreviation could not be mapped to an NHL
    // team id.
    const handleAwayLogoClick =
        scheduled && game.awayNhlTeamId > 0
            ? () => onTeamLogoClick(game.awayNhlTeamId)
            : undefined;

    const handleHomeLogoClick =
        scheduled && game.homeNhlTeamId > 0
            ? () => onTeamLogoClick(game.homeNhlTeamId)
            : undefined;

    const awayScore = game.awayScore ?? 0;
    const homeScore = game.homeScore ?? 0;

    // Score colors for a finished game.
    //
    //   - winner's score : green
    //   - loser's score  : white
    //   - tie            : both white
    //
    // Live and scheduled games always render both scores in white.
    // Live: the leader can still change. Scheduled: no score yet.
    const finished = isFinished(game);

    const awayScoreColor =
        finished && awayScore > homeScore
            ? '#22C55E'
            : '#FFFFFF';

    const homeScoreColor =
        finished && homeScore > awayScore
            ? '#22C55E'
            : '#FFFFFF';

    // Determine which half of the card was clicked and forward
    // that side to the parent. The card is divided by an
    // imaginary vertical line through its horizontal midpoint:
    // clicks left of center open the away boxscore, clicks right
    // of center open the home boxscore.
    const handleClick = (event: React.MouseEvent<HTMLDivElement>) => {
        if (!clickable) return;

        const rect = event.currentTarget.getBoundingClientRect();
        const clickX = event.clientX - rect.left;

        const side: 'away' | 'home' =
            clickX < rect.width / 2 ? 'away' : 'home';

        onToggle(game.gameId, side);
    };

    // -----------------------------------------------------------------
    // Swipe support
    //
    // When the card is expanded and showing a team's boxscore, a
    // horizontal swipe switches to the other team. Both directions
    // work because there are only two sides; the mapping is:
    //
    //   swipe left  (dx < 0) → go to the home side
    //   swipe right (dx > 0) → go to the away side
    //
    // Vertical drags are ignored so the user can still scroll the
    // page normally, and short drags are ignored so a normal tap
    // still works.
    //
    // The browser synthesizes a click after every touchend. If we
    // let that click through, a swipe over a player row would also
    // navigate to that player's page, and a swipe anywhere else
    // would also expand the side the finger happened to lift on.
    // The onClickCapture handler below suppresses that click for a
    // short window after a swipe ends.
    // -----------------------------------------------------------------

    const swipeStartRef = useRef<{ x: number; y: number } | null>(null);

    /**
     * Where and when the last swipe ended. Used by
     * handleClickCapture to tell the browser's synthetic click
     * (which fires at exactly the touch lift-off position) apart
     * from the user's next real tap (which fires wherever the
     * finger actually lands, almost always somewhere else).
     *
     * This replaces the old "suppress the next click" flag, which
     * could not distinguish the two cases: after a swipe on mobile
     * the flag stayed armed, so the user's next tap got eaten and
     * they had to tap twice.
     */
    const lastSwipeEndRef = useRef<
        { x: number; y: number; t: number } | null
    >(null);

    const handleTouchStart = (e: React.TouchEvent<HTMLDivElement>) => {
        // A new touch is beginning on this card. Any swipe-end
        // record from a previous gesture is now stale — that
        // gesture's synthetic click (if the browser fired one) has
        // already been suppressed. Clearing it here means that any
        // click following this new touch is treated as a real click
        // and goes through on the first try, instead of being
        // compared against an old swipe-end coordinate and possibly
        // swallowed by the 20 px proximity check.
        //
        // Without this reset, the user's first tap after a swipe
        // can land within 20 px of where the swipe ended and get
        // eaten, forcing them to tap twice. That is the exact bug
        // this line fixes.
        lastSwipeEndRef.current = null;

        // Only track a single-finger gesture. Multi-finger touches
        // (pinch, etc.) are left to the browser.
        if (e.touches.length !== 1) {
            swipeStartRef.current = null;
            return;
        }

        const t = e.touches[0];
        swipeStartRef.current = { x: t.clientX, y: t.clientY };
    };

    const handleTouchEnd = (e: React.TouchEvent<HTMLDivElement>) => {
        const start = swipeStartRef.current;
        swipeStartRef.current = null;

        if (!start) return;
        if (e.changedTouches.length === 0) return;

        const t = e.changedTouches[0];
        const dx = t.clientX - start.x;
        const dy = t.clientY - start.y;

        const absDx = Math.abs(dx);
        const absDy = Math.abs(dy);

        // Too short to be a swipe.
        if (absDx < GAMECARD_SWIPE_MIN_PX) return;

        // Too vertical to be a horizontal swipe. The ratio is
        // deliberately generous (roughly 56°) so a slightly
        // diagonal drag still counts.
        if (absDx < absDy * 1.5) return;

        // Record where and when the swipe ended. handleClickCapture
        // uses this to identify the synthetic click the browser
        // fires at the touch lift-off position, so a real tap
        // somewhere else on the card still goes through on the
        // first try.
        lastSwipeEndRef.current = {
            x: t.clientX,
            y: t.clientY,
            t: Date.now(),
        };

        // Ask the browser not to fire the synthetic click at the
        // end of this touch sequence. This is the primary defense;
        // the coordinate check in handleClickCapture is the
        // fallback for browsers that ignore preventDefault here.
        e.preventDefault();

        // Swipes only switch teams when the card is expanded. A
        // swipe on a collapsed card just scrolls the page.
        if (!expanded) return;
        if (expandedSide == null) return;

        // Always switch to the OTHER side, whichever direction the
        // finger travelled. With two panels there is only one
        // "other side", so direction carries no meaning: any swipe
        // toggles. Doing it this way also sidesteps the collapse
        // that used to happen when the mapped side happened to
        // equal the currently-expanded one (onToggle treats
        // same-game / same-side as a collapse).
        const nextSide: 'away' | 'home' =
            expandedSide === 'away' ? 'home' : 'away';

        onToggle(game.gameId, nextSide);
    };

    const handleClickCapture = (e: React.MouseEvent<HTMLDivElement>) => {
        const lastSwipe = lastSwipeEndRef.current;

        // No recent swipe → normal click.
        if (!lastSwipe) return;

        // Outside the suppression window → treat as a real click
        // and clear the reference so we stop looking at it.
        if (Date.now() - lastSwipe.t > GAMECARD_SWIPE_CLICK_SUPPRESS_MS) {
            lastSwipeEndRef.current = null;
            return;
        }

        // Inside the window. Compare the click position to where
        // the swipe ended. If they match, this is the synthetic
        // click the browser fires at the touch lift-off position,
        // so suppress it. If they differ, this is the user's next
        // real tap and must go through.
        //
        // The 20 px radius is generous enough for a little finger
        // drift, and still far smaller than any real distance a
        // user would move to tap a different team or a player row.
        const dx = e.clientX - lastSwipe.x;
        const dy = e.clientY - lastSwipe.y;
        const distance = Math.sqrt(dx * dx + dy * dy);

        lastSwipeEndRef.current = null;

        if (distance < 20) {
            e.preventDefault();
            e.stopPropagation();
        }
    };

    // Header label depends on game state.
    //
    // For live games, replace the generic "EN DIRECT" with the
    // current period and time remaining, so the label carries real
    // information rather than a static tag. Falls back to
    // "EN DIRECT" only in the brief window between a game going
    // LIVE and the live refresh publishing a clock.
    //
    // Scheduled and final games keep their static labels.
    let headerLabel: string;

    if (scheduled) {
        headerLabel = 'MATCH À VENIR';
    } else if (live && game.periodNumber != null) {
        const periodText = formatPeriodLabel(
            game.periodNumber,
            game.periodType,
        );

        if (game.isIntermission) {
            headerLabel = `${periodText} · Entracte`;
        } else if (game.periodTimeRemaining) {
            headerLabel = `${periodText} · ${game.periodTimeRemaining}`;
        } else {
            headerLabel = periodText;
        }
    } else if (live) {
        headerLabel = 'EN DIRECT';
    } else {
        headerLabel = 'TERMINÉ';
    }

    // Center display: start time for scheduled games, score for
    // live/final games. The score is rendered as a two-row block
    // below so the shots line can sit exactly under the score
    // digits. `showShots` gates the second row: it appears only
    // when the backend actually sent shot counts, which happens
    // only when a boxscore is cached for this game.
    const startLabel = scheduled
        ? startTimeLabel(game.startTimeUtc)
        : null;

    const showShots =
        !scheduled &&
        game.awayShots != null &&
        game.homeShots != null;

    // The period info used to live in its own caption under the
    // score. It has been folded into the header label above, so
    // there is nothing to compute here anymore.

    return (
        <div
            id={`game-card-${game.gameId}`}
            className={cn(
                // scroll-mt-... pushes the card down by the sticky
                // header's height plus a small gap when scrollIntoView
                // targets it with block: 'start'. Same pattern used by
                // PlayerCard and the marketplace slot editors.
                'overflow-hidden border transition-shadow scroll-mt-[calc(var(--header-height,4rem)+0.5rem)]',
                clickable && 'cursor-pointer hover:brightness-110',
            )}
            onClick={handleClick}
            onClickCapture={handleClickCapture}
            onTouchStart={handleTouchStart}
            onTouchEnd={handleTouchEnd}
            style={{
                borderColor: FRAME_BORDER,
                backgroundColor: FRAME_BG,
                boxShadow: live
                    ? '0 0 22px rgba(34, 197, 94, 0.35), inset 0 0 18px rgba(34, 197, 94, 0.08)'
                    : FRAME_GLOW,
                // Tell the browser we handle horizontal gestures
                // ourselves, it can keep handling vertical scroll.
                // Prevents iOS Safari's back/forward swipe gesture
                // from hijacking a horizontal swipe on the card.
                touchAction: 'pan-y',
            }}
        >
            <div
                className='grid items-stretch'
                style={{
                    // Fixed-width center column, so every game card
                    // shows the same middle panel width regardless of
                    // the score, the start time or the day label.
                    // The two team sides split the remaining space
                    // evenly; minmax(0, 1fr) prevents long team names
                    // from pushing a side wider than its sibling.
                    gridTemplateColumns: 'minmax(0, 1fr) 110px minmax(0, 1fr)',
                }}
            >
                {/* Away side. Owns its solid team-color background. */}
                <TeamSide
                    abbreviation={game.awayAbbreviation}
                    placeName={game.awayPlaceName}
                    commonName={game.awayCommonName}
                    record={game.awayRecord}
                    fillColor={awayFillColor}
                    secondaryColor={awaySecondaryColor}
                    dimmed={awayDimmed}
                    active={expandedSide === 'away'}
                    onLogoClick={handleAwayLogoClick}
                    nhlTeamId={game.awayNhlTeamId}
                    onTeamPageClick={onTeamLogoClick}
                />

                {/* Center column. Neutral navy with only the cyan
                    ambience, so it visually separates the two solid
                    team-colored sides.

                    The date label that used to sit at the top of
                    this column has been removed. The header label
                    ("TERMINÉ" / "2e · 10:32" / "MATCH À VENIR") is
                    now the topmost element, and the spacer at the
                    bottom of the column shifts the flex group up
                    so the header label sits roughly midway between
                    where it used to be (under the date) and where
                    the date used to be (top-3 of this column). */}
                <div
                    className='relative flex min-w-0 flex-col items-center justify-center px-3 py-3 text-center'
                    style={{
                        backgroundColor: PANEL_BG,
                        backgroundImage:
                            'radial-gradient(ellipse at 50% 42%, rgba(0, 168, 255, 0.10) 0%, rgba(0, 168, 255, 0.03) 40%, transparent 75%)',
                    }}
                >
                    {/* Period label: "2e · 10:32" for live games,
                        "MATCH À VENIR" for scheduled, "TERMINÉ" for
                        final.
                        
                        The label stays in the flex flow so the score
                        and shots below keep exactly the same centered
                        position they had before the date was removed.
                        Only the label is visually translated upward,
                        by 16 px, so it lands roughly midway between
                        where it used to sit (below the old date) and
                        where the old date label was (top-3). */}
                    <div
                        className='mt-1 -translate-y-4 text-[0.8rem] font-bold uppercase tracking-widest'
                        style={{
                            color: finished ? '#FFFFFF' : '#7DD3FC',
                        }}
                    >
                        {headerLabel}
                    </div>

                    {startLabel !== null ? (
                        <div className='mt-1 whitespace-nowrap text-[1.35rem] font-bold leading-tight text-white tabular-nums'>
                            {startLabel}
                        </div>
                    ) : (
                        <div className='mt-1 flex flex-col items-center gap-0.5 tabular-nums'>
                            {/* Score row. Two fixed-width columns
                                (w-8) center the two digits, with the
                                dash auto-sized between them. */}
                                <div className='flex items-center justify-center gap-2'>
                                    <span
                                        className='w-8 text-center text-[1.35rem] font-bold leading-tight'
                                        style={{ color: awayScoreColor }}
                                    >
                                        {awayScore}
                                    </span>
                                    <span className='text-[1.35rem] font-bold leading-tight text-white'>
                                        -
                                    </span>
                                    <span
                                        className='w-8 text-center text-[1.35rem] font-bold leading-tight'
                                        style={{ color: homeScoreColor }}
                                    >
                                        {homeScore}
                                    </span>
                                </div>

                            {/* Shots row. Laid out as two fixed-width
                                columns flanking a "-", mirroring the
                                score row's structure. Because both
                                outer columns share the same width
                                (w-14), the middle "-" sits at the
                                exact horizontal center of the row —
                                which is also where the score row's
                                "-" sits, since the score row is
                                symmetric (w-8 | "-" | w-8). The two
                                "-"s therefore line up vertically.

                                Left column is right-aligned and the
                                right column is left-aligned, so the
                                shot counts hug the "-" separator.
                                "shots :" is rendered smaller than
                                the numbers so it reads as a label,
                                not as part of the counts.

                                Rendered in the app's muted grey so
                                it reads as secondary information
                                under the score. */}
                                {showShots && (
                                    <div className='mt-0.5 flex items-center justify-center gap-1 text-[0.7rem] font-semibold text-white'>
                                        <span className='w-14 text-right'>
                                            {game.awayShots}
                                        </span>
                                        <span>-</span>
                                        <span className='w-14 text-left'>
                                            {game.homeShots}
                                        </span>
                                    </div>
                                )}
                        </div>
                    )}

                </div>

                {/* Home side. Owns its solid team-color background. */}
                <TeamSide
                    abbreviation={game.homeAbbreviation}
                    placeName={game.homePlaceName}
                    commonName={game.homeCommonName}
                    record={game.homeRecord}
                    fillColor={homeFillColor}
                    secondaryColor={homeSecondaryColor}
                    dimmed={homeDimmed}
                    active={expandedSide === 'home'}
                    onLogoClick={handleHomeLogoClick}
                    nhlTeamId={game.homeNhlTeamId}
                    onTeamPageClick={onTeamLogoClick}
                />
            </div>

            {expanded && expandedSide && (
                <BoxscorePanel
                    boxscore={boxscore}
                    loading={boxscoreLoading}
                    ownershipByPlayerId={ownershipByPlayerId}
                    side={expandedSide}
                />
            )}
        </div>
    );
}

// ---------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------

export default function GameDayPage() {
    /**
     * Current fantasy date in ET, format "yyyy-MM-dd". Backend-
     * supplied: the frontend never recomputes the 3 AM ET cutoff.
     * Null until the first fetch lands.
     */
    const [currentFantasyDate, setCurrentFantasyDate] =
        useState<string | null>(null);

    /**
     * The date the user is currently looking at. Null until the
     * first fetch seeds it to the fantasy date. From then on, it
     * only changes when the user explicitly picks another date from
     * the date picker. It does not silently follow the fantasy date
     * when the 3 AM rollover happens, so a user who is studying one
     * specific day does not get yanked off it.
     */
    const [selectedDate, setSelectedDate] = useState<string | null>(null);

    const [isDatePickerOpen, setIsDatePickerOpen] = useState(false);
    const datePickerRef = useRef<HTMLDivElement>(null);

    const [data, setData] = useState<GameDayScheduleResponse | null>(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);

    const [expandedGameId, setExpandedGameId] = useState<number | null>(null);

    /**
     * Which side of the expanded card the user is currently viewing.
     * Null when nothing is expanded. Clicking the same side again
     * collapses; clicking the other side of the same game swaps
     * without re-fetching (the boxscore is already in memory).
     */
    const [expandedSide, setExpandedSide] = useState<
        'away' | 'home' | null
    >(null);

    const [boxscore, setBoxscore] = useState<NhlBoxscoreResponse | null>(null);
    const [boxscoreLoading, setBoxscoreLoading] = useState(false);

    /**
     * Maps each NHL player id in the currently expanded boxscore to
     * the fantasy team that owns him, if any. Populated alongside
     * the boxscore fetch; cleared when the boxscore is collapsed,
     * when the date changes, or when a different game is expanded.
     */
    const [ownershipByPlayerId, setOwnershipByPlayerId] = useState<
        Map<number, PlayerOwnership>
    >(new Map());

    const isMountedRef = useRef(true);
    const boxscoreRequestIdRef = useRef(0);

    /**
     * Mirror of `selectedDate`, kept in a ref so that async callbacks
     * (notably the mount fetch inside fetchTodayGames) can read the
     * current value without needing it in their useCallback deps.
     *
     * Used to decide whether fetchTodayGames is allowed to write
     * `data`. See the guard inside that function for the full
     * rationale.
     */
    const selectedDateRef = useRef<string | null>(null);

    /**
     * Game id the page is currently trying to scroll into view.
     *
     * Set on click; cleared by the scroll effect below after the
     * scroll has actually been dispatched. The scroll itself is
     * deferred until the boxscore panel has finished loading, so
     * the browser measures the final expanded layout instead of
     * the collapsed card or the short "Chargement..." placeholder.
     * Without this, a game with a small expanded panel (or one
     * whose fetch hasn't returned yet) ends up positioned lower
     * than the top of the viewport, because the card grew after
     * the scroll was dispatched.
     */
    const pendingScrollToGameIdRef = useRef<number | null>(null);

    const navigate = useNavigate();

    // Same aura channel as the MonEquipePage team picker, so the
    // admin appearance slider drives both at once.
    const neonAura = useAura('teamPickerLabel');

    useEffect(() => {
        isMountedRef.current = true;
        return () => {
            isMountedRef.current = false;
        };
    }, []);

    // Keep selectedDateRef in sync with selectedDate so that
    // async callbacks can read the latest value without needing
    // it as a dependency.
    useEffect(() => {
        selectedDateRef.current = selectedDate;
    }, [selectedDate]);

    // --- Neon label strings (mirror MonEquipePage) --------------------
    const neonRest = useMemo(
        () =>
            [
                `0 0 ${auraRangeFor(neonAura, 'teamPickerLabel', 0).toFixed(2)}px #F2F5FA`,
                `0 0 ${auraRangeFor(neonAura, 'teamPickerLabel', 1).toFixed(2)}px #00A8FF`,
                `0 0 ${auraRangeFor(neonAura, 'teamPickerLabel', 2).toFixed(2)}px rgba(0, 168, 255, 0.85)`,
                `0 0 ${auraRangeFor(neonAura, 'teamPickerLabel', 3).toFixed(2)}px rgba(0, 168, 255, 0.55)`,
            ].join(', '),
        [neonAura],
    );

    const neonPeak = useMemo(
        () =>
            [
                `0 0 ${auraRangeFor(neonAura, 'teamPickerLabel', 0).toFixed(2)}px #F2F5FA`,
                `0 0 ${auraRangeFor(neonAura, 'teamPickerLabel', 1).toFixed(2)}px #00A8FF`,
                `0 0 ${auraRangeFor(neonAura, 'teamPickerLabel', 2).toFixed(2)}px #00A8FF`,
                `0 0 ${auraRangeFor(neonAura, 'teamPickerLabel', 3).toFixed(2)}px rgba(0, 168, 255, 0.85)`,
            ].join(', '),
        [neonAura],
    );

    const neonAuraOn = !isAuraOff(neonAura);

    // --- Date options: fantasy date + previous 6 days -----------------
    //
    // The picker's day 0 is the backend-supplied fantasy date, so
    // between 00:00 and 03:00 ET "Aujourd'hui" is still the previous
    // ET calendar day. Day 1 is labeled "Hier" and is
    // fantasyDate - 1. Days 2..6 are labeled with their actual
    // calendar date.
    const dateOptions = useMemo(() => {
        const options: {
            iso: string;
            label: string;
            shortLabel: string;
        }[] = [];

        if (!currentFantasyDate) {
            return options;
        }

        const parts = currentFantasyDate.split('-');

        if (parts.length !== 3) {
            return options;
        }

        const baseYear = Number(parts[0]);
        const baseMonth = Number(parts[1]);
        const baseDay = Number(parts[2]);

        if (
            !Number.isFinite(baseYear) ||
            !Number.isFinite(baseMonth) ||
            !Number.isFinite(baseDay)
        ) {
            return options;
        }

        for (let i = 0; i <= 6; i++) {
            // Construct in local components so the formatter renders
            // the intended calendar day, then read back the local
            // yyyy-MM-dd for the option value.
            const d = new Date(
                baseYear,
                baseMonth - 1,
                baseDay - i,
            );

            const iso = toIsoDate(d);

            let label: string;
            let shortLabel: string;

            if (i === 0) {
                label = "Aujourd'hui";
                shortLabel = "Aujourd'hui";
            } else if (i === 1) {
                label = 'Hier';
                shortLabel = 'Hier';
            } else {
                label = LONG_DATE_FORMATTER.format(d);
                shortLabel = SHORT_DATE_FORMATTER.format(d);
            }

            options.push({ iso, label, shortLabel });
        }

        return options;
    }, [currentFantasyDate]);

    const selectedOption =
        dateOptions.find((o) => o.iso === selectedDate) ?? dateOptions[0];

    // --- Close picker on outside click / Escape -----------------------
    useEffect(() => {
        if (!isDatePickerOpen) return;

        function onMouseDown(event: MouseEvent) {
            if (
                datePickerRef.current &&
                !datePickerRef.current.contains(event.target as Node)
            ) {
                setIsDatePickerOpen(false);
            }
        }

        function onKeyDown(event: KeyboardEvent) {
            if (event.key === 'Escape') {
                setIsDatePickerOpen(false);
            }
        }

        document.addEventListener('mousedown', onMouseDown);
        document.addEventListener('keydown', onKeyDown);

        return () => {
            document.removeEventListener('mousedown', onMouseDown);
            document.removeEventListener('keydown', onKeyDown);
        };
    }, [isDatePickerOpen]);

    // --- Reset expanded boxscore when the date changes ----------------
    //
    // The FIRST transition of selectedDate (from null to the
    // initial date) must not reset the expanded state, because on
    // the restore path we have just populated it in the restore
    // effect below. Only subsequent changes — the user actually
    // picking a different date — should collapse the current card.
    //
    // prevSelectedDateRef tracks the previous value so we can tell
    // the two apart.
    const prevSelectedDateRef = useRef<string | null>(null);

    useEffect(() => {
        const prev = prevSelectedDateRef.current;
        prevSelectedDateRef.current = selectedDate;

        if (prev == null) {
            // First real value, either from the initial mount or
            // from a restore on the way back from a player page.
            // Nothing to reset.
            return;
        }

        pendingScrollToGameIdRef.current = null;
        boxscoreRequestIdRef.current += 1;
        setExpandedGameId(null);
        setExpandedSide(null);
        setBoxscore(null);
        setBoxscoreLoading(false);
        setOwnershipByPlayerId(new Map());
    }, [selectedDate]);

    // --- Fetchers -----------------------------------------------------
    const fetchTodayGames = useCallback(
        async (force: boolean): Promise<GameDayScheduleResponse | null> => {
            try {
                const result = await getTodayGames(force);
                if (!isMountedRef.current) return null;

                // GUARD: only write `data` when the user is
                // actually looking at today's date.
                //
                // On the restore path (GameDay -> Player -> GameDay),
                // the restore effect sets selectedDate to a past
                // date before this fetch resolves. If we let it
                // write `data`, the games list would become today's
                // games, and the expanded game (which is on the
                // restored date) would have no card to render in —
                // the boxscore would sit in memory but never appear.
                //
                // A null selectedDate means "no date picked yet"
                // (fresh mount), so we still write data in that
                // case.
                //
                // The polling effect is what populates `data` for a
                // past selectedDate; it fires as soon as both
                // selectedDate and currentFantasyDate are set, which
                // happens on the same tick as this fetch resolves.
                const selectedNow = selectedDateRef.current;

                if (
                    selectedNow === null ||
                    selectedNow === result.currentFantasyDate
                ) {
                    setData(result);
                }

                // Refresh the fantasy date on every fetch so a 3 AM
                // rollover is picked up without a page reload.
                // React bails out if the value is unchanged, so this
                // does not cause extra renders.
                setCurrentFantasyDate(result.currentFantasyDate);
                setError(null);
                return result;
            } catch {
                if (!isMountedRef.current) return null;
                setError(
                    'Impossible de charger les matchs du jour. ' +
                    'Vérifiez la connexion au serveur API.',
                );
                return null;
            } finally {
                if (isMountedRef.current) setLoading(false);
            }
        },
        [],
    );

    const fetchGamesForDate = useCallback(
        async (
            date: string,
        ): Promise<GameDayScheduleResponse | null> => {
            try {
                const result = await getGamesByDate(date);
                if (!isMountedRef.current) return null;
                setData(result);
                setError(null);
                return result;
            } catch {
                if (!isMountedRef.current) return null;
                setError(
                    'Impossible de charger les matchs de cette date.',
                );
                return null;
            } finally {
                if (isMountedRef.current) setLoading(false);
            }
        },
        [],
    );

    const handleTeamLogoClick = useCallback(
        (nhlTeamId: number) => {
            if (!selectedDate) return;

            // The snapshot is kept current by the effect further
            // down, but we save it again here so this handler is
            // self-sufficient regardless of render timing.
            saveGameDaySnapshot({
                selectedDate,
                expandedGameId,
                expandedSide,
            });

            navigate(`/nhl-equipe/${nhlTeamId}`, {
                state: { returnTo: '/game-day' },
            });
        },
        [selectedDate, expandedGameId, expandedSide, navigate],
    );

    // --- Mount effect: seed the fantasy date and the selected date ---
    //
    // Runs once. Fetches the schedule, records the fantasy date, and
    // — only on this first load — sets the selected date to the
    // fantasy date.
    //
    // If the fetch fails (network hiccup, backend still warming up),
    // retries on an exponentially backing-off schedule so the page
    // never gets stuck on "Chargement..." with no way out, and a
    // persistent backend outage does not produce a request storm.
    useEffect(() => {
        let cancelled = false;
        let retryTimeout: number | null = null;
        let delayMs = MOUNT_RETRY_BASE_MS;

        const attempt = async () => {
            if (cancelled) return;

            const result = await fetchTodayGames(false);

            if (cancelled) return;

            if (result) {
                setSelectedDate(
                    (prev) => prev ?? result.currentFantasyDate,
                );
                return;
            }

            retryTimeout = window.setTimeout(
                () => void attempt(),
                delayMs,
            );

            delayMs = Math.min(delayMs * 2, MOUNT_RETRY_MAX_MS);
        };

        void attempt();

        return () => {
            cancelled = true;
            if (retryTimeout != null) {
                window.clearTimeout(retryTimeout);
            }
        };
    }, [fetchTodayGames]);

    // --- Polling effect: react to selected date and polling cadence ---
    useEffect(() => {
        if (!selectedDate || !currentFantasyDate) return;

        let cancelled = false;
        let timeoutId: number | null = null;

        const isOnToday = selectedDate === currentFantasyDate;

        const tick = async (force: boolean) => {
            if (cancelled) return;

            if (isOnToday) {
                const result = await fetchTodayGames(force);
                if (cancelled || !result) return;

                const hasLive = result.games.some(isLive);
                const needsForce =
                    !result.isFresh ||
                    (result.games.length ?? 0) === 0;

                // If the cached snapshot we just received is stale
                // AND we did not already force, fire a background
                // refresh right now. The page has already rendered
                // with the cached data; the fresh payload updates
                // state silently when it arrives. This avoids
                // waiting the full 2-10 min poll interval before
                // the user sees up-to-date scores.
                if (needsForce && !force) {
                    void fetchTodayGames(true).catch(() => {
                        // Non-fatal: the next scheduled tick retries.
                    });
                }

                const delay = hasLive ? POLL_LIVE_MS : POLL_IDLE_MS;

                timeoutId = window.setTimeout(
                    () => tick(needsForce),
                    delay,
                );
            } else {
                // Past dates are static — fetch once, no polling.
                setLoading(true);
                await fetchGamesForDate(selectedDate);
            }
        };

        // First pass on mount: DO NOT force a synchronous NHL
        // refresh. Serve whatever the backend already has in its
        // in-memory cache.
        void tick(false);

        return () => {
            cancelled = true;
            if (timeoutId != null) window.clearTimeout(timeoutId);
        };
    }, [
        selectedDate,
        currentFantasyDate,
        fetchTodayGames,
        fetchGamesForDate,
    ]);

    // --- Boxscore fetch helper ----------------------------------------
    //
    // Fetches the boxscore and stores it in state, then fetches the
    // fantasy team ownership for the players in it. Used by both the
    // click handler (handleToggleExpand) and the restore effect that
    // runs on mount when the user is coming back from a player page.
    //
    // TWO SEQUENTIAL FETCHES, BUT THE PANEL RENDERS AFTER THE FIRST
    //
    // The boxscore fetch and the ownership fetch hit different
    // endpoints and are sequential by nature: the ownership call
    // needs the player ids that come out of the boxscore. What we
    // do NOT do is block the panel on the ownership fetch. As soon
    // as the boxscore arrives, the panel renders with the full
    // roster of players; the ownership chips (fantasy team names)
    // populate a moment later, without any loading placeholder.
    //
    // CLIENT-SIDE CACHE FOR FINAL/OFF
    //
    // A finished game's boxscore never changes, so the second click
    // on the same card is served from the client-side response
    // cache (see apiGet in client.ts). LIVE/CRIT boxscores change
    // by the second and stay uncached. The decision is made by the
    // caller, which knows the game's state from the summary it
    // received from /Games/today or /Games/by-date.
    //
    // The request id guards against stale responses: if a second
    // fetch starts before the first completes (e.g. the user clicks
    // a different game while the first is still loading), only the
    // second result is applied.
    const openBoxscore = async (
        gameId: number,
        side: 'away' | 'home',
        isFinishedGame: boolean = false,
    ) => {
        const requestId = ++boxscoreRequestIdRef.current;

        pendingScrollToGameIdRef.current = gameId;
        setExpandedGameId(gameId);
        setExpandedSide(side);
        setBoxscore(null);
        setOwnershipByPlayerId(new Map());
        setBoxscoreLoading(true);

        try {
            const result = await getGameBoxscore(gameId, {
                cacheTtlMs: isFinishedGame ? 5 * 60_000 : 0,
            });

            if (
                !isMountedRef.current ||
                requestId !== boxscoreRequestIdRef.current
            ) {
                return;
            }

            setBoxscore(result);

            // Panel renders NOW. Ownership is a progressive
            // enhancement — the fantasy team chip next to each
            // player — so it runs in the background and does not
            // gate the initial paint. If the call fails or never
            // lands, the boxscore simply renders without chips,
            // which is the same visual the panel had before
            // ownership was added.
            setBoxscoreLoading(false);

            const playerIds = collectBoxscorePlayerIds(result);

            void getPlayerOwnership(playerIds)
                .then((ownershipRows) => {
                    if (
                        !isMountedRef.current ||
                        requestId !== boxscoreRequestIdRef.current
                    ) {
                        return;
                    }

                    const map = new Map<number, PlayerOwnership>();
                    for (const row of ownershipRows) {
                        map.set(row.nhlPlayerId, row);
                    }
                    setOwnershipByPlayerId(map);
                })
                .catch(() => {
                    // Non-fatal: chips simply stay hidden.
                });
        } catch {
            if (
                isMountedRef.current &&
                requestId === boxscoreRequestIdRef.current
            ) {
                setBoxscoreLoading(false);
            }
        }
    };

    // --- Boxscore expand handler --------------------------------------
    //
    // This handler only updates state. The scroll to the expanded
    // card is handled by a dedicated effect below, which waits for
    // the boxscore panel to finish loading before it dispatches.
    const handleToggleExpand = async (
        gameId: number,
        side: 'away' | 'home',
    ) => {
        // Same game, same side → collapse.
        if (expandedGameId === gameId && expandedSide === side) {
            pendingScrollToGameIdRef.current = null;
            boxscoreRequestIdRef.current += 1;
            setExpandedGameId(null);
            setExpandedSide(null);
            setBoxscore(null);
            setOwnershipByPlayerId(new Map());
            return;
        }

        // Same game, other side → swap sides without re-fetching.
        // The boxscore and ownership map are already loaded for
        // this game, so reuse them and just flip which team's
        // panel is shown.
        //
        // No scroll here on purpose. The card is already positioned
        // where it needs to be — a side-switch only replaces the
        // panel content below it, it does not move the card.
        // Triggering the smooth-scroll effect from this branch was
        // the cause of the "second click needed after a swipe" bug:
        // the browser treats a tap during an in-flight smooth scroll
        // as a command to stop the scroll, so the user's next tap
        // got swallowed instead of firing a click. With no scroll,
        // the next tap lands on a settled page and goes through on
        // the first try.
        if (
            expandedGameId === gameId &&
            expandedSide !== side &&
            boxscore
        ) {
            setExpandedSide(side);
            return;
        }

        // Different game (or switching back to a game whose boxscore
        // was cleared) → fetch fresh.
        //
        // Pass the game's current state so openBoxscore can decide
        // whether the boxscore is cacheable client-side. A game
        // that is FINAL or OFF will not change; a LIVE or CRIT game
        // must always be refetched.
        const game = games.find((g) => g.gameId === gameId);
        const isFinishedGame = game != null && isFinished(game);

        await openBoxscore(gameId, side, isFinishedGame);
    };

    // --- Save GameDay state on every change ---------------------------
    //
    // Writes the three fields we want to restore (selected date,
    // expanded game, expanded side) into the module-level store.
    // The store is cleared by Layout.tsx whenever the user lands on
    // a page that is neither GameDay nor a player page, so it only
    // survives a direct GameDay -> Player -> GameDay round-trip.
    useEffect(() => {
        if (!selectedDate) return;

        saveGameDaySnapshot({
            selectedDate,
            expandedGameId,
            expandedSide,
        });
    }, [selectedDate, expandedGameId, expandedSide]);

    // --- Restore GameDay state on mount -------------------------------
    //
    // The snapshot only exists when the previous route was a
    // player page (Layout cleared it otherwise), so no additional
    // check is needed here.
    //
    // The restore effect runs on mount, applies the snapshot, and
    // — if a game was expanded — reopens it so the boxscore panel
    // comes back.
    //
    // FETCH THE GAMES LIST IMMEDIATELY
    //
    // The polling effect refuses to run until BOTH selectedDate and
    // currentFantasyDate are set, and currentFantasyDate only
    // arrives when the mount fetch (getTodayGames) resolves. On the
    // restore path, that would gate the games list behind:
    //
    //     getTodayGames  ->  polling effect  ->  getGamesByDate
    //
    // Three sequential round trips before the card renders, and the
    // shared NHL rate limiter makes each one potentially slow when
    // another job is running. The card — and therefore the boxscore
    // inside it — appears several seconds late.
    //
    // Fix: fire fetchGamesForDate(snapshot.selectedDate) directly
    // from here, in parallel with the mount fetch. The card renders
    // as soon as the games list and the boxscore are both in.
    //
    // The subsequent polling effect run (after currentFantasyDate
    // arrives) fetches the same URL, which the client-side response
    // cache (5 min TTL on getGamesByDate) short-circuits, so there
    // is no duplicate network call.
    //
    // PEEK + DEFERRED CLEAR (not consume)
    //
    // The clear is deferred by one tick so that Layout's own
    // scroll-to-top effect (which fires in the same commit, after
    // ours, due to child-first effect ordering) can still see the
    // snapshot via peekGameDaySnapshot() and skip its scroll-to-
    // top. If we cleared synchronously, Layout would find the
    // snapshot gone and would scroll the page to (0, 0) — which
    // would cancel the scroll-to-card that the GameDay scroll
    // effect schedules moments later.
    //
    // The empty deps array is deliberate: this must run exactly once
    // per mount, not on every render. openBoxscore and
    // fetchGamesForDate use only refs and stable state setters, so
    // the first-render closures are safe to keep for the lifetime
    // of the mount.
    useEffect(() => {
        const snapshot = peekGameDaySnapshot();
        if (snapshot == null) return;

        setSelectedDate(snapshot.selectedDate);
        setExpandedGameId(snapshot.expandedGameId);
        setExpandedSide(snapshot.expandedSide);

        // Fire both network calls in parallel. The games list and
        // the boxscore are independent; racing them halves the
        // time to first paint of the expanded card.
        void fetchGamesForDate(snapshot.selectedDate);

        if (
            snapshot.expandedGameId != null &&
            snapshot.expandedSide != null
        ) {
            void openBoxscore(
                snapshot.expandedGameId,
                snapshot.expandedSide,
            );
        }

        // Defer the clear so Layout's effect can peek first.
        const timer = window.setTimeout(() => {
            clearGameDaySnapshot();
        }, 0);

        return () => window.clearTimeout(timer);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    // --- Scroll the expanded game card to the top of the viewport ---
    //
    // Fires whenever the expanded game, the expanded side, or the
    // boxscore loading state changes.
    //
    // The scroll is delayed until boxscoreLoading is false, so the
    // browser measures the fully-expanded panel instead of the
    // collapsed card or the short "Chargement..." placeholder.
    // Without that wait, a game with a small expanded panel (or one
    // whose fetch hasn't returned yet) ends up positioned lower on
    // screen than expected, because the card grew after the scroll
    // was dispatched.
    //
    // Two rAFs: one to let React commit the new panel to the DOM,
    // and one to let the browser paint it so scrollIntoView targets
    // the final layout height. scroll-mt-[...] on the card pushes it
    // down by the sticky header's height, so it lands below the
    // header rather than behind it.
    // --- Scroll the expanded game card to the top of the viewport ---
    //
    // REF VS STATE
    //
    // pendingScrollToGameIdRef is set synchronously by openBoxscore.
    // expandedGameId is state, applied on the next render. On the
    // restore path (GameDay -> Player -> GameDay), the restore
    // effect calls openBoxscore during the same commit as this
    // effect, so this effect's closure sees expandedGameId = null
    // even though the ref is already set. The mismatch branch below
    // waits for the next render in that case; it must NOT clear the
    // ref, because the ref holds exactly the value the next render
    // will match.
    //
    // The previous version of this effect cleared the ref on
    // mismatch, which wiped it out on the very first commit of the
    // restore path and is why the card never scrolled into view.
    //
    // RETRY
    //
    // Even when the state matches, the card may not be in the DOM
    // yet (the games list may still be loading). tryScroll retries
    // every 100 ms up to 10 s, so a late-arriving card still gets
    // scrolled into view once the list renders.
    useEffect(() => {
        const targetGameId = pendingScrollToGameIdRef.current;

        // Nothing pending.
        if (targetGameId === null) return;

        // State has not caught up to the ref yet. Wait for the next
        // render; this effect will re-fire because expandedGameId is
        // in the deps. Do NOT clear the ref.
        if (expandedGameId !== targetGameId) return;

        // Wait for the panel to finish loading so we measure the
        // final layout height.
        if (boxscoreLoading) return;

        let cancelled = false;
        let attempts = 0;

        // 100 * 100 ms = 10 s total. Wide enough that a boxscore
        // queued behind a live-refresh burst still gets its card
        // scrolled into view once it loads. On a normal click the
        // card is found on the first attempt, so this window is
        // never consumed in practice.
        const maxAttempts = 100;
        const retryDelayMs = 100;

        const tryScroll = () => {
            if (cancelled) return;

            const el = document.getElementById(
                `game-card-${targetGameId}`,
            );

            if (!el) {
                attempts++;

                if (attempts < maxAttempts) {
                    window.setTimeout(tryScroll, retryDelayMs);
                } else {
                    pendingScrollToGameIdRef.current = null;
                }

                return;
            }

            const headerHeight =
                parseFloat(
                    getComputedStyle(document.documentElement)
                        .getPropertyValue('--header-height'),
                ) || 64;

            const cardTop =
                window.scrollY + el.getBoundingClientRect().top;

            const desiredScroll = Math.max(
                0,
                cardTop - headerHeight - 8,
            );

            const maxScroll = Math.max(
                0,
                document.documentElement.scrollHeight -
                window.innerHeight,
            );

            const targetScroll = Math.min(desiredScroll, maxScroll);

            window.scrollTo({
                top: targetScroll,
                behavior: 'smooth',
            });

            pendingScrollToGameIdRef.current = null;
        };

        const raf1 = window.requestAnimationFrame(() => {
            tryScroll();
        });

        return () => {
            cancelled = true;
            window.cancelAnimationFrame(raf1);
        };
    }, [
        expandedGameId,
        expandedSide,
        boxscoreLoading,
        boxscore,
        data?.games.length,
    ]);

    // --- Games list ---------------------------------------------------
    //
    // The /Games/today endpoint returns the whole NHL game week, so
    // when the selected date matches the fantasy date, we filter to
    // games whose ET calendar start date equals that date. A game
    // that started late on that date and is still LIVE is kept even
    // if it has just crossed into the next ET day, so it stays
    // visible while it is being played.
    //
    // The /Games/by-date endpoint already returns a single day, so
    // past dates skip the filter.
    const games = useMemo(() => {
        if (!data || !selectedDate || !currentFantasyDate) {
            return [];
        }

        const raw = data.games ?? [];

        const filtered =
            selectedDate === currentFantasyDate
                ? raw.filter(
                    (g) =>
                        g.gameDate === currentFantasyDate ||
                        isLive(g),
                )
                : raw;

        return sortGamesByStartTime(filtered);
    }, [data, selectedDate, currentFantasyDate]);

    if (loading && !data) {
        return (
            <section className='w-full space-y-4'>
                <div className='flex justify-center'>
                    <p className='text-muted-foreground'>Chargement...</p>
                </div>
            </section>
        );
    }

    if (!data || !currentFantasyDate || !selectedDate || !selectedOption) {
        return (
            <section className='w-full space-y-4'>
                <div className='flex justify-center'>
                    <p className='text-muted-foreground'>Chargement...</p>
                </div>
            </section>
        );
    }

    return (
        <section className='-mt-4 w-full space-y-4 sm:-mt-6'>
            {/* ---- Date picker (mimics MonEquipePage team picker) ---- */}
            <div className='mt-2 flex flex-col items-center gap-2'>
                <div
                    ref={datePickerRef}
                    className='relative w-full'
                >
                    <button
                        type='button'
                        aria-haspopup='listbox'
                        aria-expanded={isDatePickerOpen}
                        aria-label='Choisir une date'
                        onClick={() =>
                            setIsDatePickerOpen((v) => !v)
                        }
                        className='relative z-40 mx-auto flex cursor-pointer items-center justify-center px-3 py-0.5 focus:outline-none focus-visible:outline-none'
                    >
                        <span className='relative inline-block'>
                            <span
                                className={`text-2xl leading-none tracking-[0.02em] capitalize ${neonAuraOn
                                    ? `${auraPulseClass('text')} aura-mobile-keep`
                                    : ''
                                    }`}
                                style={{
                                    fontFamily:
                                        "'Grindy Brush', sans-serif",
                                    fontWeight: 400,
                                    color: '#FFFFFF',
                                    WebkitTextStrokeWidth: '3.5px',
                                    WebkitTextStrokeColor: '#AF1E2D',
                                    paintOrder: 'stroke fill',
                                    ...(neonAuraOn
                                        ? auraPulseStyle(
                                            neonRest,
                                            neonPeak,
                                        )
                                        : {}),
                                } as React.CSSProperties}
                            >
                                {selectedOption.shortLabel}
                            </span>

                            <span
                                aria-hidden='true'
                                className={`pointer-events-none absolute left-full top-1/2 ml-2 inline-block text-sm leading-none transition-transform duration-200 ${neonAuraOn
                                    ? `${auraPulseClass('text')} aura-mobile-keep`
                                    : ''
                                    }`}
                                style={{
                                    transform: isDatePickerOpen
                                        ? 'translateY(-50%) rotate(180deg)'
                                        : 'translateY(-50%) rotate(0deg)',
                                    color: '#FFFFFF',
                                    WebkitTextStrokeWidth: '1px',
                                    WebkitTextStrokeColor: '#AF1E2D',
                                    paintOrder: 'stroke fill',
                                    ...(neonAuraOn
                                        ? auraPulseStyle(
                                            neonRest,
                                            neonPeak,
                                        )
                                        : {}),
                                } as React.CSSProperties}
                            >
                                ▼
                            </span>
                        </span>
                    </button>

                    {isDatePickerOpen && (
                        <ul
                            role='listbox'
                            className='absolute left-0 right-0 z-40 mt-1 max-h-72 overflow-y-auto rounded-lg border border-[#00E5FF]/50 bg-[#0F1626] shadow-[0_0_20px_rgba(0,229,255,0.35),0_8px_24px_rgba(0,0,0,0.6)] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden'
                        >
                            {dateOptions.map((opt) => {
                                const isSelected =
                                    opt.iso === selectedDate;

                                return (
                                    <li key={opt.iso}>
                                        <button
                                            type='button'
                                            role='option'
                                            aria-selected={isSelected}
                                            onClick={() => {
                                                setSelectedDate(opt.iso);
                                                setIsDatePickerOpen(false);
                                            }}
                                            className={`w-full cursor-pointer px-4 py-2.5 text-center text-lg font-semibold capitalize transition-colors ${isSelected
                                                ? 'bg-[#00E5FF]/20 text-[#00E5FF]'
                                                : 'text-foreground hover:bg-[#00E5FF]/10 hover:text-[#00E5FF]'
                                                }`}
                                        >
                                            {opt.label}
                                        </button>
                                    </li>
                                );
                            })}
                        </ul>
                    )}
                </div>
            </div>

            {error && (
                <p className='rounded-lg border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive'>
                    {error}
                </p>
            )}

            {games.length === 0 && !error && (
                <p className='rounded-lg border border-border bg-card px-3 py-6 text-center text-sm text-muted-foreground'>
                    {selectedDate === currentFantasyDate
                        ? "Aucun match prévu aujourd'hui."
                        : 'Aucun match prévu à cette date.'}
                </p>
            )}

            {games.length > 0 && (
                <div className='space-y-2'>
                    {games.map((game) => (
                        <GameCard
                            key={game.gameId}
                            game={game}
                            expanded={
                                expandedGameId === game.gameId
                            }
                            expandedSide={
                                expandedGameId === game.gameId
                                    ? expandedSide
                                    : null
                            }
                            boxscore={
                                expandedGameId === game.gameId
                                    ? boxscore
                                    : null
                            }
                            boxscoreLoading={
                                expandedGameId === game.gameId &&
                                boxscoreLoading
                            }
                            ownershipByPlayerId={
                                expandedGameId === game.gameId
                                    ? ownershipByPlayerId
                                    : new Map()
                            }
                            onToggle={handleToggleExpand}
                            onTeamLogoClick={handleTeamLogoClick}
                        />
                    ))}
                </div>
            )}
        </section>
    );
}