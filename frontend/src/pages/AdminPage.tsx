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

// Statuses sent to the API verbatim; labels are the French display names.
const ROSTER_STATUSES = [
  { value: 'Active', label: 'Actif' },
  { value: 'Bench', label: 'Banc' },
  { value: 'Prospect', label: 'Prospect' },
] as const;

// The search starts after this many characters, to avoid a query per letter.
const MIN_SEARCH_LENGTH = 2;

// Wait a little after the last keystroke before calling the API (debounce).
const SEARCH_DEBOUNCE_MS = 300;

// French label of a roster status ("Active" -> "Actif", ...).
function statusLabel(status: string): string {
  return ROSTER_STATUSES.find((entry) => entry.value === status)?.label ?? status;
}

// Shared control styles, to keep the JSX readable.
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

  // Load the 12 fantasy teams once, when the page is opened.
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

    // Avoid setting state after unmount (React StrictMode mounts twice in dev).
    return () => {
      cancelled = true;
    };
  }, []);

  // Debounced player search: runs 300 ms after the user stops typing.
  useEffect(() => {
    const text = query.trim();

    // Nothing to search yet, or a player was just picked from the panel.
    if (text.length < MIN_SEARCH_LENGTH || selectedPlayer) {
      setResults([]);
      setSearching(false);
      return;
    }

    setSearching(true);

    // Flipped when the effect is cleaned up (text changed / unmounted), so a
    // stale response never overwrites the results of a newer search.
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

  // Loads the roster of the team chosen in the roster section.
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
    // Pre-select the player's current team + status (free agents start fresh).
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

  // Clears the whole form after a successful movement.
  function resetForm() {
    setQuery('');
    setResults([]);
    setSelectedPlayer(null);
    setFantasyTeamId('');
    setRosterStatus('Active');
    setReleaseArmed(false);
  }

  // Reloads the roster list of the team section after a successful movement.
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

  // Opens the same adaptive panel from a roster list row.
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
    setFantasyTeamId(teamRoster?.fantasyTeamId != null ? String(teamRoster.fantasyTeamId) : '');
    setRosterStatus(entry.rosterStatus ?? 'Active');
    setSuccess(null);
    setError(null);
  }

  // Shared skeleton of the four movements: busy flag, banners, form reset.
  async function runMovement(call: () => Promise<{ message: string }>) {
    setSubmitting(true);
    setError(null);
    setSuccess(null);

    try {
      const result = await call();

      // The API returns a ready-to-display message.
      setSuccess(result.message);
      resetForm();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Erreur lors de l'opération.");
    } finally {
      setSubmitting(false);
    }
  }

  function handleAssign() {
    // Both a player and a team must be selected.
    if (!selectedPlayer || !fantasyTeamId) {
      return;
    }

    return runMovement(async () => {
      const result = await assignPlayer({
        fantasyTeamId: Number(fantasyTeamId),
        playerId: selectedPlayer.playerId,
        rosterStatus,
      });

      // Keep the team roster section in sync after the assignment.
      void refreshRosterIfVisible();
      return result;
    });
  }

  // Applies team + status in one call, then clears the input and the
  // selection so the form is ready for the next player.
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

      // Clear the input field and unselect the player that was just updated.
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

      // Keep the team roster section in sync after the release.
      void refreshRosterIfVisible();
      return result;
    });
  }

  // The panel adapts to the selected player: free agents get the "Ajouter"
  // flow, assigned players get the movement blocks.
  const isAssigned = selectedPlayer?.rosterEntryId != null;
  const currentStatusLabel = selectedPlayer
    ? ROSTER_STATUSES.find((status) => status.value === selectedPlayer.rosterStatus)?.label
    : undefined;

  const assignDisabled = submitting || !selectedPlayer || !fantasyTeamId;

  return (
    <section className='space-y-6'>
      <div>
        <h2 className='text-2xl font-semibold text-foreground'>Gestion des joueurs</h2>
        <p className='mt-1 text-muted-foreground'>
          Recherchez un joueur, puis ajoutez-le à une équipe, transférez-le, changez son statut
          ou libérez-le.
        </p>
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
              // Editing the text invalidates a previously picked player.
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
                      <span className='text-primary'> (déjà avec {player.fantasyTeamName})</span>
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
          results.length === 0 && <p className='text-sm text-muted-foreground'>Aucun joueur trouvé.</p>}

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
              <p className='text-muted-foreground'>Statut actuel : {currentStatusLabel ?? '—'}</p>
            </div>

            <label className='text-sm font-medium text-muted-foreground'>Équipe</label>
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

            <label className='text-sm font-medium text-muted-foreground'>Statut</label>
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
                  Confirmer la libération de {selectedPlayer.firstName} {selectedPlayer.lastName} ?
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
        <h3 className='text-lg font-semibold text-foreground'>Alignement d'une équipe</h3>
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

        {rosterLoading && <p className='text-sm text-muted-foreground'>Chargement...</p>}
        {rosterError && <p className='text-sm text-destructive'>{rosterError}</p>}
        {teamRoster && teamRoster.entries.length === 0 && (
          <p className='text-sm text-muted-foreground'>Aucun joueur dans cette équipe.</p>
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
