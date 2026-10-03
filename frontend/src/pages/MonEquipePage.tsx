import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { getLeagueTeams, getTeamRoster, type FantasyTeam, type RosterEntry, type TeamRoster } from '@/api/client';
import { PlayerCard } from '@/components/roster/PlayerCard';
import { RosterSection } from '@/components/roster/RosterSection';
import { NhlTeamLogo } from '@/components/nhl/NhlTeamLogo';
import { useAura } from '@/lib/auraContext';
import { getNhlTeamAuraColor } from '@/lib/nhlTeamColors';
import {
    auraPulseClass,
    auraPulseStyle,
    auraRangeFor,
    isAuraOff,
} from '@/lib/auraConfig';
import { consumePendingRestore } from '@/lib/scrollRestoration';
import { useAuth } from '@/lib/AuthContext';

function isActive(entry: RosterEntry): boolean {
    return entry.rosterStatus === 'Active';
}

function capPercentage(capSalary: number, salaryCap: number): number {
    if (salaryCap <= 0) return 0;
    const pct = (capSalary / salaryCap) * 100;
    return Math.max(0, Math.min(100, pct));
}

function trackColorClass(pct: number): string {
    if (pct > 90) return 'bg-rose-500';
    if (pct >= 75) return 'bg-yellow-300';
    return 'bg-lime-400';
}

function compactMillions(value: number): string {
    const millions = value / 1_000_000;
    const rounded = millions.toFixed(2).replace(/\.?0+$/, '');
    return `${rounded}M`;
}

// =====================================================================
// Lineup helpers
// =====================================================================

type LineupPositionGroup = 'F' | 'D' | 'G';

/**
 * Collapses any NHL / ESPN position spelling to a single-letter group
 * (F, D or G). Unknown positions default to 'F' so a player never
 * disappears from the lineup by accident.
 */
function toLineupPositionGroup(
    rawPosition: string | null | undefined,
): LineupPositionGroup {
    if (!rawPosition) return 'F';

    const n = rawPosition
        .trim()
        .toUpperCase()
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .replace(/\s+/g, ' ');

    if (
        n === 'G' ||
        n === 'GK' ||
        n === 'GB' ||
        n === 'GOALIE' ||
        n === 'GOALTENDER' ||
        n === 'GARDIEN' ||
        n === 'GARDIEN DE BUT'
    ) {
        return 'G';
    }

    if (
        n === 'D' ||
        n === 'LD' ||
        n === 'RD' ||
        n === 'DEFENSE' ||
        n === 'DEFENCE' ||
        n === 'DEFENSEMAN' ||
        n === 'DEFENCEMAN' ||
        n === 'DEFENSEUR' ||
        n === 'ARRIERE' ||
        n === 'LEFT DEFENSE' ||
        n === 'RIGHT DEFENSE'
    ) {
        return 'D';
    }

    return 'F';
}

/**
 * Color for the position letter. Matches the group: red for forwards,
 * blue for defensemen, green for goalies.
 */
function positionBorderColor(group: LineupPositionGroup): string {
    switch (group) {
        case 'F':
            return '#EF4444';
        case 'D':
            return '#3B82F6';
        case 'G':
            return '#22C55E';
    }
}

/**
 * Renders a daily FP value (hier / ajd) in the lineup tables.
 *   - null / undefined -> did not play. Rendered as "X" (muted grey).
 *   - 0               -> played, no points. Rendered as "0" (muted grey).
 *   - > 0             -> points scored. Rendered as "+N" (green).
 */
function renderDailyPoints(value: number | null | undefined) {
    if (value == null) {
        return <span className='text-muted-foreground'>X</span>;
    }

    if (value === 0) {
        return <span className='text-muted-foreground'>0</span>;
    }

    return <span className='text-[#22C55E]'>+{value}</span>;
}

/** Sort a list of roster entries by current-season fantasy points desc. */
function sortByFantasyPoints(entries: RosterEntry[]): RosterEntry[] {
    return [...entries].sort((a, b) => {
        const fa = a.currentSeason?.fantasyPoints ?? 0;
        const fb = b.currentSeason?.fantasyPoints ?? 0;
        return fb - fa;
    });
}

// =====================================================================
// Lineup components
// =====================================================================

// Grid layout per lineup row. The name column is `1fr` so it
// absorbs whatever is left after the fixed columns. Shrinking
// each stat column by 1px hands the name column 8px more room,
// which is enough to fit longer names without touching the row
// height.
const LINEUP_GRID_COLUMNS =
    'minmax(0, 1fr) 22px 29px 25px 25px 29px 25px 31px 31px 35px';

// Cyan separator glow, matching the segmented button accent
// (#00E5FF). Applied to the bottom border of the last row of a
// section so the separator takes no vertical space.
const LINEUP_SEPARATOR_GLOW =
    '0 2px 3px -1px rgba(0, 229, 255, 0.55), 0 3px 6px -2px rgba(0, 229, 255, 0.3)';

// Row background tints for the lineup tables. Applied via inline
// backgroundColor so they layer above the odd-row stripe. All three
// are desaturated and low-opacity so the row stays legible and the
// team-colored left border still reads.
//
//   injured   -> muted red     (player is injured or suspended)
//   ahl       -> muted blue    (player is on the AHL affiliate)
//   outOfNhl  -> muted grey    (player is not on any active NHL/AHL roster)
const LINEUP_ROW_TINT = {
    injured: 'rgba(220, 95, 95, 0.22)',
    ahl: 'rgba(125, 190, 240, 0.30)',
    outOfNhl: 'rgba(155, 155, 162, 0.22)',
} as const;

function LineupHeader({ isGoalie }: { isGoalie: boolean }) {
    return (
        <div
            className={`grid w-full items-center gap-x-0.5 border-b border-border/40 pb-0.5 pl-1 uppercase tracking-wide text-white ${isGoalie ? 'mt-3 text-xs' : 'text-sm'
                }`}
            style={{
                gridTemplateColumns: LINEUP_GRID_COLUMNS,
                borderLeft: '2px solid transparent',
            }}
        >
            {/* The name and logo columns have no header labels on
                purpose: the user already knows what they are. The
                cells stay empty so the grid columns still line up
                with the rows beneath. */}
            <div className='text-left' />
            <div />
            <div className='text-center text-[#7DD3FC]'>GP</div>
            {isGoalie ? (
                <>
                    <div className='text-center text-[#00F0FF]'>W</div>
                    <div className='text-center'>L</div>
                    <div className='text-center'>OTL</div>
                    <div className='text-center'>SO</div>
                </>
            ) : (
                <>
                    <div className='text-center'>G</div>
                    <div className='text-center'>A</div>
                    <div className='text-center text-[#00F0FF]'>PTS</div>
                    <div className='text-center'>3B</div>
                </>
            )}
            {/* Hier / Ajd headers are one step smaller than the
                rest of the header row so the daily columns feel
                secondary to the season columns. text-[0.7rem] is
                smaller than both text-sm (skater header) and
                text-xs (goalie header), so the reduction shows in
                both tables. */}
            <div className='text-center text-[0.7rem]'>Hier</div>
            <div className='text-center text-[0.7rem]'>Ajd</div>
            <div className='text-center text-[#F59E0B]'>FP</div>
        </div>
    );
}

function LineupRow({
    entry,
    isLastOfSection,
}: {
    entry: RosterEntry;
    isLastOfSection: boolean;
}) {
    const group = toLineupPositionGroup(entry.position);
    const isGoalie = group === 'G';
    const s = entry.currentSeason;

    const gp = s?.gamesPlayed ?? 0;
    const g = s?.goals ?? 0;
    const a = s?.assists ?? 0;
    const pts = s?.points ?? 0;
    const ht = s?.hatTricks ?? 0;
    const w = s?.wins ?? 0;
    const l = s?.losses ?? 0;
    const otl = s?.overtimeLosses ?? 0;
    const so = s?.shutouts ?? 0;
    const fp = s?.fantasyPoints ?? 0;

    const initial = entry.firstName.trim().charAt(0).toUpperCase();
    const shortName = initial
        ? `${initial}. ${entry.lastName}`
        : entry.lastName;

    // Aura-only color for this row: drives the logo glow and the
    // name text-shadow. Falls back to the base team color for teams
    // with no aura override, and to the league cyan when the
    // abbreviation is unknown. The row background uses the default
    // page color; only the glows are team-tinted.
    const teamAuraColor = getNhlTeamAuraColor(entry.nhlTeamAbbreviation);

    // Row background tint, chosen from the player's current status.
    // Priority (top wins):
    //   1. Injured   -> muted red
    //   2. AhlRoster -> muted blue
    //   3. NotOnActiveRoster -> muted grey
    //   4. otherwise (NHL roster, or RosterLocation null) -> no tint,
    //      falls back to the default row background.
    let rowTint: string | undefined;

    if (entry.isInjured) {
        rowTint = LINEUP_ROW_TINT.injured;
    } else if (entry.rosterLocation === 'AhlRoster') {
        rowTint = LINEUP_ROW_TINT.ahl;
    } else if (entry.rosterLocation === 'NotOnActiveRoster') {
        rowTint = LINEUP_ROW_TINT.outOfNhl;
    }

    return (
        <Link
            to={`/joueurs/${entry.nhlPlayerId}`}
            className='grid w-full items-center gap-x-0.5 border-b border-border/20 py-0.5 pl-1 text-base tabular-nums transition-[filter] duration-150 hover:brightness-110'
            style={{
                gridTemplateColumns: LINEUP_GRID_COLUMNS,
                borderLeft: `2px solid ${positionBorderColor(group)}`,
                borderBottomColor: isLastOfSection
                    ? 'rgba(0, 229, 255, 0.6)'
                    : undefined,
                boxShadow: isLastOfSection
                    ? LINEUP_SEPARATOR_GLOW
                    : undefined,
                backgroundColor: rowTint,
            }}
        >
            <div className='truncate pl-0.5 text-left text-foreground'>
                {shortName}
            </div>

            {/* Small glow behind the team logo, tinted with the
                team's AURA color (brighter than the base color for
                dark teams like UTA / SEA / TBL). The `8C` suffix is
                ~55% alpha on the 6-digit hex. */}
            <div
                className='flex justify-center'
                style={{
                    filter: `drop-shadow(0 0 3px ${teamAuraColor}8C)`,
                }}
            >
                <NhlTeamLogo
                    abbreviation={entry.nhlTeamAbbreviation}
                    size={20}
                />
            </div>

            <div className='text-center text-[#7DD3FC]'>{gp}</div>

            {isGoalie ? (
                <>
                    <div className='text-center text-[#00F0FF]'>{w}</div>
                    <div className='text-center'>{l}</div>
                    <div className='text-center'>{otl}</div>
                    <div className='text-center'>{so}</div>
                </>
            ) : (
                <>
                    <div className='text-center'>{g}</div>
                    <div className='text-center'>{a}</div>
                    <div className='text-center text-[#00F0FF]'>{pts}</div>
                    <div className='text-center'>{ht}</div>
                </>
            )}

            <div className='text-center'>
                {renderDailyPoints(entry.yesterdayFantasyPoints)}
            </div>
            <div className='text-center'>
                {renderDailyPoints(entry.todayFantasyPoints)}
            </div>

            <div className='text-center font-bold text-[#F59E0B]'>{fp}</div>
        </Link>
    );
}

/**
 * One lineup block (Alignement, Banc or Prospects). Renders an inline
 * skater header, the forwards, an optional separator, the defensemen,
 * another optional separator, then a goalie header and the goalies.
 *
 * Separators are only rendered when showSeparators is true (Alignement
 * and Banc). Prospects intentionally have none.
 */
function LineupTable({
    forwards,
    defensemen,
    goalies,
    showSeparators,
}: {
    forwards: RosterEntry[];
    defensemen: RosterEntry[];
    goalies: RosterEntry[];
    showSeparators: boolean;
}) {
    const hasSkaters = forwards.length > 0 || defensemen.length > 0;
    const hasGoalies = goalies.length > 0;

    if (!hasSkaters && !hasGoalies) {
        return null;
    }

    return (
        <div className='w-full'>
            {hasSkaters && <LineupHeader isGoalie={false} />}

            {forwards.map((entry, i) => {
                const isLast = i === forwards.length - 1;
                const needsLine =
                    isLast && (defensemen.length > 0 || hasGoalies);

                return (
                    <LineupRow
                        key={entry.id}
                        entry={entry}
                        isLastOfSection={showSeparators && needsLine}
                    />
                );
            })}

            {defensemen.map((entry, i) => {
                const isLast = i === defensemen.length - 1;
                const needsLine = isLast && hasGoalies;

                return (
                    <LineupRow
                        key={entry.id}
                        entry={entry}
                        isLastOfSection={showSeparators && needsLine}
                    />
                );
            })}

            {hasGoalies && (
                <>
                    <LineupHeader isGoalie={true} />
                    {goalies.map((entry) => (
                        <LineupRow
                            key={entry.id}
                            entry={entry}
                            isLastOfSection={false}
                        />
                    ))}
                </>
            )}
        </div>
    );
}

// =====================================================================
// The page
// =====================================================================

export default function MonEquipePage() {
    const { user, loading: authLoading } = useAuth();

    const [searchParams, setSearchParams] = useSearchParams();
    const teamIdParam = searchParams.get('teamId');

    const [isTeamPickerOpen, setIsTeamPickerOpen] = useState(false);
    const teamPickerRef = useRef<HTMLDivElement>(null);

    const [activeView, setActiveView] = useState<'lineup' | 'cap'>(
        'lineup',
    );

    const [teams, setTeams] = useState<FantasyTeam[]>([]);

    const teamId = useMemo<number | null>(() => {
        if (teamIdParam) {
            const parsed = Number(teamIdParam);
            return Number.isFinite(parsed) ? parsed : null;
        }
        return user?.fantasyTeamId ?? null;
    }, [teamIdParam, user?.fantasyTeamId]);

    const [roster, setRoster] = useState<TeamRoster | null>(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);

    const trackAura = useAura('capBarTrack');

    const selectedTeamLabel = (() => {
        if (teamIdParam != null) {
            const selected = teams.find(
                (t) => String(t.id) === teamIdParam,
            );
            return selected?.name ?? 'Mon equipe';
        }
        return 'Mon equipe';
    })();

    // Same palette as the league logo aura in TopBar.tsx: white core
    // -> league cyan (#00A8FF) -> cyan -> soft cyan bleed. Alphas are
    // pushed to full at the rest side of the pulse so the aura reads
    // as clearly on as it does at the peak, rather than fading away
    // halfway through the cycle.
    const neonAura = useAura('teamPickerLabel');

    const neonRest = [
        `0 0 ${auraRangeFor(neonAura, 'teamPickerLabel', 0).toFixed(2)}px #F2F5FA`,
        `0 0 ${auraRangeFor(neonAura, 'teamPickerLabel', 1).toFixed(2)}px #00A8FF`,
        `0 0 ${auraRangeFor(neonAura, 'teamPickerLabel', 2).toFixed(2)}px rgba(0, 168, 255, 0.85)`,
        `0 0 ${auraRangeFor(neonAura, 'teamPickerLabel', 3).toFixed(2)}px rgba(0, 168, 255, 0.55)`,
    ].join(', ');

    const neonPeak = [
        `0 0 ${auraRangeFor(neonAura, 'teamPickerLabel', 0).toFixed(2)}px #F2F5FA`,
        `0 0 ${auraRangeFor(neonAura, 'teamPickerLabel', 1).toFixed(2)}px #00A8FF`,
        `0 0 ${auraRangeFor(neonAura, 'teamPickerLabel', 2).toFixed(2)}px #00A8FF`,
        `0 0 ${auraRangeFor(neonAura, 'teamPickerLabel', 3).toFixed(2)}px rgba(0, 168, 255, 0.85)`,
    ].join(', ');

    const neonAuraOn = !isAuraOff(neonAura);

    useEffect(() => {
        let cancelled = false;

        getLeagueTeams()
            .then((data) => {
                if (!cancelled) {
                    setTeams(data);
                }
            })
            .catch(() => {
                // Not fatal; the dropdown just won't populate.
            });

        return () => {
            cancelled = true;
        };
    }, []);

    useEffect(() => {
        if (!isTeamPickerOpen) return;

        function onMouseDown(event: MouseEvent) {
            if (
                teamPickerRef.current &&
                !teamPickerRef.current.contains(event.target as Node)
            ) {
                setIsTeamPickerOpen(false);
            }
        }

        function onKeyDown(event: KeyboardEvent) {
            if (event.key === 'Escape') {
                setIsTeamPickerOpen(false);
            }
        }

        document.addEventListener('mousedown', onMouseDown);
        document.addEventListener('keydown', onKeyDown);

        return () => {
            document.removeEventListener('mousedown', onMouseDown);
            document.removeEventListener('keydown', onKeyDown);
        };
    }, [isTeamPickerOpen]);

    useEffect(() => {
        if (teamId == null) {
            setRoster(null);
            setLoading(false);
            setError(null);
            return;
        }

        let cancelled = false;

        setLoading(true);
        setError(null);

        getTeamRoster(teamId)
            .then((data) => {
                if (!cancelled) {
                    setRoster(data);
                }
            })
            .catch(() => {
                if (!cancelled) {
                    setError('Vérifiez que le serveur API est démarré.');
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
    }, [teamId]);

    useEffect(() => {
        if (!roster) {
            return;
        }

        const pending = consumePendingRestore();

        if (!pending) {
            return;
        }

        const frame = requestAnimationFrame(() => {
            if (pending.scrollY > 0) {
                window.scrollTo({
                    top: pending.scrollY,
                    behavior: 'auto',
                });
                return;
            }

            if (pending.cardId) {
                const element = document.getElementById(pending.cardId);

                if (element) {
                    element.scrollIntoView({
                        block: 'start',
                        behavior: 'auto',
                    });
                }
            }
        });

        return () => cancelAnimationFrame(frame);
    }, [roster]);

    function handleTeamChange(newTeamId: string) {
        if (newTeamId === '') {
            setSearchParams({});
            return;
        }

        setSearchParams({ teamId: newTeamId });
    }

    if (!authLoading && user != null && teamId == null) {
        return (
            <section className='space-y-4'>
                <h2 className='text-center text-2xl font-semibold text-foreground'>
                    Mon equipe
                </h2>
                <p className='text-center text-muted-foreground'>
                    Aucune equipe ne vous a encore été assignée. Le
                    commissaire doit vous assigner une equipe avant que
                    vous puissiez la voir.
                </p>
            </section>
        );
    }

    if (loading || authLoading) {
        return <p className='text-muted-foreground'>Chargement...</p>;
    }

    if (error) return <p className='text-destructive'>{error}</p>;
    if (!roster) return null;

    // Main/bench group membership + sort. Forwards and defensemen are
    // sorted by FP descending; goalies are sorted by FP descending too
    // (there is only one, but the code stays generic).
    const activeEntries = roster.entries.filter(isActive);
    const benchEntries = roster.entries.filter(
        (entry) => entry.rosterStatus === 'Bench',
    );
    const prospectEntries = roster.entries.filter(
        (entry) => entry.rosterStatus === 'Prospect',
    );

    const mainForwards = sortByFantasyPoints(
        activeEntries.filter(
            (entry) => toLineupPositionGroup(entry.position) === 'F',
        ),
    );
    const mainDefensemen = sortByFantasyPoints(
        activeEntries.filter(
            (entry) => toLineupPositionGroup(entry.position) === 'D',
        ),
    );
    const mainGoalies = sortByFantasyPoints(
        activeEntries.filter(
            (entry) => toLineupPositionGroup(entry.position) === 'G',
        ),
    );

    const benchForwards = sortByFantasyPoints(
        benchEntries.filter(
            (entry) => toLineupPositionGroup(entry.position) === 'F',
        ),
    );
    const benchDefensemen = sortByFantasyPoints(
        benchEntries.filter(
            (entry) => toLineupPositionGroup(entry.position) === 'D',
        ),
    );
    const benchGoalies = sortByFantasyPoints(
        benchEntries.filter(
            (entry) => toLineupPositionGroup(entry.position) === 'G',
        ),
    );

    // Prospects: sorted by position only (F, then D, then G). Within a
    // group, the original order is preserved. No separators.
    const prospectForwards = prospectEntries.filter(
        (entry) => toLineupPositionGroup(entry.position) === 'F',
    );
    const prospectDefensemen = prospectEntries.filter(
        (entry) => toLineupPositionGroup(entry.position) === 'D',
    );
    const prospectGoalies = prospectEntries.filter(
        (entry) => toLineupPositionGroup(entry.position) === 'G',
    );

    const forwards = activeEntries.filter(
        (entry) => entry.position !== 'D' && entry.position !== 'G',
    );
    const defensemen = activeEntries.filter(
        (entry) => entry.position === 'D',
    );
    const goalies = activeEntries.filter(
        (entry) => entry.position === 'G',
    );
    const bench = benchEntries;
    const prospects = prospectEntries;

    const maxSignedPlayers =
        roster.leagueMaximumRosterSize - roster.leagueProspectCount;

    const trackRest = [
        `0 0 ${auraRangeFor(trackAura, 'capBarTrack', 0).toFixed(2)}px rgba(0, 168, 255, 0.7)`,
        `0 0 ${auraRangeFor(trackAura, 'capBarTrack', 1).toFixed(2)}px rgba(0, 168, 255, 0.55)`,
        `0 0 ${auraRangeFor(trackAura, 'capBarTrack', 2).toFixed(2)}px rgba(0, 168, 255, 0.3)`,
    ].join(', ');

    const trackPeak = [
        `0 0 ${auraRangeFor(trackAura, 'capBarTrack', 0).toFixed(2)}px rgba(0, 168, 255, 0.95)`,
        `0 0 ${auraRangeFor(trackAura, 'capBarTrack', 1).toFixed(2)}px rgba(0, 168, 255, 0.75)`,
        `0 0 ${auraRangeFor(trackAura, 'capBarTrack', 2).toFixed(2)}px rgba(0, 168, 255, 0.45)`,
    ].join(', ');

    const otherTeams = teams.filter((t) => t.id !== user?.fantasyTeamId);

    return (
        <section className='-mt-4 space-y-4 sm:-mt-6'>
            {/* The picker sits flush under the sticky header on this
                page. main (Layout.tsx) adds py-4/sm:py-6 top padding
                for every other page; the -mt-4/sm:-mt-6 here cancels
                that padding entirely, so the picker touches the
                navbar. If main's top padding is ever changed, update
                these values to match. */}
            <div className='flex flex-col items-center gap-3'>
                <div className='flex w-full flex-col items-center gap-2'>
                    <div
                        ref={teamPickerRef}
                        className='relative w-full'
                    >
                        {/* z-[60] lifts the picker (and its aura)
                            above the sticky header in Layout.tsx,
                            which sits at z-50. Without this, the
                            top of the label's text-shadow gets
                            painted under the header's opaque
                            background instead of over it. */}
                        {/* z-[60] lifts the picker (and its aura)
                            above the sticky header in Layout.tsx,
                            which sits at z-50. The portalized
                            search popup (z-70) and the Sheet
                            (z-70) still render above the picker,
                            so both remain usable. */}
                        <button
                            type='button'
                            aria-haspopup='listbox'
                            aria-expanded={isTeamPickerOpen}
                            aria-label='Choisir une equipe'
                            onClick={() => setIsTeamPickerOpen((v) => !v)}
                            className='relative z-[60] mx-auto flex cursor-pointer items-center justify-center px-3 py-0.5 focus:outline-none focus-visible:outline-none'
                        >
                            {/* Label is the only flex child, so it
                                centers on the button width. The caret
                                is absolutely positioned at the right
                                edge of the label, so it never shifts
                                the label off-center. */}
                            <span className='relative inline-block'>
                                {/* Neon-outline label: the fill is the
                                    page background color so the glow
                                    only shows around the outside of
                                    each glyph, and the stroke draws
                                    the tube itself. `paintOrder:
                                    stroke fill` makes the stroke
                                    render on top of the fill so the
                                    outline stays crisp at every
                                    zoom level.

                                    Geist Variable at weight 900
                                    (Black) is heavier than Rajdhani
                                    700 and gives the tube more
                                    horizontal mass, which reads
                                    closer to a real bar-sign. The
                                    stroke is backed off to 1.5px
                                    because the glyphs are already
                                    thick enough to hollow out. */}
                                <span
                                    className={`text-2xl leading-none tracking-[0.02em] ${neonAuraOn ? auraPulseClass('text') : ''
                                        }`}
                                    style={{
                                        fontFamily: "'Grindy Brush', sans-serif",
                                        fontWeight: 400,
                                        color: '#FFFFFF',
                                        WebkitTextStrokeWidth: '3.5px',
                                        WebkitTextStrokeColor: '#AF1E2D',
                                        paintOrder: 'stroke fill',
                                        ...(neonAuraOn
                                            ? auraPulseStyle(neonRest, neonPeak)
                                            : {}),
                                    } as React.CSSProperties}
                                >
                                    {selectedTeamLabel}
                                </span>

                                {/* Full solid yellow triangle (▼).
                                    Same yellow and same two-layer
                                    drop-shadow as the label, so
                                    the caret reads as part of the
                                    same tube. */}
                                {/* Caret matches the label: white fill,
                                    red stroke, same pulsing aura. The
                                    stroke is thinner than the label's
                                    (1px vs 1.5px) because the caret
                                    renders at text-sm, and 1.5px
                                    would close the triangle up at
                                    that size. */}
                                <span
                                    aria-hidden='true'
                                    className={`pointer-events-none absolute left-full top-1/2 ml-2 inline-block text-sm leading-none transition-transform duration-200 ${neonAuraOn ? auraPulseClass('text') : ''
                                        }`}
                                    style={{
                                        transform: isTeamPickerOpen
                                            ? 'translateY(-50%) rotate(180deg)'
                                            : 'translateY(-50%) rotate(0deg)',
                                        color: '#FFFFFF',
                                        WebkitTextStrokeWidth: '1px',
                                        WebkitTextStrokeColor: '#AF1E2D',
                                        paintOrder: 'stroke fill',
                                        ...(neonAuraOn
                                            ? auraPulseStyle(neonRest, neonPeak)
                                            : {}),
                                    } as React.CSSProperties}
                                >
                                    ▼
                                </span>
                            </span>
                        </button>

                        {isTeamPickerOpen && (
                            <ul
                                role='listbox'
                                className='absolute left-0 right-0 z-50 mt-1 max-h-72 overflow-y-auto rounded-lg border border-[#00E5FF]/50 bg-[#0F1626] shadow-[0_0_20px_rgba(0,229,255,0.35),0_8px_24px_rgba(0,0,0,0.6)] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden'
                            >
                                {user?.fantasyTeamId != null && (
                                    <li>
                                        <button
                                            type='button'
                                            role='option'
                                            aria-selected={teamIdParam == null}
                                            onClick={() => {
                                                handleTeamChange('');
                                                setIsTeamPickerOpen(false);
                                            }}
                                            className={`w-full cursor-pointer border-b border-[#00E5FF]/15 px-4 py-2.5 text-center text-lg font-semibold transition-colors ${teamIdParam == null
                                                ? 'bg-[#00E5FF]/20 text-[#00E5FF]'
                                                : 'text-foreground hover:bg-[#00E5FF]/10 hover:text-[#00E5FF]'
                                                }`}
                                        >
                                            Mon equipe
                                        </button>
                                    </li>
                                )}

                                {otherTeams.map((team) => {
                                    const isSelected =
                                        teamIdParam === String(team.id);

                                    return (
                                        <li key={team.id}>
                                            <button
                                                type='button'
                                                role='option'
                                                aria-selected={isSelected}
                                                onClick={() => {
                                                    handleTeamChange(String(team.id));
                                                    setIsTeamPickerOpen(false);
                                                }}
                                                className={`w-full cursor-pointer px-4 py-2.5 text-center text-lg font-semibold transition-colors ${isSelected
                                                    ? 'bg-[#00E5FF]/20 text-[#00E5FF]'
                                                    : 'text-foreground hover:bg-[#00E5FF]/10 hover:text-[#00E5FF]'
                                                    }`}
                                            >
                                                {team.name}
                                            </button>
                                        </li>
                                    );
                                })}
                            </ul>
                        )}
                    </div>
                </div>

                <div className='flex w-full flex-col items-center gap-2'>
                    {/* Same palette as the dropdown label:
                        container -> cyan border + cyan aura (matches
                        the label's glow chain, #F2F5FA / #00A8FF).
                        Active button -> white fill + deep navy text
                        (#1D1B61) with a small cyan aura around the
                        label so the two read as the same material.
                        Inactive button -> white text, cyan hover. */}
                    <div
                        className='flex w-full items-center rounded-full border border-[#00A8FF] bg-[#050A18] p-0.5'
                        style={{
                            boxShadow:
                                '0 0 8px rgba(0, 168, 255, 0.7), 0 0 18px rgba(0, 168, 255, 0.45), 0 0 30px rgba(0, 168, 255, 0.2), inset 0 0 8px rgba(0, 168, 255, 0.15)',
                        }}
                    >
                        <button
                            type='button'
                            onClick={() => setActiveView('lineup')}
                            className={`flex-1 cursor-pointer rounded-full px-3 py-0.5 text-sm font-bold transition-all duration-200 ${activeView === 'lineup'
                                ? 'bg-white text-[#1D1B61]'
                                : 'bg-transparent text-[#F2F5FA] hover:bg-[#00A8FF]/15 hover:text-white'
                                }`}
                            style={
                                activeView === 'lineup'
                                    ? {
                                        boxShadow:
                                            '0 0 6px rgba(255, 255, 255, 0.9), 0 0 14px rgba(0, 168, 255, 0.75), 0 0 28px rgba(0, 168, 255, 0.45), 0 0 44px rgba(0, 168, 255, 0.2), inset 0 0 4px rgba(0, 168, 255, 0.35)',
                                        textShadow:
                                            '0 0 3px rgba(0, 168, 255, 0.9), 0 0 6px rgba(0, 168, 255, 0.5)',
                                    }
                                    : undefined
                            }
                        >
                            Lineup
                        </button>

                        <button
                            type='button'
                            onClick={() => setActiveView('cap')}
                            className={`flex-1 cursor-pointer rounded-full px-3 py-0.5 text-sm font-bold transition-all duration-200 ${activeView === 'cap'
                                ? 'bg-white text-[#1D1B61]'
                                : 'bg-transparent text-[#F2F5FA] hover:bg-[#00A8FF]/15 hover:text-white'
                                }`}
                            style={
                                activeView === 'cap'
                                    ? {
                                        boxShadow:
                                            '0 0 6px rgba(255, 255, 255, 0.9), 0 0 14px rgba(0, 168, 255, 0.75), 0 0 28px rgba(0, 168, 255, 0.45), 0 0 44px rgba(0, 168, 255, 0.2), inset 0 0 4px rgba(0, 168, 255, 0.35)',
                                        textShadow:
                                            '0 0 3px rgba(0, 168, 255, 0.9), 0 0 6px rgba(0, 168, 255, 0.5)',
                                    }
                                    : undefined
                            }
                        >
                            Masse salariale
                        </button>
                    </div>
                </div>
            </div>

            {activeView === 'lineup' && (
                <>
                    <LineupTable
                        forwards={mainForwards}
                        defensemen={mainDefensemen}
                        goalies={mainGoalies}
                        showSeparators
                    />

                    <RosterSection title='Banc'>
                        <LineupTable
                            forwards={benchForwards}
                            defensemen={benchDefensemen}
                            goalies={benchGoalies}
                            showSeparators
                        />
                    </RosterSection>

                    <RosterSection title='Prospects'>
                        <LineupTable
                            forwards={prospectForwards}
                            defensemen={prospectDefensemen}
                            goalies={prospectGoalies}
                            showSeparators={false}
                        />
                    </RosterSection>
                </>
            )}

            {activeView === 'cap' && (
                <>
                    {roster.futureCapBySeason.length > 0 && (
                        <div className='w-full'>
                            <div className='space-y-2'>
                                {roster.futureCapBySeason.map((row) => {
                                    const pct = capPercentage(row.capSalary, row.salaryCap);
                                    const available = Math.max(0, row.salaryCap - row.capSalary);

                                    return (
                                        <div key={row.nhlSeasonCode}>
                                            <div className='flex items-center gap-3'>
                                                <span className='w-12 shrink-0 text-xs font-medium text-foreground'>
                                                    {row.label}
                                                </span>

                                                <div
                                                    className={`relative h-3 flex-1 overflow-hidden rounded ${trackColorClass(pct)} ${!isAuraOff(trackAura)
                                                        ? auraPulseClass('box')
                                                        : ''
                                                        }`}
                                                    style={
                                                        !isAuraOff(trackAura)
                                                            ? auraPulseStyle(trackRest, trackPeak)
                                                            : undefined
                                                    }
                                                >
                                                    <div
                                                        className='h-full rounded bg-cyan-400 transition-[width]'
                                                        style={{ width: `${pct}%` }}
                                                    />
                                                </div>
                                            </div>

                                            <div className='mt-1 flex items-center justify-between pl-15 text-xs text-white'>
                                                <span>
                                                    {maxSignedPlayers > 0
                                                        ? `${row.signedPlayers}/${maxSignedPlayers} sous contrats`
                                                        : `${row.signedPlayers} sous contrats`}
                                                </span>

                                                <span>
                                                    {available > 0
                                                        ? `${compactMillions(available)} $ disponible`
                                                        : '0 $ disponible'}
                                                </span>
                                            </div>
                                        </div>
                                    );
                                })}
                            </div>
                        </div>
                    )}

                    <RosterSection title='Attaquants' count={forwards.length} spacing='compact'>
                        <div className='grid grid-cols-1 gap-3 md:grid-cols-3'>
                            {forwards.map((entry) => (
                                <PlayerCard key={entry.id} entry={entry} />
                            ))}
                        </div>
                    </RosterSection>

                    <RosterSection title='Défenseurs' count={defensemen.length} spacing='large'>
                        <div className='mx-auto grid w-full grid-cols-1 gap-3 md:w-2/3 md:grid-cols-2'>
                            {defensemen.map((entry) => (
                                <PlayerCard key={entry.id} entry={entry} />
                            ))}
                        </div>
                    </RosterSection>

                    <RosterSection title='Gardiens' count={goalies.length} spacing='large'>
                        <div className='mx-auto w-full md:w-1/3 md:min-w-[260px]'>
                            {goalies.map((entry) => (
                                <PlayerCard
                                    key={entry.id}
                                    entry={entry}
                                />
                            ))}
                        </div>
                    </RosterSection>

                    <RosterSection title='Banc' count={bench.length} spacing='large'>
                        <div className='grid grid-cols-1 gap-3 md:grid-cols-3'>
                            {bench.map((entry) => (
                                <PlayerCard key={entry.id} entry={entry} />
                            ))}
                        </div>
                    </RosterSection>

                    <RosterSection title='Prospects' count={prospects.length} spacing='large'>
                        <div className='grid grid-cols-1 gap-3 md:grid-cols-3'>
                            {prospects.map((entry) => (
                                <PlayerCard key={entry.id} entry={entry} />
                            ))}
                        </div>
                    </RosterSection>
                </>
            )}
        </section>
    );
}