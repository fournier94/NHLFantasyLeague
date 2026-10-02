import { useEffect, useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { getLeagueTeams, getTeamRoster, type FantasyTeam, type RosterEntry, type TeamRoster } from '@/api/client';
import { PlayerCard } from '@/components/roster/PlayerCard';
import { RosterSection } from '@/components/roster/RosterSection';
import { useAura } from '@/lib/auraContext';
import {
    auraPulseClass,
    auraPulseStyle,
    auraRangeFor,
    isAuraOff,
    AURA_STRIP_PULSE_REST_SCALE,
    AURA_STRIP_PULSE_PEAK_SCALE,
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

export default function MonEquipePage() {
    const { user, loading: authLoading } = useAuth();

    const [searchParams, setSearchParams] = useSearchParams();
    const teamIdParam = searchParams.get('teamId');

    const [isTeamPickerOpen, setIsTeamPickerOpen] = useState(false);
    const teamPickerRef = useRef<HTMLDivElement>(null);

    const [teams, setTeams] = useState<FantasyTeam[]>([]);

    // Resolve the team id:
    //   1. ?teamId= in the URL if present (viewing another team).
    //   2. Otherwise, the logged-in user's own team.
    //   3. Otherwise, null (unassigned user; show a message).
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

    // Label shown on the closed picker button.
    const selectedTeamLabel = (() => {
        if (teamIdParam != null) {
            const selected = teams.find(
                (t) => String(t.id) === teamIdParam,
            );
            return selected?.name ?? 'Mon équipe';
        }
        return 'Mon équipe';
    })();

    // Same aura channel as the player-page stat strip, so tuning
    // 'Bande de stats (page joueur)' in the admin panel moves both.
    const dropdownAura = useAura('playerSeasonStrip');

    const dropdownSizeAt = (layer: number) =>
        auraRangeFor(dropdownAura, 'playerSeasonStrip', layer);

    const dropdownAuraRest = [
        `0 0 2px rgba(180, 230, 255, 0.9)`,
        `0 0 ${(dropdownSizeAt(0) * AURA_STRIP_PULSE_REST_SCALE).toFixed(2)}px rgba(0, 168, 255, 1)`,
        `0 0 ${(dropdownSizeAt(1) * AURA_STRIP_PULSE_REST_SCALE).toFixed(2)}px rgba(0, 168, 255, 0.9)`,
        `0 0 ${(dropdownSizeAt(2) * AURA_STRIP_PULSE_REST_SCALE).toFixed(2)}px rgba(0, 168, 255, 0.6)`,
        `0 0 ${(dropdownSizeAt(3) * AURA_STRIP_PULSE_REST_SCALE).toFixed(2)}px rgba(0, 168, 255, 0.3)`,
    ].join(', ');

    const dropdownAuraPeak = [
        `0 0 3px rgba(200, 240, 255, 1)`,
        `0 0 ${(dropdownSizeAt(0) * AURA_STRIP_PULSE_PEAK_SCALE).toFixed(2)}px rgba(0, 168, 255, 1)`,
        `0 0 ${(dropdownSizeAt(1) * AURA_STRIP_PULSE_PEAK_SCALE).toFixed(2)}px rgba(0, 168, 255, 1)`,
        `0 0 ${(dropdownSizeAt(2) * AURA_STRIP_PULSE_PEAK_SCALE).toFixed(2)}px rgba(0, 168, 255, 0.85)`,
        `0 0 ${(dropdownSizeAt(3) * AURA_STRIP_PULSE_PEAK_SCALE).toFixed(2)}px rgba(0, 168, 255, 0.55)`,
    ].join(', ');

    const dropdownAuraOn = !isAuraOff(dropdownAura);

    // Blue text-shadow aura on the picker label, matching the roster
    // section titles. Same channel, so the "Titres de section roster"
    // slider moves both at once.
    const fontAura = useAura('rosterSectionTitle');

    const fontAuraRest = [
        `0 0 ${auraRangeFor(fontAura, 'rosterSectionTitle', 0).toFixed(2)}px #F2F5FA`,
        `0 0 ${auraRangeFor(fontAura, 'rosterSectionTitle', 1).toFixed(2)}px #00A8FF`,
        `0 0 ${auraRangeFor(fontAura, 'rosterSectionTitle', 2).toFixed(2)}px rgba(0, 168, 255, 0.5)`,
        `0 0 ${auraRangeFor(fontAura, 'rosterSectionTitle', 3).toFixed(2)}px rgba(0, 168, 255, 0.25)`,
    ].join(', ');

    const fontAuraPeak = [
        `0 0 ${auraRangeFor(fontAura, 'rosterSectionTitle', 0).toFixed(2)}px #F2F5FA`,
        `0 0 ${auraRangeFor(fontAura, 'rosterSectionTitle', 1).toFixed(2)}px #00A8FF`,
        `0 0 ${auraRangeFor(fontAura, 'rosterSectionTitle', 2).toFixed(2)}px rgba(0, 168, 255, 0.65)`,
        `0 0 ${auraRangeFor(fontAura, 'rosterSectionTitle', 3).toFixed(2)}px rgba(0, 168, 255, 0.4)`,
    ].join(', ');

    const fontAuraOn = !isAuraOff(fontAura);

    // Load the list of teams once, for the dropdown.
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

    // Custom team-picker dropdown: close on outside click and Escape.
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

    // Load the roster whenever the resolved team changes.
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

    // Restore scroll position when coming back from a player page.
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
            // Reverting to "my team": strip the query param.
            setSearchParams({});
            return;
        }

        setSearchParams({ teamId: newTeamId });
    }

    // Unassigned user, and no ?teamId override.
    if (!authLoading && user != null && teamId == null) {
        return (
            <section className='space-y-4'>
                <h2 className='text-center text-2xl font-semibold text-foreground'>
                    Mon équipe
                </h2>
                <p className='text-center text-muted-foreground'>
                    Aucune équipe ne vous a encore été assignée. Le
                    commissaire doit vous assigner une équipe avant que
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

    const forwards = roster.entries.filter(
        (entry) => isActive(entry) && entry.position !== 'D' && entry.position !== 'G',
    );
    const defensemen = roster.entries.filter(
        (entry) => isActive(entry) && entry.position === 'D',
    );
    const goalies = roster.entries.filter(
        (entry) => isActive(entry) && entry.position === 'G',
    );
    const bench = roster.entries.filter((entry) => entry.rosterStatus === 'Bench');
    const prospects = roster.entries.filter((entry) => entry.rosterStatus === 'Prospect');

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

    return (
        <section className='space-y-4'>
            <div className='flex flex-col items-center gap-3'>
                <h2 className='hidden text-2xl font-semibold text-foreground md:block'>
                    Mon équipe · {roster.fantasyTeamName}
                </h2>

                <div className='flex w-full max-w-md flex-col items-center gap-2'>
                    <div
                        ref={teamPickerRef}
                        className='relative w-full'
                    >
                        <button
                            type='button'
                            aria-haspopup='listbox'
                            aria-expanded={isTeamPickerOpen}
                            aria-label='Choisir une équipe'
                            onClick={() => setIsTeamPickerOpen((v) => !v)}
                            className={`w-full rounded-lg border bg-[#080D1A] px-3 py-2 text-center text-xl font-bold text-foreground focus:outline-none focus-visible:outline-none ${dropdownAuraOn
                                    ? `border-[#00A8FF]/40 ${auraPulseClass('box')}`
                                    : 'border-border focus:ring-2 focus:ring-ring/50'
                                }`}
                            style={
                                dropdownAuraOn
                                    ? auraPulseStyle(dropdownAuraRest, dropdownAuraPeak)
                                    : undefined
                            }
                        >
                            <span
                                className={
                                    fontAuraOn ? auraPulseClass('text') : ''
                                }
                                style={
                                    fontAuraOn
                                        ? auraPulseStyle(fontAuraRest, fontAuraPeak)
                                        : undefined
                                }
                            >
                                {selectedTeamLabel}
                            </span>
                        </button>

                        {isTeamPickerOpen && (
                            <ul
                                role='listbox'
                                className='absolute left-0 right-0 z-50 mt-1 max-h-72 overflow-y-auto rounded-lg border border-border bg-[#0F1626] shadow-2xl'
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
                                            className='w-full cursor-pointer px-3 py-2 text-center text-base text-foreground transition-colors hover:bg-secondary'
                                        >
                                            Mon équipe
                                        </button>
                                    </li>
                                )}

                                {teams
                                    .filter((t) => t.id !== user?.fantasyTeamId)
                                    .map((team) => (
                                        <li key={team.id}>
                                            <button
                                                type='button'
                                                role='option'
                                                aria-selected={
                                                    teamIdParam === String(team.id)
                                                }
                                                onClick={() => {
                                                    handleTeamChange(String(team.id));
                                                    setIsTeamPickerOpen(false);
                                                }}
                                                className='w-full cursor-pointer px-3 py-2 text-center text-base text-foreground transition-colors hover:bg-secondary'
                                            >
                                                {team.name}
                                            </button>
                                        </li>
                                    ))}
                            </ul>
                        )}
                    </div>
                </div>
            </div>

            {roster.futureCapBySeason.length > 0 && (
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
                                        className={`relative h-3 flex-1 overflow-hidden rounded ${trackColorClass(pct)} ${!isAuraOff(trackAura) ? auraPulseClass('box') : ''}`}
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
                <div className='flex justify-center'>
                    {goalies.map((entry) => (
                        <PlayerCard
                            key={entry.id}
                            entry={entry}
                            className='w-full md:w-1/3 md:min-w-[260px]'
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
        </section>
    );
}