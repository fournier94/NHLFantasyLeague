import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
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
import { NhlTeamLogo } from '@/components/nhl/NhlTeamLogo';
import {
    getNhlTeamAuraColor,
    getNhlTeamColor,
} from '@/lib/nhlTeamColors';
import { useAura } from '@/lib/auraContext';
import {
    auraPulseClass,
    auraPulseStyle,
    auraRangeFor,
    isAuraOff,
} from '@/lib/auraConfig';
import { cn } from '@/lib/utils';

// ---------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------

const POLL_LIVE_MS = 2 * 60_000;
const POLL_IDLE_MS = 10 * 60_000;

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

    return (
        <Link
            to={`/joueurs/${skater.playerId}`}
            onClick={(event) => event.stopPropagation()}
            className='flex items-center justify-between gap-2 rounded px-1 py-0.5 text-xs transition-colors hover:bg-[#00A8FF]/10'
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
                <span className='w-6 text-center text-muted-foreground'>
                    {skater.goals}
                </span>
                <span className='w-6 text-center text-muted-foreground'>
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

    // A loss shows in red so it stands out from the wins and OT
    // losses at a glance. Wins and OT losses stay green.
    const decisionColor =
        decision === 'L' ? '#EF4444' : '#22C55E';

    return (
        <Link
            to={`/joueurs/${goalie.playerId}`}
            onClick={(event) => event.stopPropagation()}
            className='flex items-center justify-between gap-2 rounded px-1 py-0.5 text-xs transition-colors hover:bg-[#00A8FF]/10'
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
                <span className='w-14 text-center text-muted-foreground'>
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
            <div className='flex items-center gap-2 border-b border-[#00A8FF]/20 pb-1'>
                <NhlTeamLogo abbreviation={abbreviation} size={20} />
                <span className='text-sm font-semibold text-foreground'>
                    {abbreviation}
                </span>
                <span className='text-[0.65rem] uppercase tracking-wider text-[#7DD3FC]'>
                    {label}
                </span>
            </div>

            {/* Goalie section first. The single starting goalie is
                the most important line in the boxscore, so it sits
                at the top of the team block. */}
            {goalies.length > 0 && (
                <div>
                    <div className='mb-1 flex items-center justify-between gap-2 text-[0.6rem] uppercase tracking-wider text-[#7DD3FC]'>
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
                    <div className='mb-1 flex items-center justify-between gap-2 text-[0.6rem] uppercase tracking-wider text-[#7DD3FC]'>
                        <span className='flex-1'>Joueur</span>
                        <div className='flex shrink-0 gap-2'>
                            <span className='w-6 text-center'>B</span>
                            <span className='w-6 text-center'>A</span>
                            <span className='w-8 text-center'>PTS</span>
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
            className='max-h-[28rem] space-y-4 overflow-y-auto border-t px-3 py-3 md:max-h-none'
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
    stripColor,
    side,
    dimmed = false,
}: {
    abbreviation: string;
    placeName: string;
    commonName: string;
    record: string | null;
    fillColor: string;
    stripColor: string;
    side: 'away' | 'home';
    dimmed?: boolean;
}) {
    const isAway = side === 'away';
    const accentSide: 'left' | 'right' = isAway ? 'left' : 'right';

    // Black palette used when this side is the "inactive" side of an
    // expanded game card. Both values are opaque hex; they are run
    // through the same `99` alpha suffix below, so they end up at
    // the same visual weight as the team colors they replace.
    // Sitting over the navy PANEL_BG at ~60% alpha, this reads as a
    // dark, neutral block with no team hue.
    const DIMMED_FILL = '#000000';
    const DIMMED_STRIP = '#000000';

    const effectiveFill = dimmed ? DIMMED_FILL : fillColor;
    const effectiveStrip = dimmed ? DIMMED_STRIP : stripColor;

    // Solid fill. The two-hex-digit suffix on the six-digit hex sets
    // the alpha: 99 is ~60%, which reads as a solid color while
    // keeping the panel dark enough for the white text on top.
    // Raise to CC (~80%) or drop the suffix entirely for a fully
    // opaque, brighter side.
    const solidTeamColor = `${effectiveFill}99`;

    // Very subtle vertical shade so the panel doesn't read as flat.
    // Top and bottom are slightly darker than the center; the effect
    // is almost invisible but gives the panel a physical feel. It is
    // painted on top of the solid fill.
    const verticalShade =
        'linear-gradient(180deg, ' +
        'rgba(0, 0, 0, 0.18) 0%, ' +
        'rgba(0, 0, 0, 0) 45%, ' +
        'rgba(0, 0, 0, 0.22) 100%)';

    return (
        <div
            className='relative flex min-w-0 flex-col items-center justify-center overflow-hidden px-3 pt-2 pb-4 text-center'
            style={{
                backgroundColor: PANEL_BG,
                backgroundImage: [
                    verticalShade,
                    // A uniform fill. Repeating the same color at
                    // both ends of a linear-gradient gives a flat,
                    // gradient-free fill that sits on top of
                    // PANEL_BG and underneath the vertical shade.
                    `linear-gradient(${solidTeamColor}, ${solidTeamColor})`,
                ].join(', '),
            }}
        >
            {/* Contained-filament neon accent strip on the outer edge.
                Two stacked layers at the same size and position:
                a thick accent "tube" and a thin near-white "filament"
                running through its center. Nothing extends outside
                the strip's own bounding box.

                Uses `effectiveStrip` (the aura-override variant when
                the side is active, grey when it is dimmed), NOT
                `fillColor`, so the strip stays visible for teams
                whose base color is nearly black. */}
            <div
                aria-hidden='true'
                className='pointer-events-none absolute inset-y-5 w-[3px] rounded-full'
                style={{
                    [accentSide]: 4,
                    backgroundColor: effectiveStrip,
                    zIndex: 2,
                }}
            >
                <div
                    aria-hidden='true'
                    className='absolute inset-y-0 left-1/2 w-[1px] -translate-x-1/2 rounded-full'
                    style={{ backgroundColor: '#FFFDF0' }}
                />
            </div>

            {/* Content, lifted above the strip so it stays sharp. */}
            <div
                className='relative flex flex-col items-center'
                style={{ zIndex: 3 }}
            >
                {/* When this side is the inactive one on an expanded
                    card, the logo is desaturated to match the dimmed
                    background. filter applies to the whole subtree,
                    so wrapping the logo is enough — no changes to the
                    NhlTeamLogo component are needed. 0.2 = 20%
                    saturation = 80% reduction. */}
                <div
                    style={{
                        filter: dimmed ? 'saturate(0.2)' : undefined,
                    }}
                >
                    <NhlTeamLogo
                        abbreviation={abbreviation}
                        size={60}
                    />
                </div>

                <div
                    // mt-2 removed. The logo is 12px taller than before,
                    // so removing this 8px margin pulls the place name
                    // back up to its original vertical position relative
                    // to the top of the panel. Without this, the text
                    // would sit 12px lower than it did before the logo
                    // resize.
                    className='truncate text-[0.62rem] uppercase tracking-[0.22em] text-white/80'
                    style={{ textShadow: '0 1px 2px rgba(0, 0, 0, 0.55)' }}
                >
                    {placeName}
                </div>

                <div
                    // Reduced from text-[1rem] to text-[0.8rem] (20%
                    // smaller). Combined with the padding change above,
                    // this keeps the panel height identical despite the
                    // larger logo.
                    className='truncate text-[0.8rem] font-bold uppercase leading-tight tracking-wide text-white'
                    style={{ textShadow: '0 1px 3px rgba(0, 0, 0, 0.6)' }}
                >
                    {commonName}
                </div>

                {record && (
                    <div className='mt-1 text-[0.75rem] font-semibold tabular-nums text-white/90'>
                        {record}
                    </div>
                )}
            </div>
        </div>
    );
}

/**
 * Short day label under the header, matching the date the game
 * belongs to. Live games always read "EN DIRECT" regardless of
 * which side of midnight they started on.
 */
function dayLabel(
    gameDate: string,
    currentFantasyDate: string,
): string {
    if (gameDate === currentFantasyDate) {
        return "AUJOURD'HUI";
    }

    // Subtract one calendar day from the fantasy date, purely as
    // string arithmetic on the ISO parts, so DST can never shift
    // the result.
    const parts = currentFantasyDate.split('-');
    if (parts.length === 3) {
        const y = Number(parts[0]);
        const m = Number(parts[1]);
        const d = Number(parts[2]);
        if (Number.isFinite(y) && Number.isFinite(m) && Number.isFinite(d)) {
            const prev = new Date(Date.UTC(y, m - 1, d));
            prev.setUTCDate(prev.getUTCDate() - 1);
            const yyyy = prev.getUTCFullYear();
            const mm = String(prev.getUTCMonth() + 1).padStart(2, '0');
            const dd = String(prev.getUTCDate()).padStart(2, '0');
            if (gameDate === `${yyyy}-${mm}-${dd}`) {
                return 'HIER';
            }
        }
    }

    // Any older date: render as "JJ MMM" using the same formatter
    // as the date picker's past entries.
    const parsed = new Date(`${gameDate}T12:00:00Z`);
    if (Number.isNaN(parsed.getTime())) {
        return '';
    }
    return SHORT_DATE_FORMATTER.format(parsed).toUpperCase();
}

// ---------------------------------------------------------------------
// Game card
// ---------------------------------------------------------------------

function GameCard({
    game,
    currentFantasyDate,
    expanded,
    expandedSide,
    boxscore,
    boxscoreLoading,
    ownershipByPlayerId,
    onToggle,
}: {
    game: GameDayGameSummary;
    currentFantasyDate: string;
    expanded: boolean;
    expandedSide: 'away' | 'home' | null;
    boxscore: NhlBoxscoreResponse | null;
    boxscoreLoading: boolean;
    ownershipByPlayerId: Map<number, PlayerOwnership>;
    onToggle: (gameId: number, side: 'away' | 'home') => void;
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
    const awayFillColor = getNhlTeamColor(game.awayAbbreviation);
    const awayStripColor = getNhlTeamAuraColor(game.awayAbbreviation);

    const homeFillColor = getNhlTeamColor(game.homeAbbreviation);
    const homeStripColor = getNhlTeamAuraColor(game.homeAbbreviation);

    // When this card is expanded, whichever side is NOT currently
    // being viewed is greyed out. This tells the user at a glance
    // which side's boxscore is on screen. When the card is
    // collapsed, neither side is dimmed.
    const awayDimmed = expanded && expandedSide === 'home';
    const homeDimmed = expanded && expandedSide === 'away';

    const awayScore = game.awayScore ?? 0;
    const homeScore = game.homeScore ?? 0;

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

    // Header label depends on game state.
    const headerLabel = scheduled
        ? 'MATCH À VENIR'
        : live
            ? 'EN DIRECT'
            : 'TERMINÉ';

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

    // Small caption under the big display: blank for scheduled and
    // final, period info for live.
    let smallCaption = '';
    if (live && game.periodNumber) {
        const periodSuffix =
            game.periodType === 'OT'
                ? 'Prol.'
                : game.periodType === 'SO'
                    ? 'TAB'
                    : `${game.periodNumber}e`;
        smallCaption = periodSuffix;
    }

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
            style={{
                borderColor: FRAME_BORDER,
                backgroundColor: FRAME_BG,
                boxShadow: live
                    ? '0 0 22px rgba(34, 197, 94, 0.35), inset 0 0 18px rgba(34, 197, 94, 0.08)'
                    : FRAME_GLOW,
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
                    stripColor={awayStripColor}
                    side='away'
                    dimmed={awayDimmed}
                />

                {/* Center column. Neutral navy with only the cyan
                    ambience, so it visually separates the two solid
                    team-colored sides. */}
                <div
                    className='relative flex min-w-0 flex-col items-center justify-center px-3 py-3 text-center'
                    style={{
                        backgroundColor: PANEL_BG,
                        backgroundImage:
                            'radial-gradient(ellipse at 50% 42%, rgba(0, 168, 255, 0.10) 0%, rgba(0, 168, 255, 0.03) 40%, transparent 75%)',
                    }}
                >
                    <div className='text-[0.55rem] font-bold uppercase tracking-widest text-[#7DD3FC]'>
                        {headerLabel}
                    </div>

                    <div className='mt-2 flex w-full items-center justify-center gap-2'>
                        <span
                            aria-hidden='true'
                            className='h-px flex-1'
                            style={{
                                maxWidth: 24,
                                background: awayStripColor,
                            }}
                        />
                        <span className='whitespace-nowrap text-[0.7rem] font-bold uppercase tracking-wider text-white'>
                            {dayLabel(game.gameDate, currentFantasyDate)}
                        </span>
                        <span
                            aria-hidden='true'
                            className='h-px flex-1'
                            style={{
                                maxWidth: 24,
                                background: homeStripColor,
                            }}
                        />
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
                                <span className='w-8 text-center text-[1.35rem] font-bold leading-tight text-white'>
                                    {awayScore}
                                </span>
                                <span className='text-[1.35rem] font-bold leading-tight text-white'>
                                    -
                                </span>
                                <span className='w-8 text-center text-[1.35rem] font-bold leading-tight text-white'>
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
                                    <div className='flex items-center justify-center gap-1 text-[0.7rem] font-semibold text-muted-foreground'>
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

                    {smallCaption && (
                        <div className='text-[0.6rem] font-semibold uppercase tracking-widest text-[#7DD3FC]'>
                            {smallCaption}
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
                    stripColor={homeStripColor}
                    side='home'
                    dimmed={homeDimmed}
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

    // Same aura channel as the MonEquipePage team picker, so the
    // admin appearance slider drives both at once.
    const neonAura = useAura('teamPickerLabel');

    useEffect(() => {
        isMountedRef.current = true;
        return () => {
            isMountedRef.current = false;
        };
    }, []);

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
    useEffect(() => {
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
                setData(result);
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
        // panel is shown. The scroll effect below will fire on the
        // expandedSide change.
        if (
            expandedGameId === gameId &&
            expandedSide !== side &&
            boxscore
        ) {
            pendingScrollToGameIdRef.current = gameId;
            setExpandedSide(side);
            return;
        }

        // Different game (or switching back to a game whose boxscore
        // was cleared) → fetch fresh.
        const requestId = ++boxscoreRequestIdRef.current;

        pendingScrollToGameIdRef.current = gameId;
        setExpandedGameId(gameId);
        setExpandedSide(side);
        setBoxscore(null);
        setOwnershipByPlayerId(new Map());
        setBoxscoreLoading(true);

        try {
            const result = await getGameBoxscore(gameId);

            if (
                !isMountedRef.current ||
                requestId !== boxscoreRequestIdRef.current
            ) {
                return;
            }

            setBoxscore(result);

            // Fetch the fantasy team ownership for every player in
            // this boxscore. One batch call, not one per player.
            const playerIds = collectBoxscorePlayerIds(result);

            const ownershipRows =
                await getPlayerOwnership(playerIds);

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
        } catch {
            // Non-fatal: the panel shows nothing.
        } finally {
            if (
                isMountedRef.current &&
                requestId === boxscoreRequestIdRef.current
            ) {
                setBoxscoreLoading(false);
            }
        }
    };

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
    useEffect(() => {
        const targetGameId = pendingScrollToGameIdRef.current;

        // Nothing pending, or the user moved on to a different game.
        if (targetGameId === null) return;

        if (expandedGameId !== targetGameId) {
            pendingScrollToGameIdRef.current = null;
            return;
        }

        // Wait for the panel to finish loading so we measure the
        // final layout height.
        if (boxscoreLoading) return;

        requestAnimationFrame(() => {
            requestAnimationFrame(() => {
                const el = document.getElementById(
                    `game-card-${targetGameId}`,
                );

                if (!el) {
                    pendingScrollToGameIdRef.current = null;
                    return;
                }

                // Read the sticky-header height from the CSS
                // variable published by Layout.tsx. Fall back to 64
                // if it is not set (e.g. during the very first
                // render), so the card never lands behind the header.
                const headerHeight =
                    parseFloat(
                        getComputedStyle(document.documentElement)
                            .getPropertyValue('--header-height'),
                    ) || 64;

                // Absolute Y of the card in the document.
                const cardTop =
                    window.scrollY + el.getBoundingClientRect().top;

                // Where we'd like to be: card's top just below the
                // header.
                const desiredScroll = Math.max(
                    0,
                    cardTop - headerHeight - 8,
                );

                // The maximum scroll the document actually allows.
                // This is where the min-h-dvh phantom height would
                // otherwise let the browser over-scroll into blank
                // space: clamp the target here and the card simply
                // stops partway up instead of creating an empty tail.
                const maxScroll = Math.max(
                    0,
                    document.documentElement.scrollHeight -
                    window.innerHeight,
                );

                const targetScroll = Math.min(
                    desiredScroll,
                    maxScroll,
                );

                window.scrollTo({
                    top: targetScroll,
                    behavior: 'smooth',
                });

                // Clear only after the scroll has been dispatched,
                // so the effect does not re-fire on unrelated
                // re-renders.
                pendingScrollToGameIdRef.current = null;
            });
        });
    }, [expandedGameId, expandedSide, boxscoreLoading, boxscore]);

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
        <section className='w-full space-y-4'>
            {/* ---- Date picker (mimics MonEquipePage team picker) ---- */}
            <div className='flex flex-col items-center gap-2'>
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
                        className='relative z-[60] mx-auto flex cursor-pointer items-center justify-center px-3 py-0.5 focus:outline-none focus-visible:outline-none'
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
                            className='absolute left-0 right-0 z-50 mt-1 max-h-72 overflow-y-auto rounded-lg border border-[#00E5FF]/50 bg-[#0F1626] shadow-[0_0_20px_rgba(0,229,255,0.35),0_8px_24px_rgba(0,0,0,0.6)] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden'
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
                            currentFantasyDate={currentFantasyDate}
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
                        />
                    ))}
                </div>
            )}
        </section>
    );
}