import { useEffect, useState, type FormEvent } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import {
    getUnclaimedTeams,
    type UnclaimedTeam,
} from '@/api/client';
import { useAuth } from '@/lib/AuthContext';

/**
 * Registration page. Requires:
 *   - a unique username
 *   - a password (server enforces the rules)
 *   - the shared invite code
 *   - optionally, an unclaimed FantasyTeam to attach to
 *
 * On success, the user is logged in and redirected to /mon-equipe.
 * If he didn't pick a team, he lands on the "waiting for the
 * commissioner" state (which is just MonEquipePage showing "aucune
 * équipe assignée" for now — we'll handle that UI later).
 */
export default function InscriptionPage() {
    const navigate = useNavigate();
    const { register, isAuthenticated } = useAuth();

    const [userName, setUserName] = useState('');
    const [password, setPassword] = useState('');
    const [inviteCode, setInviteCode] = useState('');
    const [fantasyTeamId, setFantasyTeamId] = useState<string>('');

    const [teams, setTeams] = useState<UnclaimedTeam[]>([]);
    const [teamsLoading, setTeamsLoading] = useState(true);
    const [teamsError, setTeamsError] = useState<string | null>(null);

    const [submitting, setSubmitting] = useState(false);
    const [error, setError] = useState<string | null>(null);

    // If already logged in, skip the form.
    if (isAuthenticated) {
        navigate('/mon-equipe', { replace: true });
        return null;
    }

    // Load the unclaimed teams for the dropdown.
    useEffect(() => {
        let cancelled = false;

        getUnclaimedTeams()
            .then((data) => {
                if (!cancelled) {
                    setTeams(data);
                }
            })
            .catch(() => {
                if (!cancelled) {
                    setTeamsError(
                        'Impossible de charger les équipes disponibles.',
                    );
                }
            })
            .finally(() => {
                if (!cancelled) {
                    setTeamsLoading(false);
                }
            });

        return () => {
            cancelled = true;
        };
    }, []);

    async function handleSubmit(event: FormEvent<HTMLFormElement>) {
        event.preventDefault();

        if (!userName.trim() || !password || !inviteCode.trim()) {
            setError("Tous les champs sont requis (sauf l'équipe).");
            return;
        }

        setSubmitting(true);
        setError(null);

        try {
            await register({
                userName: userName.trim(),
                password,
                inviteCode: inviteCode.trim(),
                fantasyTeamId:
                    fantasyTeamId === '' ? null : Number(fantasyTeamId),
            });
            navigate('/mon-equipe', { replace: true });
        } catch (err) {
            setError(
                err instanceof Error
                    ? err.message
                    : "Inscription impossible.",
            );
        } finally {
            setSubmitting(false);
        }
    }

    const inputClass =
        'w-full rounded-lg border border-border bg-card px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-ring/50';

    const buttonClass =
        'cursor-pointer rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-50';

    return (
        <section className='mx-auto w-full max-w-sm space-y-6'>
            <div className='text-center'>
                <h2 className='text-2xl font-semibold text-foreground'>
                    Inscription
                </h2>
                <p className='mt-1 text-sm text-muted-foreground'>
                    Créez votre compte pour prendre le contrôle de votre
                    équipe.
                </p>
            </div>

            <form onSubmit={handleSubmit} className='space-y-3'>
                <div>
                    <label
                        htmlFor='reg-userName'
                        className='text-sm font-medium text-muted-foreground'
                    >
                        Nom d'utilisateur
                    </label>
                    <input
                        id='reg-userName'
                        type='text'
                        autoComplete='username'
                        value={userName}
                        onChange={(event) => setUserName(event.target.value)}
                        className={`mt-1 ${inputClass}`}
                        disabled={submitting}
                    />
                </div>

                <div>
                    <label
                        htmlFor='reg-password'
                        className='text-sm font-medium text-muted-foreground'
                    >
                        Mot de passe
                    </label>
                    <input
                        id='reg-password'
                        type='password'
                        autoComplete='new-password'
                        value={password}
                        onChange={(event) => setPassword(event.target.value)}
                        className={`mt-1 ${inputClass}`}
                        disabled={submitting}
                    />
                </div>

                <div>
                    <label
                        htmlFor='reg-inviteCode'
                        className='text-sm font-medium text-muted-foreground'
                    >
                        Code d'invitation
                    </label>
                    <input
                        id='reg-inviteCode'
                        type='text'
                        autoComplete='off'
                        value={inviteCode}
                        onChange={(event) => setInviteCode(event.target.value)}
                        className={`mt-1 ${inputClass}`}
                        disabled={submitting}
                    />
                </div>

                <div>
                    <label
                        htmlFor='reg-team'
                        className='text-sm font-medium text-muted-foreground'
                    >
                        Équipe (optionnel)
                    </label>
                    <select
                        id='reg-team'
                        value={fantasyTeamId}
                        onChange={(event) =>
                            setFantasyTeamId(event.target.value)
                        }
                        className={`mt-1 ${inputClass}`}
                        disabled={submitting || teamsLoading}
                    >
                        <option value=''>
                            -- Plus tard (le commissaire m'assignera) --
                        </option>
                        {teams.map((team) => (
                            <option key={team.id} value={team.id}>
                                {team.name}
                            </option>
                        ))}
                    </select>

                    {teamsLoading && (
                        <p className='mt-1 text-xs text-muted-foreground'>
                            Chargement des équipes disponibles...
                        </p>
                    )}

                    {teamsError && (
                        <p className='mt-1 text-xs text-destructive'>
                            {teamsError}
                        </p>
                    )}

                    {!teamsLoading && teams.length === 0 && !teamsError && (
                        <p className='mt-1 text-xs text-muted-foreground'>
                            Aucune équipe disponible. Le commissaire vous en
                            assignera une plus tard.
                        </p>
                    )}
                </div>

                {error && (
                    <p className='rounded-lg border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive'>
                        {error}
                    </p>
                )}

                <button
                    type='submit'
                    disabled={submitting}
                    className={`w-full ${buttonClass}`}
                >
                    {submitting ? 'Création...' : 'Créer mon compte'}
                </button>
            </form>

            <p className='text-center text-sm text-muted-foreground'>
                Déjà un compte ?{' '}
                <Link
                    to='/connexion'
                    className='font-medium text-primary hover:underline'
                >
                    Se connecter
                </Link>
            </p>
        </section>
    );
}