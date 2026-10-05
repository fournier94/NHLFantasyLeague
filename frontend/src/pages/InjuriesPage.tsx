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
// Constants
// ---------------------------------------------------------------------

// Shared frame style, matching the Classement / Game Day pages.
const FRAME_BG = '#080D1A';
const FRAME_BORDER = 'rgba(0, 168, 255, 0.6)';
const FRAME_GLOW =
    '0 0 22px rgba(0, 168, 255, 0.35), inset 0 0 18px rgba(0, 168, 255, 0.08)';
const HEADER_GRADIENT =
    'linear-gradient(180deg, rgba(0, 168, 255, 0.12), rgba(0, 168, 255, 0.02))';

const INJURY_RED = '#EF4444';
const SUSPENSION_AMBER = '#FBBF24';

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

function statusColorClass(status: string | null): string {
    if (!status) return 'text-muted-foreground';

    const s = status.toLowerCase();

    if (s.includes('suspension')) return 'text-amber-400';
    if (s.includes('ir') || s.includes('injur')) return 'text-red-400';
    if (s.includes('out')) return 'text-red-400';
    if (s.includes('day')) return 'text-yellow-400';

    return 'text-muted-foreground';
}

// ---------------------------------------------------------------------
// Injury card
// ---------------------------------------------------------------------

function InjuryCard({ row }: { row: InjuryRow }) {
    const [imageFailed, setImageFailed] = useState(false);

    const showImage = Boolean(row.headshotUrl) && !imageFailed;
    const initials = `${row.firstName.charAt(0)}${row.lastName.charAt(0)}`;
    const displayName = shortName(row.firstName, row.lastName);
    const isSuspension = row.injuryKind === 'Suspension';

    const accentColor = isSuspension ? SUSPENSION_AMBER : INJURY_RED;
    const accentGlow = isSuspension
        ? 'rgba(251, 191, 36, 0.5)'
        : 'rgba(239, 68, 68, 0.5)';

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
        <article
            className='overflow-hidden rounded-lg border'
            style={{
                borderColor: FRAME_BORDER,
                backgroundColor: FRAME_BG,
                boxShadow: `0 0 14px ${accentGlow}, inset 0 0 12px rgba(0, 168, 255, 0.06)`,
                borderLeft: `3px solid ${accentColor}`,
            }}
        >
            {/* ---- Header bar: kind + status + updated ---- */}
            <div
                className='flex items-center justify-between gap-2 border-b px-3 py-1.5'
                style={{
                    borderColor: 'rgba(0, 168, 255, 0.25)',
                    background: HEADER_GRADIENT,
                }}
            >
                <div className='flex items-center gap-2'>
                    <span
                        className='inline-flex items-center gap-1 text-[0.65rem] font-bold uppercase tracking-wider'
                        style={{
                            color: accentColor,
                            textShadow: `0 0 8px ${accentGlow}`,
                        }}
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
                                'text-[0.65rem] font-semibold uppercase tracking-wider',
                                statusColorClass(row.injuryStatus),
                            )}
                        >
                            · {row.injuryStatus}
                        </span>
                    )}
                </div>

                {updatedLabel && (
                    <span className='text-[0.6rem] uppercase tracking-wider text-muted-foreground'>
                        {updatedLabel}
                    </span>
                )}
            </div>

            {/* ---- Body ---- */}
            <div className='flex items-start gap-3 px-3 py-2.5'>
                {/* Headshot / initials */}
                <Link
                    to={`/joueurs/${row.nhlPlayerId}`}
                    className='flex h-12 w-12 shrink-0 items-center justify-center overflow-hidden rounded-md bg-white focus:outline-none focus-visible:ring-2 focus-visible:ring-[#00E5FF]/60'
                    style={{
                        boxShadow: `0 0 10px ${accentGlow}`,
                    }}
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
                            className='truncate text-sm font-bold text-white transition-colors hover:text-[#00E5FF]'
                            style={{
                                textShadow: '0 0 6px rgba(0, 229, 255, 0.3)',
                            }}
                        >
                            {displayName}
                        </Link>

                        {row.nhlTeamAbbreviation && (
                            <NhlTeamLogo
                                abbreviation={row.nhlTeamAbbreviation}
                                size={16}
                            />
                        )}

                        <span className='shrink-0 text-xs font-semibold uppercase tracking-wider text-[#7DD3FC]'>
                            {row.position}
                        </span>
                    </div>

                    {(detailLine || row.injuryDetail) && (
                        <p className='mt-1 truncate text-xs text-[#7DD3FC]'>
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

                    {returnLabel && (
                        <p className='mt-1 text-[0.65rem] text-muted-foreground'>
                            Retour prévu:{' '}
                            <span className='font-semibold text-[#7DD3FC]'>
                                {returnLabel}
                            </span>
                        </p>
                    )}
                </div>

                {/* Right: fantasy team ownership */}
                {row.fantasyTeamName && (
                    <div className='shrink-0 self-center text-right'>
                        <div
                            className='flex items-center gap-1 text-xs font-semibold'
                            style={{
                                color: '#00E5FF',
                                textShadow: '0 0 6px rgba(0, 229, 255, 0.35)',
                            }}
                        >
                            <User className='h-3 w-3' />
                            <span className='truncate max-w-[10rem]'>
                                {row.fantasyTeamName}
                            </span>
                        </div>
                        {row.rosterStatus && (
                            <span className='text-[0.6rem] uppercase tracking-wider text-[#7DD3FC]'>
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
            </div>
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

    /**
     * Players who belong to a fantasy team are shown first, then the
     * rest. Within each group, the API's original order (alphabetical
     * by last name) is preserved, so this is a stable partition rather
     * than a full re-sort.
     */
    const sortedRows = useMemo(() => {
        const onTeam: InjuryRow[] = [];
        const freeAgents: InjuryRow[] = [];

        for (const r of rows) {
            if (r.fantasyTeamId != null) {
                onTeam.push(r);
            } else {
                freeAgents.push(r);
            }
        }

        return [...onTeam, ...freeAgents];
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

    const selectClass =
        'rounded-md border bg-[#080D1A] px-2 py-1.5 text-xs font-semibold uppercase tracking-wider text-[#00E5FF] focus:outline-none focus:ring-1 focus:ring-[#00E5FF]';

    return (
        <section className='w-full space-y-4'>
            <h2 className='text-center'>
                <NeonTitle keepPulseOnMobile>Blessures</NeonTitle>
            </h2>

            {/* ---- Filters panel ---- */}
            <div
                className='overflow-hidden rounded-lg border'
                style={{
                    borderColor: FRAME_BORDER,
                    backgroundColor: FRAME_BG,
                    boxShadow: FRAME_GLOW,
                }}
            >
                {/* Header bar */}
                <div
                    className='flex items-center gap-2 border-b px-3 py-2'
                    style={{
                        borderColor: 'rgba(0, 168, 255, 0.35)',
                        background: HEADER_GRADIENT,
                    }}
                >
                    <Search
                        className='h-4 w-4 shrink-0'
                        style={{
                            color: '#00E5FF',
                            filter:
                                'drop-shadow(0 0 6px rgba(0, 229, 255, 0.85)) drop-shadow(0 0 14px rgba(0, 229, 255, 0.4))',
                        }}
                    />

                    <input
                        type='text'
                        value={searchText}
                        placeholder='RECHERCHER UN JOUEUR'
                        autoComplete='off'
                        onChange={(e) => setSearchText(e.target.value)}
                        className='w-full bg-transparent text-sm font-semibold uppercase tracking-wider text-[#00E5FF] placeholder:text-[#00E5FF]/40 focus:outline-none'
                        style={{
                            textShadow:
                                '0 0 8px rgba(0, 229, 255, 0.35)',
                        }}
                    />

                    {searchText && (
                        <button
                            type='button'
                            aria-label='Effacer la recherche'
                            onClick={() => setSearchText('')}
                            className='cursor-pointer rounded-md p-1 text-[#00E5FF] transition-colors hover:bg-[#00A8FF]/15'
                        >
                            <X className='h-3.5 w-3.5' />
                        </button>
                    )}
                </div>

                {/* Filter selects */}
                <div className='grid grid-cols-2 gap-2 px-3 py-2.5 md:grid-cols-3'>
                    <select
                        value={kindFilter}
                        onChange={(e) =>
                            setKindFilter(e.target.value as KindFilter)
                        }
                        className={selectClass}
                        style={{ borderColor: 'rgba(0, 168, 255, 0.4)' }}
                    >
                        <option value='all'>TOUT</option>
                        <option value='Injury'>BLESSURES</option>
                        <option value='Suspension'>SUSPENSIONS</option>
                    </select>

                    <select
                        value={ownerFilter}
                        onChange={(e) =>
                            setOwnerFilter(e.target.value as OwnerFilter)
                        }
                        className={selectClass}
                        style={{ borderColor: 'rgba(0, 168, 255, 0.4)' }}
                    >
                        <option value='all'>TOUTES LES ÉQUIPES</option>
                        <option value='mine'>MON ÉQUIPE</option>
                        <option value='freeAgents'>AGENTS LIBRES</option>
                    </select>

                    <select
                        value={nhlTeamFilter}
                        onChange={(e) => setNhlTeamFilter(e.target.value)}
                        className={cn(
                            'col-span-2 md:col-span-1',
                            selectClass,
                        )}
                        style={{ borderColor: 'rgba(0, 168, 255, 0.4)' }}
                    >
                        <option value=''>TOUTES LES ÉQUIPES LNH</option>
                        {nhlTeams.map((t) => (
                            <option key={t} value={t}>
                                {t}
                            </option>
                        ))}
                    </select>
                </div>

                {hasFilters && (
                    <div
                        className='flex justify-end border-t px-3 py-1.5'
                        style={{
                            borderColor: 'rgba(0, 168, 255, 0.2)',
                        }}
                    >
                        <button
                            type='button'
                            onClick={clearFilters}
                            className='cursor-pointer rounded px-1.5 py-0.5 text-[0.7rem] uppercase tracking-wider text-[#7DD3FC] transition-colors hover:text-[#00E5FF]'
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

            {sortedRows.length > 0 && (
                <div className='space-y-2'>
                    {sortedRows.map((row) => (
                        <InjuryCard key={row.playerId} row={row} />
                    ))}
                </div>
            )}
        </section>
    );
}