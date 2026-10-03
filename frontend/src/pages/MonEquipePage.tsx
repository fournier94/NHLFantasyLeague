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

// Single source of truth for the lineup table columns. Kept in a
// constant so the header and the rows cannot drift apart.
//
// Order: Name | Pos | (logo) | GP | G/W | A/L | PTS/OTL | 3B/SO | FP
// Column widths are sized for a ~16px row font and a 20px team logo.
const LINEUP_GRID_COLUMNS =
    'minmax(0, 1fr) 24px 30px 28px 28px 32px 28px 36px';

// Cyan separator glow, matching the segmented button accent
// (#00E5FF). Applied to the bottom border of the last row of a
// section so the separator takes no vertical space.
const LINEUP_SEPARATOR_GLOW =
    '0 2px 3px -1px rgba(0, 229, 255, 0.55), 0 3px 6px -2px rgba(0, 229, 255, 0.3)';

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

    return (
        <Link
            to={`/joueurs/${entry.nhlPlayerId}`}
            className='grid w-full items-center gap-x-0.5 border-b border-border/20 py-0.5 pl-1 text-base tabular-nums transition-colors odd:bg-white/[0.015] hover:bg-secondary/30'
            style={{
                gridTemplateColumns: LINEUP_GRID_COLUMNS,
                borderLeft: `2px solid ${positionBorderColor(group)}`,
                borderBottomColor: isLastOfSection
                    ? 'rgba(0, 229, 255, 0.6)'
                    : undefined,
                boxShadow: isLastOfSection
                    ? LINEUP_SEPARATOR_GLOW
                    : undefined,
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

    // Neon-sign aura for the team-picker label. Driven by the
    // 'teamPickerLabel' channel in auraConfig.ts. Four layers, in
    // order: tight white core, light cyan inner glow, mid blue glow,
    // wide soft blue halo.
    const neonAura = useAura('teamPickerLabel');

    const neonRest = [
        `0 0 ${auraRangeFor(neonAura, 'teamPickerLabel', 0).toFixed(2)}px rgba(255, 255, 255, 0.9)`,
        `0 0 ${auraRangeFor(neonAura, 'teamPickerLabel', 1).toFixed(2)}px rgba(176, 229, 255, 0.85)`,
        `0 0 ${auraRangeFor(neonAura, 'teamPickerLabel', 2).toFixed(2)}px rgba(0, 168, 255, 0.7)`,
        `0 0 ${auraRangeFor(neonAura, 'teamPickerLabel', 3).toFixed(2)}px rgba(0, 168, 255, 0.4)`,
    ].join(', ');

    const neonPeak = [
        `0 0 ${auraRangeFor(neonAura, 'teamPickerLabel', 0).toFixed(2)}px rgba(255, 255, 255, 1)`,
        `0 0 ${auraRangeFor(neonAura, 'teamPickerLabel', 1).toFixed(2)}px rgba(200, 240, 255, 1)`,
        `0 0 ${auraRangeFor(neonAura, 'teamPickerLabel', 2).toFixed(2)}px rgba(0, 168, 255, 0.95)`,
        `0 0 ${auraRangeFor(neonAura, 'teamPickerLabel', 3).toFixed(2)}px rgba(0, 168, 255, 0.7)`,
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
                        <button
                            type='button'
                            aria-haspopup='listbox'
                            aria-expanded={isTeamPickerOpen}
                            aria-label='Choisir une equipe'
                            onClick={() => setIsTeamPickerOpen((v) => !v)}
                            className='relative mx-auto flex cursor-pointer items-center justify-center px-3 py-0.5 focus:outline-none focus-visible:outline-none'
                        >
                            {/* Label is the only flex child, so it
                                centers on the button width. The caret
                                is absolutely positioned at the right
                                edge of the label, so it never shifts
                                the label off-center. */}
                            <span className='relative inline-block'>
                                <span
                                    className={`text-2xl leading-none ${neonAuraOn ? auraPulseClass('text') : ''
                                        }`}
                                    style={{
                                        fontFamily: "'Coors Script', cursive",
                                        color: '#B0E0FF',
                                        ...(neonAuraOn
                                            ? auraPulseStyle(neonRest, neonPeak)
                                            : {}),
                                    }}
                                >
                                    {selectedTeamLabel}
                                </span>

                                <span
                                    aria-hidden='true'
                                    className='pointer-events-none absolute left-full top-1/2 ml-2 inline-block text-sm leading-none text-[#00E5FF] transition-transform duration-200'
                                    style={{
                                        transform: isTeamPickerOpen
                                            ? 'translateY(-50%) rotate(180deg)'
                                            : 'translateY(-50%) rotate(0deg)',
                                        filter:
                                            'drop-shadow(0 0 4px rgba(0, 229, 255, 0.7))',
                                    }}
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
                    <div className='flex w-full items-center rounded-full border border-[#00E5FF] bg-[#080D1A] p-0.5'>
                        <button
                            type='button'
                            onClick={() => setActiveView('lineup')}
                            className={`flex-1 cursor-pointer rounded-full px-3 py-0.5 text-sm font-bold transition-colors ${activeView === 'lineup'
                                ? 'bg-[#00E5FF] text-[#080D1A]'
                                : 'bg-transparent text-[#8DE5FF] hover:bg-[#00E5FF]/10'
                                }`}
                        >
                            Lineup
                        </button>

                        <button
                            type='button'
                            onClick={() => setActiveView('cap')}
                            className={`flex-1 cursor-pointer rounded-full px-3 py-0.5 text-sm font-bold transition-colors ${activeView === 'cap'
                                ? 'bg-[#00E5FF] text-[#080D1A]'
                                : 'bg-transparent text-[#8DE5FF] hover:bg-[#00E5FF]/10'
                                }`}
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
                        <RosterSection title='Masse salariale'>
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
                        </RosterSection>
                    )}

                    <RosterSection title='Attaquants' count={forwards.length}>
                        <div className='grid grid-cols-1 gap-3 md:grid-cols-3'>
                            {forwards.map((entry) => (
                                <PlayerCard key={entry.id} entry={entry} />
                            ))}
                        </div>
                    </RosterSection>

                    <RosterSection title='Défenseurs' count={defensemen.length}>
                        <div className='mx-auto grid w-full grid-cols-1 gap-3 md:w-2/3 md:grid-cols-2'>
                            {defensemen.map((entry) => (
                                <PlayerCard key={entry.id} entry={entry} />
                            ))}
                        </div>
                    </RosterSection>

                    <RosterSection title='Gardiens' count={goalies.length}>
                        <div className='mx-auto w-full md:w-1/3 md:min-w-[260px]'>
                            {goalies.map((entry) => (
                                <PlayerCard
                                    key={entry.id}
                                    entry={entry}
                                />
                            ))}
                        </div>
                    </RosterSection>

                    <RosterSection title='Banc' count={bench.length}>
                        <div className='grid grid-cols-1 gap-3 md:grid-cols-3'>
                            {bench.map((entry) => (
                                <PlayerCard key={entry.id} entry={entry} />
                            ))}
                        </div>
                    </RosterSection>

                    <RosterSection title='Prospects' count={prospects.length}>
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