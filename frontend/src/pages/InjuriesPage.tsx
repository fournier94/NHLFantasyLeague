import { useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import {
    AlertCircle,
    Search,
    ShieldAlert,
    User,
    X,
} from 'lucide-react';
import {
    getInjuries,
    type InjuryRow,
} from '@/api/client';
import { NeonTitle } from '@/components/ui/NeonTitle';
import { NhlTeamLogo } from '@/components/nhl/NhlTeamLogo';
import { cn } from '@/lib/utils';
import { useAuth } from '@/lib/AuthContext';

// ---------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------

type KindFilter = 'all' | 'Injury' | 'Suspension';
type OwnerFilter = 'all' | 'mine' | 'freeAgents';

function shortName(firstName: string, lastName: string): string {
    const initial = firstName.trim().charAt(0);
    return initial
        ? `${initial}. ${lastName}`
        : lastName;
}

function kindLabel(kind: string): string {
    if (kind === 'Suspension') return 'Suspension';
    return 'Blessure';
}

function kindColorClass(kind: string): string {
    if (kind === 'Suspension') {
        return 'text-amber-400 border-amber-400/40 bg-amber-400/10';
    }
    return 'text-red-400 border-red-400/40 bg-red-400/10';
}

function statusColorClass(status: string | null): string {
    if (!status) return 'text-muted-foreground';

    const s = status.toLowerCase();

    if (s.includes('suspension')) return 'text-amber-400';
    if (s.includes('ir') || s.includes('injur')) return 'text-red-400';
    if (s.includes('out')) return 'text-red-400';
    if (s.includes('day')) return 'text-yellow-400';

    return 'text-muted-foreground';
}

function relativeTimeLabel(iso: string | null): string {
    if (!iso) return '';

    const date = new Date(iso);
    const seconds = Math.floor((Date.now() - date.getTime()) / 1000);

    if (seconds < 60) return 'à l\'instant';

    const minutes = Math.floor(seconds / 60);
    if (minutes < 60) return `il y a ${minutes} min`;

    const hours = Math.floor(minutes / 60);
    if (hours < 24) return `il y a ${hours} h`;

    const days = Math.floor(hours / 24);
    return `il y a ${days} j`;
}

function formattedReturnDate(value: string | null): string {
    if (!value) return '';

    try {
        return new Intl.DateTimeFormat('fr-CA', {
            day: 'numeric',
            month: 'short',
            year: 'numeric',
        }).format(new Date(value));
    } catch {
        return '';
    }
}

// ---------------------------------------------------------------------
// Row
// ---------------------------------------------------------------------

function InjuryCard({ row }: { row: InjuryRow }) {
    const [imageFailed, setImageFailed] = useState(false);

    const showImage = Boolean(row.headshotUrl) && !imageFailed;
    const initials = `${row.firstName.charAt(0)}${row.lastName.charAt(0)}`;
    const displayName = shortName(row.firstName, row.lastName);
    const isSuspension = row.injuryKind === 'Suspension';

    const returnLabel = formattedReturnDate(row.injuryReturnDate);
    const updatedLabel = relativeTimeLabel(row.injuryUpdatedAt);

    // Compose the descriptive line: "Lower Body (Left) — Surgery"
    const detailParts: string[] = [];

    if (row.injuryType && row.injuryType !== 'Not Specified') {
        detailParts.push(row.injuryType);
    }

    if (row.injurySide && row.injurySide !== 'Not Specified') {
        detailParts.push(`(${row.injurySide})`);
    }

    const detailLine = detailParts.join(' ');

    return (
        <article className='flex items-start gap-3 rounded-lg border border-border bg-card px-3 py-2.5'>
            {/* Headshot / initials */}
            <Link
                to={`/joueurs/${row.nhlPlayerId}`}
                className='flex h-12 w-12 shrink-0 items-center justify-center overflow-hidden rounded-md bg-white focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/60'
            >
                {showImage ? (
                    <img
                        src={row.headshotUrl ?? undefined}
                        alt={displayName}
                        className='h-full w-full object-cover'
                        loading='lazy'
                        onError={() => setImageFailed(true)}
                    />
                ) : (
                    <span className='text-sm font-semibold text-black'>
                        {initials}
                    </span>
                )}
            </Link>

            {/* Middle: name, position, details */}
            <div className='min-w-0 flex-1'>
                <div className='flex items-center gap-1.5'>
                    <Link
                        to={`/joueurs/${row.nhlPlayerId}`}
                        className='truncate text-sm font-semibold text-foreground hover:text-[#00A8FF]'
                    >
                        {displayName}
                    </Link>

                    {row.nhlTeamAbbreviation && (
                        <NhlTeamLogo
                            abbreviation={row.nhlTeamAbbreviation}
                            size={16}
                        />
                    )}

                    <span className='shrink-0 text-xs uppercase tracking-wide text-muted-foreground'>
                        {row.position}
                    </span>
                </div>

                <div className='mt-0.5 flex flex-wrap items-center gap-1.5'>
                    <span
                        className={cn(
                            'inline-flex items-center gap-1 rounded border px-1.5 py-0.5 text-[0.65rem] font-semibold uppercase tracking-wide',
                            kindColorClass(row.injuryKind),
                        )}
                    >
                        {isSuspension ? (
                            <ShieldAlert className='h-3 w-3' />
                        ) : (
                            <AlertCircle className='h-3 w-3' />
                        )}
                        {kindLabel(row.injuryKind)}
                    </span>

                    {row.injuryStatus && (
                        <span
                            className={cn(
                                'text-xs font-medium',
                                statusColorClass(row.injuryStatus),
                            )}
                        >
                            {row.injuryStatus}
                        </span>
                    )}
                </div>

                {(detailLine || row.injuryDetail) && (
                    <p className='mt-1 truncate text-xs text-muted-foreground'>
                        {detailLine}
                        {detailLine && row.injuryDetail ? ' — ' : ''}
                        {row.injuryDetail}
                    </p>
                )}

                {row.injuryShortDescription && (
                    <p className='mt-1 line-clamp-2 text-xs text-muted-foreground'>
                        {row.injuryShortDescription}
                    </p>
                )}

                <div className='mt-1 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-[0.65rem] text-muted-foreground'>
                    {returnLabel && (
                        <span>
                            Retour prévu: {returnLabel}
                        </span>
                    )}
                    {updatedLabel && (
                        <span>
                            Mis à jour {updatedLabel}
                        </span>
                    )}
                </div>
            </div>

            {/* Right: fantasy team ownership */}
            {row.fantasyTeamName && (
                <div className='shrink-0 self-center text-right'>
                    <div className='flex items-center gap-1 text-xs text-muted-foreground'>
                        <User className='h-3 w-3' />
                        <span className='font-medium text-foreground'>
                            {row.fantasyTeamName}
                        </span>
                    </div>
                    {row.rosterStatus && (
                        <span className='text-[0.65rem] uppercase tracking-wide text-muted-foreground'>
                            {row.rosterStatus === 'Active'
                                ? 'Actif'
                                : row.rosterStatus === 'Bench'
                                    ? 'Banc'
                                    : row.rosterStatus === 'Prospect'
                                        ? 'Prospect'
                                        : row.rosterStatus}
                        </span>
                    )}
                </div>
            )}
        </article>
    );
}

// ---------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------

export default function InjuriesPage() {
    const { user } = useAuth();

    const [rows, setRows] = useState<InjuryRow[]>([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);

    const [searchText, setSearchText] = useState('');
    const [debouncedSearch, setDebouncedSearch] = useState('');
    const [kindFilter, setKindFilter] = useState<KindFilter>('all');
    const [ownerFilter, setOwnerFilter] = useState<OwnerFilter>('all');
    const [nhlTeamFilter, setNhlTeamFilter] = useState<string>('');

    const isMountedRef = useRef(true);

    useEffect(() => {
        isMountedRef.current = true;
        return () => {
            isMountedRef.current = false;
        };
    }, []);

    // Debounce the search input: 300 ms after the user stops typing.
    useEffect(() => {
        const timer = window.setTimeout(() => {
            setDebouncedSearch(searchText.trim());
        }, 300);

        return () => window.clearTimeout(timer);
    }, [searchText]);

    // Fetch whenever any filter changes.
    useEffect(() => {
        let cancelled = false;

        setLoading(true);

        const filters: Parameters<typeof getInjuries>[0] = {};

        if (debouncedSearch) filters.search = debouncedSearch;
        if (nhlTeamFilter) filters.nhlTeam = nhlTeamFilter;
        if (kindFilter !== 'all') filters.kind = kindFilter;
        if (ownerFilter === 'mine' && user?.fantasyTeamId) {
            filters.fantasyTeamId = user.fantasyTeamId;
        }

        getInjuries(filters)
            .then((data) => {
                if (cancelled || !isMountedRef.current) return;

                // Owner filter that isn't `mine`: we filter client-side
                // because the API's fantasyTeamId filter is inclusive
                // (returns only that team), and free-agents is the
                // inverse.
                const visible =
                    ownerFilter === 'freeAgents'
                        ? data.filter((r) => r.fantasyTeamId == null)
                        : data;

                setRows(visible);
                setError(null);
            })
            .catch(() => {
                if (cancelled || !isMountedRef.current) return;
                setError(
                    'Impossible de charger les blessures. ' +
                    'Vérifiez la connexion au serveur API.',
                );
            })
            .finally(() => {
                if (!cancelled && isMountedRef.current) {
                    setLoading(false);
                }
            });

        return () => {
            cancelled = true;
        };
    }, [
        debouncedSearch,
        nhlTeamFilter,
        kindFilter,
        ownerFilter,
        user?.fantasyTeamId,
    ]);

    // Distinct NHL teams present in the current rows, for the team
    // dropdown. Uses the fetched rows, not a separate endpoint.
    const nhlTeams = useMemo(() => {
        const set = new Set<string>();

        for (const r of rows) {
            if (r.nhlTeamAbbreviation) set.add(r.nhlTeamAbbreviation);
        }

        return Array.from(set).sort();
    }, [rows]);

    function clearFilters() {
        setSearchText('');
        setDebouncedSearch('');
        setKindFilter('all');
        setOwnerFilter('all');
        setNhlTeamFilter('');
    }

    const hasFilters =
        searchText !== '' ||
        kindFilter !== 'all' ||
        ownerFilter !== 'all' ||
        nhlTeamFilter !== '';

    return (
        <section className='w-full space-y-4'>
            <div className='space-y-1 text-center'>
                <h2>
                    <NeonTitle keepPulseOnMobile>Blessures</NeonTitle>
                </h2>
            </div>

            {/* Filters */}
            <div className='space-y-2 rounded-lg border border-border bg-card px-3 py-2.5'>
                <div className='relative'>
                    <Search className='pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground' />

                    <input
                        type='text'
                        value={searchText}
                        placeholder='Rechercher un joueur...'
                        autoComplete='off'
                        onChange={(e) => setSearchText(e.target.value)}
                        className='w-full rounded-md border border-border bg-background pl-8 pr-8 py-1.5 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-[#00A8FF]'
                    />

                    {searchText && (
                        <button
                            type='button'
                            aria-label='Effacer la recherche'
                            onClick={() => setSearchText('')}
                            className='absolute right-2 top-1/2 -translate-y-1/2 cursor-pointer rounded p-0.5 text-muted-foreground hover:text-foreground'
                        >
                            <X className='h-3.5 w-3.5' />
                        </button>
                    )}
                </div>

                <div className='grid grid-cols-2 gap-2 md:grid-cols-3'>
                    <select
                        value={kindFilter}
                        onChange={(e) =>
                            setKindFilter(e.target.value as KindFilter)
                        }
                        className='rounded-md border border-border bg-background px-2 py-1.5 text-xs text-foreground focus:outline-none focus:ring-1 focus:ring-[#00A8FF]'
                    >
                        <option value='all'>Tout</option>
                        <option value='Injury'>Blessures</option>
                        <option value='Suspension'>Suspensions</option>
                    </select>

                    <select
                        value={ownerFilter}
                        onChange={(e) =>
                            setOwnerFilter(e.target.value as OwnerFilter)
                        }
                        className='rounded-md border border-border bg-background px-2 py-1.5 text-xs text-foreground focus:outline-none focus:ring-1 focus:ring-[#00A8FF]'
                    >
                        <option value='all'>Toutes les équipes</option>
                        <option value='mine'>Mon équipe</option>
                        <option value='freeAgents'>Agents libres</option>
                    </select>

                    <select
                        value={nhlTeamFilter}
                        onChange={(e) => setNhlTeamFilter(e.target.value)}
                        className='col-span-2 rounded-md border border-border bg-background px-2 py-1.5 text-xs text-foreground focus:outline-none focus:ring-1 focus:ring-[#00A8FF] md:col-span-1'
                    >
                        <option value=''>Toutes les équipes LNH</option>
                        {nhlTeams.map((t) => (
                            <option key={t} value={t}>
                                {t}
                            </option>
                        ))}
                    </select>
                </div>

                {hasFilters && (
                    <div className='flex justify-end'>
                        <button
                            type='button'
                            onClick={clearFilters}
                            className='cursor-pointer rounded px-1.5 py-0.5 text-[0.7rem] text-muted-foreground transition-colors hover:text-foreground'
                        >
                            Réinitialiser les filtres
                        </button>
                    </div>
                )}
            </div>

            {error && (
                <p className='rounded-lg border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive'>
                    {error}
                </p>
            )}

            {loading && rows.length === 0 && !error && (
                <p className='text-center text-sm text-muted-foreground'>
                    Chargement...
                </p>
            )}

            {!loading && rows.length === 0 && !error && (
                <p className='rounded-lg border border-border bg-card px-3 py-6 text-center text-sm text-muted-foreground'>
                    {hasFilters
                        ? 'Aucun joueur ne correspond aux filtres.'
                        : 'Aucune blessure en ce moment.'}
                </p>
            )}

            {rows.length > 0 && (
                <div className='space-y-2'>
                    {rows.map((row) => (
                        <InjuryCard key={row.playerId} row={row} />
                    ))}
                </div>
            )}
        </section>
    );
}