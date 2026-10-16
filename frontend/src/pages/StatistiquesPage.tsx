import {
    memo,
    useCallback,
    useEffect,
    useMemo,
    useRef,
    useState,
} from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useWindowVirtualizer } from '@tanstack/react-virtual';
import InjuriesPage from '@/pages/InjuriesPage';
import { NhlTeamLogo } from '@/components/nhl/NhlTeamLogo';
import { useAuth } from '@/lib/AuthContext';
import { getFantasyTeamColor } from '@/lib/fantasyTeamColors';
import {
    getTopScorers,
    type TopScorerRow,
} from '@/api/client';

type MainTab = 'players' | 'teams';
type PlayersTab = 'scorers' | 'injuries';

// ---------------------------------------------------------------------
// Hoisted style objects
// ---------------------------------------------------------------------

const MAIN_BUTTON_CONTAINER_STYLE: React.CSSProperties = {
    boxShadow:
        '0 0 4px rgba(0, 168, 255, 0.5), 0 0 10px rgba(0, 168, 255, 0.25), inset 0 0 6px rgba(0, 168, 255, 0.1)',
};

const MAIN_BUTTON_ACTIVE_STYLE: React.CSSProperties = {
    boxShadow:
        '0 0 4px rgba(255, 255, 255, 0.7), 0 0 8px rgba(0, 168, 255, 0.5), 0 0 16px rgba(0, 168, 255, 0.2), inset 0 0 3px rgba(0, 168, 255, 0.3)',
};

const SUB_TOGGLE_CONTAINER_STYLE: React.CSSProperties = {
    boxShadow:
        '0 0 6px rgba(0, 229, 255, 0.35), inset 0 0 6px rgba(0, 229, 255, 0.08)',
};

const MY_TEAM_ROW_BACKGROUND = 'rgba(125, 249, 255, 0.15)';

// ---------------------------------------------------------------------
// Sorting
// ---------------------------------------------------------------------

/**
 * Colonnes triables. Le rang (#) et la colonne Joueur ne le sont
 * pas : le premier est dérivé de l'ordre courant, la seconde est
 * du texte libre dont le tri alpha n'apporte rien ici.
 */
type SortKey =
    | 'fp'
    | 'points'
    | 'goals'
    | 'assists'
    | 'gamesPlayed'
    | 'hatTricks'
    | 'timeOnIce';

type SortDirection = 'asc' | 'desc';

interface SortState {
    key: SortKey;
    direction: SortDirection;
}

function parseToiSeconds(toi: string | null): number | null {
    if (!toi) return null;

    const parts = toi.split(':');

    if (parts.length !== 2) return null;

    const m = Number(parts[0]);
    const s = Number(parts[1]);

    if (!Number.isFinite(m) || !Number.isFinite(s)) return null;

    return m * 60 + s;
}

/**
 * Compare deux valeurs potentiellement nulles :
 *   - null = null : égalité
 *   - null vs valeur : le null passe TOUJOURS en dernier, quel que
 *     soit le sens du tri. Un joueur sans match NHL cette saison
 *     reste en bas même quand on trie en ordre croissant.
 *   - valeur vs valeur : comparaison normale selon direction
 */
function compareNullable(
    a: number | null,
    b: number | null,
    direction: SortDirection,
): number {
    if (a == null && b == null) return 0;
    if (a == null) return 1;
    if (b == null) return -1;
    return direction === 'desc' ? b - a : a - b;
}

// ---------------------------------------------------------------------
// Top scorers ("Meilleurs pointeurs")
// ---------------------------------------------------------------------

type PositionGroup = 'F' | 'D' | 'G';

function toPositionGroup(position: string): PositionGroup {
    const p = position.trim().toUpperCase();

    if (
        p === 'G' ||
        p === 'GK' ||
        p === 'GB' ||
        p === 'GOALIE' ||
        p === 'GOALTENDER' ||
        p === 'GARDIEN'
    ) {
        return 'G';
    }

    if (
        p === 'D' ||
        p === 'LD' ||
        p === 'RD' ||
        p === 'DEFENSE' ||
        p === 'DEFENCE' ||
        p === 'DEFENSEMAN' ||
        p === 'DEFENSEUR'
    ) {
        return 'D';
    }

    return 'F';
}

function positionBarGradient(group: PositionGroup): string {
    let accent = '#FF0F3D';
    let mid = '#FF4A62';
    let core = '#FF6878';

    if (group === 'D') {
        accent = '#3B82F6';
        mid = '#5C97F8';
        core = '#7AA8FA';
    } else if (group === 'G') {
        accent = '#22C55E';
        mid = '#3ECD6E';
        core = '#5AD786';
    }

    return `linear-gradient(to right, ${accent} 0px 1.5px, ${mid} 1.5px 2.5px, ${core} 2.5px 3.5px, ${mid} 3.5px 4.5px, ${accent} 4.5px 6px, transparent 6px)`;
}

function shortName(firstName: string, lastName: string): string {
    const initial = firstName.trim().charAt(0);
    return initial ? `${initial}. ${lastName}` : lastName;
}

/**
 * Abrège certains noms d'équipe fantasy pour gagner de la place
 * dans le tableau. Les équipes absentes du map s'affichent avec
 * leur nom complet, donc ajouter une équipe se fait juste en
 * ajoutant une ligne ci-dessous.
 */
const FANTASY_TEAM_SHORT_NAMES: Record<string, string> = {
    Olivier: 'Oli',
    Mathieu: 'Math',
};

function shortTeamName(name: string): string {
    return FANTASY_TEAM_SHORT_NAMES[name] ?? name;
}

/**
 * Colonnes du tableau "Meilleurs pointeurs".
 *
 * La valeur par défaut (fallback du var) est utilisée sur les
 * écrans < 400px : c'est la version d'origine, inchangée.
 *
 * Sur les écrans >= 400px, `index.css` redéfinit
 * `--stats-grid-columns` avec des colonnes de stats plus larges,
 * ce qui réduit d'autant la colonne du nom / contrat (en
 * minmax(0, 1fr), elle absorbe la perte).
 *
 * Passer par une CSS variable plutôt que par un state React évite
 * un listener de resize et garantit que le header et les lignes
 * partagent la même grille à tout instant.
 */
const GRID_COLUMNS =
    'var(--stats-grid-columns, 18px 22px minmax(0, 1fr) 23px 24px 24px 24px 22px 42px 24px)';

const ESTIMATED_ROW_HEIGHT = 42;

/**
 * Hauteur fixe du slot réservé pour la flèche de tri, sous chaque
 * label de colonne. Le slot est toujours présent (vide quand la
 * colonne n'est pas active) pour que la hauteur du header ne change
 * JAMAIS quand on clique sur une autre colonne.
 */
const SORT_ARROW_SLOT_HEIGHT = '0.6rem';

/**
 * Cellule de header non triable (le rang "#" et "Joueur").
 * Structure identique aux cellules triables — label + slot vide —
 * pour que tous les labels du header restent alignés verticalement.
 */
const StaticHeader = memo(function StaticHeader({
    label,
    color,
    colSpan = 1,
}: {
    label: string;
    color: string;
    colSpan?: number;
}) {
    return (
        <div
            className='flex flex-col items-center justify-center'
            style={{ gridColumn: `span ${colSpan}` }}
        >
            <span
                className='leading-none'
                style={{ color }}
            >
                {label}
            </span>
            <span
                className='block'
                style={{ height: SORT_ARROW_SLOT_HEIGHT }}
                aria-hidden='true'
            />
        </div>
    );
});

/**
 * Header de colonne triable. Affiche une flèche ▲ / ▼ SOUS le
 * label, dans un slot de hauteur fixe aligné en bas du header.
 *
 * Le slot utilise items-end pour pousser la flèche le plus bas
 * possible dans sa boîte : combiné au padding-bottom supprimé sur
 * le header parent, la flèche arrive collée à la bordure
 * inférieure du header.
 */
const SortableHeader = memo(function SortableHeader({
    label,
    sortKey,
    activeSortKey,
    sortDirection,
    onSort,
    color,
    activeColor = '#FFFFFF',
    compact = false,
}: {
    label: string;
    sortKey: SortKey;
    activeSortKey: SortKey;
    sortDirection: SortDirection;
    onSort: (key: SortKey) => void;
    color: string;
    activeColor?: string;
    compact?: boolean;
}) {
    const active = activeSortKey === sortKey;

    const directionLabel =
        sortDirection === 'asc' ? 'croissant' : 'décroissant';

    return (
        <button
            type='button'
            onClick={() => onSort(sortKey)}
            className={`flex cursor-pointer select-none flex-col items-center justify-center border-0 bg-transparent p-0 font-bold uppercase tracking-wider transition-colors hover:text-white ${compact ? 'text-[0.55rem] sm:text-[0.65rem]' : ''
                }`}
            style={{ color: active ? activeColor : color }}
            aria-label={
                active
                    ? `Trier par ${label} (${directionLabel})`
                    : `Trier par ${label}`
            }
            aria-pressed={active}
        >
            <span className='leading-none'>{label}</span>
            <span
                className='flex items-end justify-center text-[0.55rem] leading-none'
                style={{ height: SORT_ARROW_SLOT_HEIGHT }}
                aria-hidden='true'
            >
                {active && (sortDirection === 'asc' ? '▲' : '▼')}
            </span>
        </button>
    );
});

const TopScorersHeader = memo(function TopScorersHeader({
    sortKey,
    sortDirection,
    onSort,
}: {
    sortKey: SortKey;
    sortDirection: SortDirection;
    onSort: (key: SortKey) => void;
}) {
    return (
        <div
            className='grid w-full items-center gap-x-0.5 pt-2 pl-1 pr-2 text-[0.6rem] font-bold uppercase tracking-wider sm:text-[0.7rem]'
            style={{
                gridTemplateColumns: GRID_COLUMNS,
                borderLeft: '2px solid transparent',
                background: [
                    'linear-gradient(to right, #33BBFF 0px 1px, transparent 1px)',
                    'linear-gradient(180deg, rgba(0, 136, 255, 0.18), rgba(0, 136, 255, 0.02))',
                ].join(', '),
                backgroundOrigin: 'border-box',
                backgroundClip: 'border-box',
                backgroundColor: '#050A16',
            }}
        >
            <StaticHeader label='#' color='#7DD3FC' />

            <StaticHeader label='Joueur' color='#FFFFFF' colSpan={2} />

            <SortableHeader
                label='GP'
                sortKey='gamesPlayed'
                activeSortKey={sortKey}
                sortDirection={sortDirection}
                onSort={onSort}
                color='#33BBFF'
            />

            <SortableHeader
                label='G'
                sortKey='goals'
                activeSortKey={sortKey}
                sortDirection={sortDirection}
                onSort={onSort}
                color='#FFFFFF'
            />

            <SortableHeader
                label='A'
                sortKey='assists'
                activeSortKey={sortKey}
                sortDirection={sortDirection}
                onSort={onSort}
                color='#FFFFFF'
            />

            <SortableHeader
                label='PTS'
                sortKey='points'
                activeSortKey={sortKey}
                sortDirection={sortDirection}
                onSort={onSort}
                color='#00F0FF'
            />

            <SortableHeader
                label='3B'
                sortKey='hatTricks'
                activeSortKey={sortKey}
                sortDirection={sortDirection}
                onSort={onSort}
                color='#FFFFFF'
            />

            <SortableHeader
                label='ATOI'
                sortKey='timeOnIce'
                activeSortKey={sortKey}
                sortDirection={sortDirection}
                onSort={onSort}
                color='#FFFFFF'
                compact
            />

            <SortableHeader
                label='FP'
                sortKey='fp'
                activeSortKey={sortKey}
                sortDirection={sortDirection}
                onSort={onSort}
                color='#FFC72C'
                activeColor='#FFC72C'
            />
        </div>
    );
});

const TopScorersRow = memo(function TopScorersRow({
    row,
    rank,
    isMine,
}: {
    row: TopScorerRow;
    rank: number;
    isMine: boolean;
}) {
    const navigate = useNavigate();

    const group = toPositionGroup(row.position);

    const teamColor = getFantasyTeamColor(row.fantasyTeamId);

    function handleTeamClick(e: React.SyntheticEvent) {
        e.preventDefault();
        e.stopPropagation();
        navigate(`/mon-equipe?teamId=${row.fantasyTeamId}`);
    }

    return (
        <Link
            to={`/joueurs/${row.nhlPlayerId}`}
            className='grid h-full w-full items-center gap-x-0.5 border-b py-1 pl-1 pr-2 text-[0.9rem] tabular-nums transition-[filter] duration-150 hover:brightness-110'
            style={{
                gridTemplateColumns: GRID_COLUMNS,
                borderLeft: '6px solid transparent',
                backgroundImage: positionBarGradient(group),
                backgroundOrigin: 'border-box',
                backgroundClip: 'border-box',
                backgroundColor: isMine
                    ? MY_TEAM_ROW_BACKGROUND
                    : undefined,
                borderBottomColor: 'rgba(51, 187, 255, 0.12)',
            }}
        >
            <div className='text-center text-[0.75rem] font-semibold text-white/80'>
                {rank}
            </div>

            <div className='flex self-stretch items-center justify-center'>
                <div
                    style={{
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        height: '100%',
                        aspectRatio: '1 / 1',
                        flexShrink: 0,
                        transform: 'scale(1.25)',
                        transformOrigin: 'center',
                    }}
                >
                    <NhlTeamLogo
                        abbreviation={row.nhlTeamAbbreviation}
                        fillHeight
                    />
                </div>
            </div>

            {(() => {
                const teamLabel = row.fantasyTeamName
                    ? shortTeamName(row.fantasyTeamName)
                    : null;

                return (
                    <div className='min-w-0 pl-[6px] text-left'>
                        <div className='truncate text-[0.95rem] max-[399px]:leading-[1.17rem] text-foreground translate-y-[3px] min-[400px]:text-[1.05rem] min-[400px]:leading-[1.30rem]'>
                            {shortName(row.firstName, row.lastName)}
                        </div>
                        {teamLabel && (
                            <div className='flex items-center gap-1 leading-tight translate-y-[3px]'>
                                <span
                                    role='button'
                                    tabIndex={0}
                                    onClick={handleTeamClick}
                                    onKeyDown={(e) => {
                                        if (
                                            e.key === 'Enter' ||
                                            e.key === ' '
                                        ) {
                                            handleTeamClick(e);
                                        }
                                    }}
                                    aria-label={`Voir l'équipe ${row.fantasyTeamName}`}
                                    className='shrink-0 cursor-pointer text-[0.45rem] font-semibold hover:underline focus:outline-none focus-visible:underline'
                                    style={{ color: teamColor }}
                                >
                                    {teamLabel}
                                </span>
                            </div>
                        )}
                    </div>
                );
            })()}

            <div className='text-center text-[0.9rem] text-[#7DD3FC] min-[400px]:text-[0.95rem]'>
                {row.gamesPlayed}
            </div>
            <div className='text-center text-[0.9rem] text-white min-[400px]:text-[0.95rem]'>
                {row.goals}
            </div>
            <div className='text-center text-[0.9rem] text-white min-[400px]:text-[0.95rem]'>
                {row.assists}
            </div>
            <div className='text-center text-[0.95rem] text-[#00F0FF] min-[400px]:text-[1rem]'>
                {row.points}
            </div>
            <div className='text-center text-[0.9rem] text-white min-[400px]:text-[0.95rem]'>
                {row.hatTricks}
            </div>
            <div className='text-center text-[0.65rem] text-white min-[400px]:text-[0.75rem]'>
                {row.timeOnIce ?? '—'}
            </div>
            <div className='text-center text-[0.95rem] font-bold text-[#FFC72C] min-[400px]:text-[1rem]'>
                {row.fantasyPoints == null ? '—' : row.fantasyPoints}
            </div>
        </Link>
    );
});

const TopScorersTable = memo(function TopScorersTable({
    rows,
    loading,
    error,
    myTeamId,
}: {
    rows: TopScorerRow[];
    loading: boolean;
    error: string | null;
    myTeamId: number | null;
}) {
    const listRef = useRef<HTMLDivElement | null>(null);

    const [scrollMargin, setScrollMargin] = useState(0);

    const [sort, setSort] = useState<SortState>({
        key: 'fp',
        direction: 'desc',
    });

    const handleSort = useCallback((key: SortKey) => {
        setSort((prev) => {
            if (prev.key === key) {
                return {
                    key,
                    direction:
                        prev.direction === 'asc' ? 'desc' : 'asc',
                };
            }
            return { key, direction: 'desc' };
        });
    }, []);

    const sortedRows = useMemo(() => {
        const copy = [...rows];

        copy.sort((a, b) => {
            let cmp = 0;

            switch (sort.key) {
                case 'fp':
                    cmp = compareNullable(
                        a.fantasyPoints,
                        b.fantasyPoints,
                        sort.direction,
                    );
                    break;
                case 'points':
                    cmp = compareNullable(
                        a.points,
                        b.points,
                        sort.direction,
                    );
                    break;
                case 'goals':
                    cmp = compareNullable(
                        a.goals,
                        b.goals,
                        sort.direction,
                    );
                    break;
                case 'assists':
                    cmp = compareNullable(
                        a.assists,
                        b.assists,
                        sort.direction,
                    );
                    break;
                case 'gamesPlayed':
                    cmp = compareNullable(
                        a.gamesPlayed,
                        b.gamesPlayed,
                        sort.direction,
                    );
                    break;
                case 'hatTricks':
                    cmp = compareNullable(
                        a.hatTricks,
                        b.hatTricks,
                        sort.direction,
                    );
                    break;
                case 'timeOnIce':
                    cmp = compareNullable(
                        parseToiSeconds(a.timeOnIce),
                        parseToiSeconds(b.timeOnIce),
                        sort.direction,
                    );
                    break;
            }

            if (cmp !== 0) return cmp;

            const aFp = a.fantasyPoints ?? -1;
            const bFp = b.fantasyPoints ?? -1;

            if (aFp !== bFp) return bFp - aFp;
            if (a.points !== b.points) return b.points - a.points;

            return a.lastName < b.lastName
                ? -1
                : a.lastName > b.lastName
                    ? 1
                    : 0;
        });

        return copy;
    }, [rows, sort]);

    useEffect(() => {
        const measure = () => {
            if (!listRef.current) return;

            const top =
                listRef.current.getBoundingClientRect().top +
                window.scrollY;

            setScrollMargin(top);
        };

        measure();

        window.addEventListener('resize', measure);

        return () => {
            window.removeEventListener('resize', measure);
        };
    }, [sortedRows.length]);

    const virtualizer = useWindowVirtualizer({
        count: sortedRows.length,
        estimateSize: () => ESTIMATED_ROW_HEIGHT,
        overscan: 10,
        scrollMargin,
    });

    if (loading) {
        return (
            <p className='mt-3 text-center text-sm text-muted-foreground'>
                Chargement...
            </p>
        );
    }

    if (error) {
        return (
            <p className='mt-3 w-full rounded-lg border border-destructive/40 bg-destructive/10 px-3 py-2 text-center text-sm text-destructive'>
                {error}
            </p>
        );
    }

    if (sortedRows.length === 0) {
        return (
            <p className='mt-3 w-full rounded-lg border border-border bg-card px-3 py-6 text-center text-sm text-muted-foreground'>
                Aucun joueur sur une équipe fantasy.
            </p>
        );
    }

    const virtualItems = virtualizer.getVirtualItems();

    return (
        <div className='mt-3 w-full'>
            <div
                className='w-full overflow-hidden rounded-lg'
                style={{
                    borderTop: '1px solid #33BBFF',
                    borderRight: '1px solid #33BBFF',
                    borderBottom: '1px solid #33BBFF',
                    backgroundColor: '#050A16',
                }}
            >
                <TopScorersHeader
                    sortKey={sort.key}
                    sortDirection={sort.direction}
                    onSort={handleSort}
                />

                <div
                    ref={listRef}
                    style={{
                        height: virtualizer.getTotalSize(),
                        position: 'relative',
                        width: '100%',
                    }}
                >
                    {virtualItems.map((virtualItem) => {
                        const row = sortedRows[virtualItem.index];

                        const isMine =
                            myTeamId != null &&
                            row.fantasyTeamId === myTeamId;

                        return (
                            <div
                                key={row.playerId}
                                data-index={virtualItem.index}
                                ref={virtualizer.measureElement}
                                style={{
                                    position: 'absolute',
                                    top: 0,
                                    left: 0,
                                    width: '100%',
                                    transform: `translateY(${virtualItem.start - scrollMargin}px)`,
                                }}
                            >
                                <TopScorersRow
                                    row={row}
                                    rank={virtualItem.index + 1}
                                    isMine={isMine}
                                />
                            </div>
                        );
                    })}
                </div>
            </div>
        </div>
    );
});

// ---------------------------------------------------------------------
// StatistiquesPage
// ---------------------------------------------------------------------

export default function StatistiquesPage() {
    const { user } = useAuth();

    const myTeamId = user?.fantasyTeamId ?? null;

    const [mainTab, setMainTab] = useState<MainTab>('players');
    const [playersTab, setPlayersTab] =
        useState<PlayersTab>('scorers');

    const [scorerRows, setScorerRows] = useState<TopScorerRow[]>([]);
    const [scorerLoading, setScorerLoading] = useState(true);
    const [scorerError, setScorerError] = useState<string | null>(null);

    useEffect(() => {
        let cancelled = false;

        setScorerLoading(true);

        getTopScorers()
            .then((data) => {
                if (!cancelled) {
                    setScorerRows(data);
                    setScorerError(null);
                }
            })
            .catch(() => {
                if (!cancelled) {
                    setScorerError(
                        'Impossible de charger les statistiques des joueurs.',
                    );
                }
            })
            .finally(() => {
                if (!cancelled) {
                    setScorerLoading(false);
                }
            });

        return () => {
            cancelled = true;
        };
    }, []);

    const [hasVisitedInjuries, setHasVisitedInjuries] = useState(false);

    useEffect(() => {
        if (playersTab === 'injuries') {
            setHasVisitedInjuries(true);
        }
    }, [playersTab]);

    useEffect(() => {
        if (scorerLoading) return;
        if (hasVisitedInjuries) return;

        let cleanup: (() => void) | null = null;

        if (typeof window.requestIdleCallback === 'function') {
            const handle = window.requestIdleCallback(
                () => setHasVisitedInjuries(true),
                { timeout: 2000 },
            );

            cleanup = () => window.cancelIdleCallback(handle);
        } else {
            const timer = window.setTimeout(
                () => setHasVisitedInjuries(true),
                500,
            );

            cleanup = () => window.clearTimeout(timer);
        }

        return () => {
            cleanup?.();
        };
    }, [scorerLoading, hasVisitedInjuries]);

    return (
        <section className='-mt-4 flex min-h-full w-full flex-col items-center gap-3 pt-2.5 sm:-mt-6'>
            <div
                className='flex w-full items-center rounded-full border border-[#00A8FF] bg-[#050A18] p-0.5'
                style={MAIN_BUTTON_CONTAINER_STYLE}
            >
                <button
                    type='button'
                    onClick={() => setMainTab('players')}
                    className={`flex-1 cursor-pointer rounded-full px-2.5 py-0.5 text-xs font-bold transition-all duration-200 ${mainTab === 'players'
                            ? 'bg-white text-[#1D1B61]'
                            : 'bg-transparent text-[#F2F5FA] hover:bg-[#00A8FF]/15 hover:text-white'
                        }`}
                    style={
                        mainTab === 'players'
                            ? MAIN_BUTTON_ACTIVE_STYLE
                            : undefined
                    }
                >
                    Joueurs
                </button>

                <button
                    type='button'
                    onClick={() => setMainTab('teams')}
                    className={`flex-1 cursor-pointer rounded-full px-2.5 py-0.5 text-xs font-bold transition-all duration-200 ${mainTab === 'teams'
                            ? 'bg-white text-[#1D1B61]'
                            : 'bg-transparent text-[#F2F5FA] hover:bg-[#00A8FF]/15 hover:text-white'
                        }`}
                    style={
                        mainTab === 'teams'
                            ? MAIN_BUTTON_ACTIVE_STYLE
                            : undefined
                    }
                >
                    Équipes
                </button>
            </div>

            {mainTab === 'players' && (
                <div className='flex items-center justify-center'>
                    <div
                        className='marketplace-sub-toggle flex items-center rounded-full border border-[#00E5FF]/60 bg-[#050A18]/80 p-0.5 text-xs'
                        style={SUB_TOGGLE_CONTAINER_STYLE}
                    >
                        <button
                            type='button'
                            onClick={() => setPlayersTab('scorers')}
                            className={`cursor-pointer whitespace-nowrap rounded-full px-3 py-0.5 font-semibold transition-colors ${playersTab === 'scorers'
                                    ? 'bg-[#00E5FF] text-[#080D1A]'
                                    : 'bg-transparent text-[#A6ECFF] hover:text-white'
                                }`}
                        >
                            Meilleurs pointeurs
                        </button>

                        <button
                            type='button'
                            onClick={() => setPlayersTab('injuries')}
                            className={`cursor-pointer whitespace-nowrap rounded-full px-3 py-0.5 font-semibold transition-colors ${playersTab === 'injuries'
                                    ? 'bg-[#00E5FF] text-[#080D1A]'
                                    : 'bg-transparent text-[#A6ECFF] hover:text-white'
                                }`}
                        >
                            Blessures
                        </button>
                    </div>
                </div>
            )}

            <div
                className={
                    mainTab === 'players' && playersTab === 'scorers'
                        ? 'block w-full'
                        : 'hidden'
                }
            >
                <TopScorersTable
                    rows={scorerRows}
                    loading={scorerLoading}
                    error={scorerError}
                    myTeamId={myTeamId}
                />
            </div>

            {hasVisitedInjuries && (
                <div
                    className={
                        mainTab === 'players' &&
                            playersTab === 'injuries'
                            ? 'mt-4 block w-full sm:mt-6'
                            : 'hidden'
                    }
                >
                    <InjuriesPage hideTitle />
                </div>
            )}
        </section>
    );
}