import { useEffect, useState } from 'react';
import {
    assignPlayer,
    getLeagueTeams,
    getTeamRoster,
    releasePlayer,
    searchPlayers,
    updateRosterEntry,
    type FantasyTeam,
    type PlayerSearchResult,
    type RosterEntry,
    type TeamRoster,
} from '@/api/client';
import { useAuraAll } from '@/lib/auraContext';
import { AURA_CHANNELS } from '@/lib/auraConfig';

const ROSTER_STATUSES = [
    { value: 'Active', label: 'Actif' },
    { value: 'Bench', label: 'Banc' },
    { value: 'Prospect', label: 'Prospect' },
] as const;

const MIN_SEARCH_LENGTH = 2;
const SEARCH_DEBOUNCE_MS = 300;

function statusLabel(status: string): string {
    return ROSTER_STATUSES.find((entry) => entry.value === status)?.label ?? status;
}

const selectClass =
    'w-full rounded-lg border border-border bg-card px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-ring/50';

const primaryButtonClass =
    'cursor-pointer rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-50';

const secondaryButtonClass =
    'cursor-pointer rounded-lg border border-border bg-transparent px-4 py-2 text-sm font-medium text-foreground transition-colors hover:bg-secondary disabled:cursor-not-allowed disabled:opacity-50';

const dangerButtonClass =
    'cursor-pointer rounded-lg border border-destructive/40 bg-transparent px-4 py-2 text-sm font-medium text-destructive transition-colors hover:bg-destructive/10 disabled:cursor-not-allowed disabled:opacity-50';

export default function AdminPage() {
    const [query, setQuery] = useState('');
    const [results, setResults] = useState<PlayerSearchResult[]>([]);
    const [selectedPlayer, setSelectedPlayer] = useState<PlayerSearchResult | null>(null);
    const [teams, setTeams] = useState<FantasyTeam[]>([]);
    const [fantasyTeamId, setFantasyTeamId] = useState('');
    const [rosterStatus, setRosterStatus] = useState('Active');
    const [searching, setSearching] = useState(false);
    const [submitting, setSubmitting] = useState(false);
    const [releaseArmed, setReleaseArmed] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [success, setSuccess] = useState<string | null>(null);
    const [rosterTeamId, setRosterTeamId] = useState('');
    const [teamRoster, setTeamRoster] = useState<TeamRoster | null>(null);
    const [rosterLoading, setRosterLoading] = useState(false);
    const [rosterError, setRosterError] = useState<string | null>(null);

    const { intensities, setIntensity, reset } = useAuraAll();

    useEffect(() => {
        let cancelled = false;

        getLeagueTeams()
            .then((data) => {
                if (!cancelled) {
                    setTeams(data);
                }
            })
            .catch(() => {
                if (!cancelled) {
                    setError('Impossible de charger les équipes. Vérifiez que le serveur API est démarré.');
                }
            });

        return () => {
            cancelled = true;
        };
    }, []);

    useEffect(() => {
        const text = query.trim();

        if (text.length < MIN_SEARCH_LENGTH || selectedPlayer) {
            setResults([]);
            setSearching(false);
            return;
        }

        setSearching(true);

        let cancelled = false;

        const timer = setTimeout(() => {
            searchPlayers(text)
                .then((data) => {
                    if (!cancelled) {
                        setResults(data);
                    }
                })
                .catch(() => {
                    if (!cancelled) {
                        setResults([]);
                    }
                })
                .finally(() => {
                    if (!cancelled) {
                        setSearching(false);
                    }
                });
        }, SEARCH_DEBOUNCE_MS);

        return () => {
            cancelled = true;
            clearTimeout(timer);
        };
    }, [query, selectedPlayer]);

    useEffect(() => {
        if (!rosterTeamId) {
            setTeamRoster(null);
            setRosterError(null);
            return;
        }

        let cancelled = false;
        setRosterLoading(true);
        setRosterError(null);

        getTeamRoster(Number(rosterTeamId))
            .then((data) => {
                if (!cancelled) {
                    setTeamRoster(data);
                }
            })
            .catch(() => {
                if (!cancelled) {
                    setRosterError('Impossible de charger cette équipe.');
                }
            })
            .finally(() => {
                if (!cancelled) {
                    setRosterLoading(false);
                }
            });

        return () => {
            cancelled = true;
        };
    }, [rosterTeamId]);

    function handleSelect(player: PlayerSearchResult) {
        setSelectedPlayer(player);
        setQuery(`${player.firstName} ${player.lastName}`);
        setResults([]);
        setReleaseArmed(false);

        if (player.rosterEntryId != null) {
            setFantasyTeamId(player.fantasyTeamId != null ? String(player.fantasyTeamId) : '');
            setRosterStatus(player.rosterStatus ?? 'Active');
        } else {
            setFantasyTeamId('');
            setRosterStatus('Active');
        }

        setSuccess(null);
        setError(null);
    }

    function resetForm() {
        setQuery('');
        setResults([]);
        setSelectedPlayer(null);
        setFantasyTeamId('');
        setRosterStatus('Active');
        setReleaseArmed(false);
    }

    async function refreshRosterIfVisible() {
        if (!rosterTeamId || !teamRoster) {
            return;
        }

        try {
            setTeamRoster(await getTeamRoster(Number(rosterTeamId)));
        } catch {
            setRosterError('Impossible de recharger cette équipe.');
        }
    }

    function handleRosterEntrySelect(entry: RosterEntry) {
        const selection: PlayerSearchResult = {
            playerId: entry.playerId,
            nhlPlayerId: entry.nhlPlayerId,
            firstName: entry.firstName,
            lastName: entry.lastName,
            position: entry.position,
            nhlTeamAbbreviation: entry.nhlTeamAbbreviation,
            rosterEntryId: entry.id,
            rosterStatus: entry.rosterStatus,
            fantasyTeamId: teamRoster?.fantasyTeamId,
            fantasyTeamName: teamRoster?.fantasyTeamName,
        };

        setSelectedPlayer(selection);
        setQuery(`${entry.firstName} ${entry.lastName}`);
        setResults([]);
        setReleaseArmed(false);
        setFantasyTeamId(
            teamRoster?.fantasyTeamId != null ? String(teamRoster.fantasyTeamId) : '',
        );
        setRosterStatus(entry.rosterStatus ?? 'Active');
        setSuccess(null);
        setError(null);
    }

    async function runMovement(call: () => Promise<{ message: string }>) {
        setSubmitting(true);
        setError(null);
        setSuccess(null);

        try {
            const result = await call();

            setSuccess(result.message);
            resetForm();
        } catch (err) {
            setError(err instanceof Error ? err.message : "Erreur lors de l'opération.");
        } finally {
            setSubmitting(false);
        }
    }

    function handleAssign() {
        if (!selectedPlayer || !fantasyTeamId) {
            return;
        }

        return runMovement(async () => {
            const result = await assignPlayer({
                fantasyTeamId: Number(fantasyTeamId),
                playerId: selectedPlayer.playerId,
                rosterStatus,
            });

            void refreshRosterIfVisible();

            return result;
        });
    }

    async function handleCombinedUpdate() {
        if (!selectedPlayer?.rosterEntryId) {
            return;
        }

        setSubmitting(true);
        setError(null);
        setSuccess(null);

        try {
            const result = await updateRosterEntry({
                rosterEntryId: selectedPlayer.rosterEntryId,
                rosterStatus,
                fantasyTeamId: Number(fantasyTeamId),
            });

            setSuccess(result.message);
            void refreshRosterIfVisible();

            resetForm();
        } catch (err) {
            setError(err instanceof Error ? err.message : 'Erreur inconnue.');
        } finally {
            setSubmitting(false);
        }
    }

    function handleRelease() {
        if (!selectedPlayer?.rosterEntryId) {
            return;
        }

        return runMovement(async () => {
            const result = await releasePlayer({
                rosterEntryId: selectedPlayer.rosterEntryId,
            });

            void refreshRosterIfVisible();

            return result;
        });
    }

    const isAssigned = selectedPlayer?.rosterEntryId != null;

    const currentStatusLabel = selectedPlayer
        ? ROSTER_STATUSES.find(
            (status) => status.value === selectedPlayer.rosterStatus,
        )?.label
        : undefined;

    const assignDisabled = submitting || !selectedPlayer || !fantasyTeamId;

    return (
        <section className='space-y-6'>
            <div>
                <h2 className='text-2xl font-semibold text-foreground'>
                    Gestion des joueurs
                </h2>

                <p className='mt-1 text-muted-foreground'>
                    Recherchez un joueur, puis ajoutez-le à une équipe, transférez-le,
                    changez son statut ou libérez-le.
                </p>
            </div>

            {/* Appearance settings */}
            <div className='max-w-2xl space-y-3'>
                <div className='flex items-center justify-between'>
                    <h3 className='text-lg font-semibold text-foreground'>
                        Apparence
                    </h3>

                    <button
                        type='button'
                        onClick={reset}
                        className={secondaryButtonClass}
                    >
                        Réinitialiser
                    </button>
                </div>

                <div className='grid grid-cols-1 gap-3 md:grid-cols-2'>
                    {AURA_CHANNELS.map(({ key, label }) => (
                        <div
                            key={key}
                            className='rounded-lg border border-border bg-card p-3'
                        >
                            <div className='flex items-center justify-between'>
                                <label
                                    htmlFor={`aura-${key}`}
                                    className='text-sm font-medium text-foreground'
                                >
                                    {label}
                                </label>

                                <span className='text-sm font-semibold text-primary'>
                                    {intensities[key]}/10
                                </span>
                            </div>

                            <input
                                id={`aura-${key}`}
                                type='range'
                                min='0'
                                max='10'
                                step='1'
                                value={intensities[key]}
                                onChange={(event) =>
                                    setIntensity(key, Number(event.target.value))
                                }
                                className='mt-2 w-full cursor-pointer'
                            />

                            <div className='mt-1 flex justify-between text-[0.65rem] text-muted-foreground'>
                                <span>Off</span>
                                <span>Max</span>
                            </div>
                        </div>
                    ))}
                </div>
            </div>

            {success && (
                <p className='rounded-lg border border-emerald-500/40 bg-emerald-500/10 px-3 py-2 text-sm text-emerald-400'>
                    {success}
                </p>
            )}

            {error && (
                <p className='rounded-lg border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive'>
                    {error}
                </p>
            )}

            <div className='max-w-lg space-y-3'>
                <div className='relative'>
                    <input
                        type='text'
                        value={query}
                        autoComplete='off'
                        onChange={(event) => {
                            setQuery(event.target.value);
                            setSelectedPlayer(null);
                        }}
                        placeholder='Rechercher un joueur (min. 2 lettres)'
                        className={selectClass}
                    />

                    {results.length > 0 && (
                        <div className='absolute z-10 mt-1 w-full overflow-hidden rounded-lg border border-border bg-card shadow-lg'>
                            {results.map((player) => (
                                <button
                                    key={player.playerId}
                                    type='button'
                                    onClick={() => handleSelect(player)}
                                    className='flex w-full cursor-pointer items-center justify-between gap-2 px-3 py-2 text-left text-sm hover:bg-secondary'
                                >
                                    <span className='text-foreground'>
                                        {player.firstName} {player.lastName}
                                    </span>

                                    <span className='text-xs text-muted-foreground'>
                                        {player.nhlTeamAbbreviation} · {player.position}

                                        {player.fantasyTeamName ? (
                                            <span className='text-primary'>
                                                {' '}
                                                (déjà avec {player.fantasyTeamName})
                                            </span>
                                        ) : null}
                                    </span>
                                </button>
                            ))}
                        </div>
                    )}
                </div>

                {!searching &&
                    !selectedPlayer &&
                    query.trim().length >= MIN_SEARCH_LENGTH &&
                    results.length === 0 && (
                        <p className='text-sm text-muted-foreground'>
                            Aucun joueur trouvé.
                        </p>
                    )}

                {selectedPlayer && !isAssigned && (
                    <>
                        <select
                            value={fantasyTeamId}
                            onChange={(event) => setFantasyTeamId(event.target.value)}
                            className={selectClass}
                        >
                            <option value='' disabled>
                                Choisir une équipe
                            </option>

                            {teams.map((team) => (
                                <option key={team.id} value={team.id}>
                                    {team.name}
                                </option>
                            ))}
                        </select>

                        <select
                            value={rosterStatus}
                            onChange={(event) => setRosterStatus(event.target.value)}
                            className={selectClass}
                        >
                            {ROSTER_STATUSES.map((status) => (
                                <option key={status.value} value={status.value}>
                                    {status.label}
                                </option>
                            ))}
                        </select>

                        <button
                            type='button'
                            onClick={handleAssign}
                            disabled={assignDisabled}
                            className={primaryButtonClass}
                        >
                            {submitting ? 'Ajout...' : 'Ajouter le joueur'}
                        </button>
                    </>
                )}

                {selectedPlayer && isAssigned && (
                    <>
                        <div className='rounded-lg border border-border bg-card px-3 py-2 text-sm'>
                            <p className='text-foreground'>
                                Équipe actuelle : {selectedPlayer.fantasyTeamName ?? '—'}
                            </p>

                            <p className='text-muted-foreground'>
                                Statut actuel : {currentStatusLabel ?? '—'}
                            </p>
                        </div>

                        <label className='text-sm font-medium text-muted-foreground'>
                            Équipe
                        </label>

                        <select
                            value={fantasyTeamId}
                            onChange={(event) => setFantasyTeamId(event.target.value)}
                            className={selectClass}
                        >
                            {teams.map((team) => (
                                <option key={team.id} value={team.id}>
                                    {team.name}
                                </option>
                            ))}
                        </select>

                        <label className='text-sm font-medium text-muted-foreground'>
                            Statut
                        </label>

                        <select
                            value={rosterStatus}
                            onChange={(event) => setRosterStatus(event.target.value)}
                            className={selectClass}
                        >
                            {ROSTER_STATUSES.map((status) => (
                                <option key={status.value} value={status.value}>
                                    {status.label}
                                </option>
                            ))}
                        </select>

                        <button
                            type='button'
                            onClick={handleCombinedUpdate}
                            disabled={submitting || !fantasyTeamId}
                            className={primaryButtonClass}
                        >
                            Mettre à jour
                        </button>

                        <p className='text-sm font-semibold uppercase tracking-wide text-muted-foreground'>
                            Libérer
                        </p>

                        {!releaseArmed ? (
                            <button
                                type='button'
                                onClick={() => setReleaseArmed(true)}
                                disabled={submitting}
                                className={dangerButtonClass}
                            >
                                Libérer
                            </button>
                        ) : (
                            <div className='rounded-lg border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm'>
                                <p className='text-destructive'>
                                    Confirmer la libération de {selectedPlayer.firstName}{' '}
                                    {selectedPlayer.lastName} ?
                                </p>

                                <div className='mt-2 flex gap-2'>
                                    <button
                                        type='button'
                                        onClick={handleRelease}
                                        disabled={submitting}
                                        className={dangerButtonClass}
                                    >
                                        Oui, libérer
                                    </button>

                                    <button
                                        type='button'
                                        onClick={() => setReleaseArmed(false)}
                                        disabled={submitting}
                                        className={secondaryButtonClass}
                                    >
                                        Annuler
                                    </button>
                                </div>
                            </div>
                        )}
                    </>
                )}
            </div>

            <div className='max-w-lg space-y-3'>
                <h3 className='text-lg font-semibold text-foreground'>
                    Alignement d'une équipe
                </h3>

                <select
                    value={rosterTeamId}
                    onChange={(event) => setRosterTeamId(event.target.value)}
                    className={selectClass}
                >
                    <option value='' disabled>
                        Choisir une équipe
                    </option>

                    {teams.map((team) => (
                        <option key={team.id} value={team.id}>
                            {team.name}
                        </option>
                    ))}
                </select>

                {rosterLoading && (
                    <p className='text-sm text-muted-foreground'>
                        Chargement...
                    </p>
                )}

                {rosterError && (
                    <p className='text-sm text-destructive'>
                        {rosterError}
                    </p>
                )}

                {teamRoster && teamRoster.entries.length === 0 && (
                    <p className='text-sm text-muted-foreground'>
                        Aucun joueur dans cette équipe.
                    </p>
                )}

                {teamRoster && teamRoster.entries.length > 0 && (
                    <ul className='space-y-1'>
                        {teamRoster.entries.map((entry) => (
                            <li key={entry.id}>
                                <button
                                    type='button'
                                    onClick={() => handleRosterEntrySelect(entry)}
                                    className='w-full cursor-pointer rounded-lg px-3 py-1.5 text-left text-sm text-foreground hover:bg-secondary'
                                >
                                    {entry.firstName} {entry.lastName}

                                    <span className='ml-2 text-xs text-muted-foreground'>
                                        · {entry.position} · {statusLabel(entry.rosterStatus)}
                                    </span>
                                </button>
                            </li>
                        ))}
                    </ul>
                )}
            </div>
        </section>
    );
}