import { useState, type FormEvent } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '@/lib/AuthContext';

/**
 * Login page. On success, redirects to /mon-equipe. On failure,
 * shows the API's message.
 *
 * The "inscription" link goes to /inscription.
 */
export default function ConnexionPage() {
    const navigate = useNavigate();
    const { login, isAuthenticated } = useAuth();

    const [userName, setUserName] = useState('');
    const [password, setPassword] = useState('');
    const [submitting, setSubmitting] = useState(false);
    const [error, setError] = useState<string | null>(null);

    // If already logged in, don't show the form.
    if (isAuthenticated) {
        navigate('/mon-equipe', { replace: true });
        return null;
    }

    async function handleSubmit(event: FormEvent<HTMLFormElement>) {
        event.preventDefault();

        if (!userName.trim() || !password) {
            setError("Nom d'utilisateur et mot de passe requis.");
            return;
        }

        setSubmitting(true);
        setError(null);

        try {
            await login({ userName: userName.trim(), password });
            navigate('/mon-equipe', { replace: true });
        } catch (err) {
            setError(
                err instanceof Error
                    ? err.message
                    : 'Connexion impossible.',
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
                    Connexion
                </h2>
                <p className='mt-1 text-sm text-muted-foreground'>
                    Entrez votre nom d'utilisateur et votre mot de passe.
                </p>
            </div>

            <form onSubmit={handleSubmit} className='space-y-3'>
                <div>
                    <label
                        htmlFor='userName'
                        className='text-sm font-medium text-muted-foreground'
                    >
                        Nom d'utilisateur
                    </label>
                    <input
                        id='userName'
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
                        htmlFor='password'
                        className='text-sm font-medium text-muted-foreground'
                    >
                        Mot de passe
                    </label>
                    <input
                        id='password'
                        type='password'
                        autoComplete='current-password'
                        value={password}
                        onChange={(event) => setPassword(event.target.value)}
                        className={`mt-1 ${inputClass}`}
                        disabled={submitting}
                    />
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
                    {submitting ? 'Connexion...' : 'Se connecter'}
                </button>
            </form>

            <p className='text-center text-sm text-muted-foreground'>
                Pas encore de compte ?{' '}
                <Link
                    to='/inscription'
                    className='font-medium text-primary hover:underline'
                >
                    Créer un compte
                </Link>
            </p>
        </section>
    );
}