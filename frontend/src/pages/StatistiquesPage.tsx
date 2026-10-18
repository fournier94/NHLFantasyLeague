import {
    memo,
    useCallback,
    useEffect,
    useMemo,
    useRef,
    useState,
} from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { useWindowVirtualizer } from '@tanstack/react-virtual';
import InjuriesPage from '@/pages/InjuriesPage';
import { NhlTeamLogo } from '@/components/nhl/NhlTeamLogo';
import { useAuth } from '@/lib/AuthContext';
import { getFantasyTeamColor } from '@/lib/fantasyTeamColors';
import { getNhlTeamAuraColor, getNhlTeamColor, getNhlTeamTextColor } from '@/lib/nhlTeamColors';
import {
    getNhlStandings,
    getTopScorers,
    type NhlTeamStandingsRow,
    type TopScorerRow,
    type PlayerContractLine,
} from '@/api/client';
import { getStatsFilters, setStatsFilters } from '@/lib/statsFiltersState';

type MainTab = 'players' | 'injuries' | 'teams';

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
    | 'timeOnIce'
    | 'wins'
    | 'losses'
    | 'overtimeLosses'
    | 'shutouts'
    | 'savePercentage'
    | 'goalsAgainstAverage';

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
 * Couleur utilisée pour un contrat qui n'a plus qu'une seule
 * année restante. Même jaune que sur MonEquipePage : jaune vif,
 * distinct du vert des contrats "sains" et du or (#FFC72C)
 * réservé au FP et au classement.
 */
const EXPIRING_CONTRACT_COLOR = '#FACC15';

/**
 * Formate une ligne de contrat pour le tableau des pointeurs.
 * Même logique que MonEquipePage : "10M · 5 ans" ou "10M · 1 an".
 *
 * Un contrat qui n'a plus qu'une seule année restante est rendu
 * entièrement en jaune (salaire + durée), pour signaler au
 * manager que le joueur sera à re-signer à la fin de la saison.
 */
function formatContract(c: PlayerContractLine | null): React.ReactNode {
    if (!c) return '';
    const salary = (c.salary / 1_000_000).toFixed(2).replace(/\.?0+$/, '') + 'M';
    const years = c.yearsRemaining > 1 ? `${c.yearsRemaining} ans` : '1 an';

    const content = (
        <>
            {salary}
            <span className='mx-1 font-bold'>·</span>
            {years}
        </>
    );

    return c.yearsRemaining === 1 ? (
        <span style={{ color: EXPIRING_CONTRACT_COLOR }}>
            {content}
        </span>
    ) : (
        content
    );
}

/**
 * Accepte "2", "2M", "2m", "2000000" et les convertit tous en
 * 2000000. Accepte aussi "k" pour les milliers.
 */
function parseSalaryInput(input: string): number | null {
    if (!input) return null;
    let val = input.trim().toLowerCase();
    if (!val) return null;
    let multiplier = 1;
    let hasSuffix = false;

    if (val.endsWith('m')) {
        multiplier = 1_000_000;
        val = val.slice(0, -1);
        hasSuffix = true;
    } else if (val.endsWith('k')) {
        multiplier = 1_000;
        val = val.slice(0, -1);
        hasSuffix = true;
    }

    const num = parseFloat(val);
    if (isNaN(num)) return null;

    // If the user types a bare number < 1000 (like "2"), assume they mean millions.
    // If they type a full number like "2000000", it stays as-is.
    if (!hasSuffix && num < 1000) {
        multiplier = 1_000_000;
    }

    return num * multiplier;
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
/**
 * Colonnes du tableau "Meilleurs pointeurs".
 *
 * Colonne 3B retirée, colonne Team ajoutée juste après le rang.
 * La valeur par défaut (fallback du var) est utilisée sur les
 * écrans < 400px. Sur les écrans >= 400px, `index.css` redéfinit
 * `--stats-grid-columns` avec une version légèrement élargie.
 *
 * Layout (10 colonnes) :
 *   #    rank
 *   Team nom d'équipe fantasy (shortTeamName)
 *   logo équipe LNH
 *   nom  joueur (flexible)
 *   GP / G / A / PTS / ATOI / FP
 */
const GRID_COLUMNS =
    'var(--stats-grid-columns, 18px 28px 22px minmax(0, 1fr) 22px 22px 22px 24px 40px 28px)';

/**
 * Grille spécifique aux gardiens. Deux colonnes de plus que la
 * grille patineur : W, L, OTL, SO, SV% et GAA remplacent
 * G / A / PTS / ATOI, ce qui donne 12 colonnes au total contre
 * 10 pour les patineurs.
 *
 * Sur les écrans >= 400px, `index.css` redéfinit
 * `--stats-grid-goalie-columns` avec la version élargie.
 * La valeur de fallback ici est donc la version mobile.
 */
const GRID_COLUMNS_GOALIE =
    'var(--stats-grid-goalie-columns, 14px 20px 18px minmax(0, 1fr) 18px 14px 12px 18px 15px 28px 24px 20px)';

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
    showGoalieColumns,
}: {
    sortKey: SortKey;
    sortDirection: SortDirection;
    onSort: (key: SortKey) => void;
    /**
     * True quand le filtre "Gardiens" est actif. Le header bascule
     * alors sur la grille gardien : W / L / OTL / SO / SV% / GAA
     * remplacent G / A / PTS / ATOI.
     */
    showGoalieColumns: boolean;
}) {
    return (
        <div
            className={`grid w-full items-center pt-2 pl-1 pr-2 text-[0.6rem] font-bold uppercase tracking-wider sm:text-[0.7rem] ${showGoalieColumns ? 'gap-x-1' : 'gap-x-0.5'
                }`}
            style={{
                gridTemplateColumns: showGoalieColumns
                    ? GRID_COLUMNS_GOALIE
                    : GRID_COLUMNS,
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
            <StaticHeader label='Team' color='#FFFFFF' />
            <StaticHeader label='Joueur' color='#FFFFFF' colSpan={2} />

            <SortableHeader
                label='GP'
                sortKey='gamesPlayed'
                activeSortKey={sortKey}
                sortDirection={sortDirection}
                onSort={onSort}
                color='#33BBFF'
            />

            {showGoalieColumns ? (
                <>
                    <SortableHeader label='W' sortKey='wins' activeSortKey={sortKey} sortDirection={sortDirection} onSort={onSort} color='#00F0FF' />
                    <SortableHeader label='L' sortKey='losses' activeSortKey={sortKey} sortDirection={sortDirection} onSort={onSort} color='#FFFFFF' />
                    <SortableHeader label='OTL' sortKey='overtimeLosses' activeSortKey={sortKey} sortDirection={sortDirection} onSort={onSort} color='#FFFFFF' compact />
                    <SortableHeader label='SO' sortKey='shutouts' activeSortKey={sortKey} sortDirection={sortDirection} onSort={onSort} color='#FFFFFF' />
                    <SortableHeader label='SV%' sortKey='savePercentage' activeSortKey={sortKey} sortDirection={sortDirection} onSort={onSort} color='#FFFFFF' compact />
                    <SortableHeader label='GAA' sortKey='goalsAgainstAverage' activeSortKey={sortKey} sortDirection={sortDirection} onSort={onSort} color='#FFFFFF' compact />
                </>
            ) : (
                <>
                    <SortableHeader label='G' sortKey='goals' activeSortKey={sortKey} sortDirection={sortDirection} onSort={onSort} color='#FFFFFF' />
                    <SortableHeader label='A' sortKey='assists' activeSortKey={sortKey} sortDirection={sortDirection} onSort={onSort} color='#FFFFFF' />
                    <SortableHeader label='PTS' sortKey='points' activeSortKey={sortKey} sortDirection={sortDirection} onSort={onSort} color='#00F0FF' />
                    <SortableHeader label='ATOI' sortKey='timeOnIce' activeSortKey={sortKey} sortDirection={sortDirection} onSort={onSort} color='#FFFFFF' compact />
                </>
            )}

            <SortableHeader label='FP' sortKey='fp' activeSortKey={sortKey} sortDirection={sortDirection} onSort={onSort} color='#FFC72C' activeColor='#FFC72C' />
        </div>
    );
});

const TopScorersRow = memo(function TopScorersRow({
    row,
    rank,
    isMine,
    showGoalieColumns,
    showContracts,
}: {
    row: TopScorerRow;
    rank: number;
    isMine: boolean;
    /**
     * True quand le filtre "Gardiens" est actif. Les colonnes du
     * milieu basculent sur W / L / OTL / SO / SV% / GAA à la place
     * de G / A / PTS / ATOI.
     */
    showGoalieColumns: boolean;
    /**
     * True quand la case "Afficher les contrats" est cochée.
     * Affiche le salaire et les années restantes sous le nom
     * du joueur, comme sur MonEquipePage.
     */
    showContracts: boolean;
}) {
    const navigate = useNavigate();

    const group = toPositionGroup(row.position);

    const teamColor = getFantasyTeamColor(row.fantasyTeamId);

    const teamLabel = row.fantasyTeamName
        ? shortTeamName(row.fantasyTeamName)
        : null;

    function handleTeamClick(e: React.SyntheticEvent) {
        e.preventDefault();
        e.stopPropagation();
        if (row.fantasyTeamId != null) {
            navigate(`/mon-equipe?teamId=${row.fantasyTeamId}`);
        }
    }

    return (
        <Link
            to={`/joueurs/${row.nhlPlayerId}`}
            className={`grid h-full w-full items-center border-b py-1 pl-1 pr-2 text-[0.9rem] tabular-nums transition-[filter] duration-150 hover:brightness-110 ${showGoalieColumns ? 'gap-x-1' : 'gap-x-0.5'
                }`}
            style={{
                gridTemplateColumns: showGoalieColumns
                    ? GRID_COLUMNS_GOALIE
                    : GRID_COLUMNS,
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

            {/* Team — nom d'équipe fantasy, dans sa propre colonne
                à droite du rang. Cliquable pour naviguer vers la
                page Mon équipe de cette équipe, comme partout
                ailleurs. */}
            <div className='flex min-w-0 items-center justify-center'>
                {teamLabel && row.fantasyTeamId != null && (
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
                        className={`cursor-pointer truncate font-semibold hover:underline focus:outline-none focus-visible:underline ${showGoalieColumns
                            ? 'text-[0.55rem]'
                            : 'text-[0.65rem]'
                            }`}
                        style={{ color: teamColor }}
                    >
                        {teamLabel}
                    </span>
                )}
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

            <div className='min-w-0 pl-1 text-left flex flex-col justify-center'>
                <div
                    className={`truncate text-foreground ${showContracts && (row.currentContract || row.secondContract) ? 'translate-y-[2.5px]' : ''
                        } ${showGoalieColumns
                            ? 'text-[0.65rem] max-[399px]:leading-[0.90rem] min-[400px]:text-[0.75rem] min-[400px]:leading-[1.00rem]'
                            : 'text-[0.90rem] max-[399px]:leading-[1.17rem] min-[400px]:text-[1rem] min-[400px]:leading-[1.30rem]'
                        }`}
                >
                    {shortName(row.firstName, row.lastName)}
                </div>
                {showContracts && (row.currentContract || row.secondContract) && (
                    <div className='truncate leading-tight text-[#22C55E] text-[0.60rem] max-[399px]:text-[0.55rem] mt-0.5'>
                        {row.currentContract ? formatContract(row.currentContract) : ''}
                        {row.currentContract && row.secondContract ? <span className='inline-block mx-0.5 text-[0.7rem] opacity-80 scale-x-[0.75]'>→</span> : ''}
                        {row.secondContract ? formatContract(row.secondContract) : ''}
                    </div>
                )}
            </div>

            <div
                className={`text-center text-[#7DD3FC] ${showGoalieColumns
                    ? 'text-[0.85rem] min-[400px]:text-[0.9rem]'
                    : 'text-[0.9rem] min-[400px]:text-[0.95rem]'
                    }`}
            >
                {row.gamesPlayed}
            </div>

            {showGoalieColumns ? (
                <>
                    <div className='text-center text-[0.85rem] text-[#00F0FF] min-[400px]:text-[0.9rem]'>
                        {row.wins}
                    </div>
                    <div className='text-center text-[0.85rem] text-white min-[400px]:text-[0.9rem]'>
                        {row.losses}
                    </div>
                    <div className='text-center text-[0.85rem] text-white min-[400px]:text-[0.9rem]'>
                        {row.overtimeLosses}
                    </div>
                    <div className='text-center text-[0.85rem] text-white min-[400px]:text-[0.9rem]'>
                        {row.shutouts}
                    </div>
                    <div className='text-center text-[0.55rem] text-white min-[400px]:text-[0.65rem]'>
                        {row.savePercentage.toFixed(3)}
                    </div>
                    <div className='text-center text-[0.55rem] text-white min-[400px]:text-[0.65rem]'>
                        {row.goalsAgainstAverage.toFixed(2)}
                    </div>
                </>
            ) : toPositionGroup(row.position) === 'G' ? (
                <div className='col-span-4 flex items-center justify-center whitespace-nowrap text-[0.75rem] min-[400px]:text-[0.85rem] overflow-hidden text-ellipsis'>
                    <span style={{ color: '#00F0FF' }}>{row.wins} W</span>
                    <span className='font-bold text-white/50'>&nbsp;&nbsp;&bull;&nbsp;&nbsp;</span>
                    <span className='text-white'>{row.shutouts} SO</span>
                </div>
            ) : (
                <>
                    <div className='text-center text-[0.9rem] text-white min-[400px]:text-[0.95rem]'>
                        {row.goals}
                    </div>
                    <div className='text-center text-[0.9rem] text-white min-[400px]:text-[0.95rem]'>
                        {row.assists}
                    </div>
                    <div className='text-center text-[0.95rem] text-[#00F0FF] min-[400px]:text-[1rem]'>
                        {row.points}
                    </div>
                    <div className='text-center text-[0.65rem] text-white min-[400px]:text-[0.75rem]'>
                        {row.timeOnIce ?? '—'}
                    </div>
                </>
            )}

            <div className='text-center text-[0.95rem] font-bold text-[#FFC72C] min-[400px]:text-[1rem]'>
                {row.fantasyPoints == null ? '—' : row.fantasyPoints}
            </div>
        </Link>
    );
});

type PositionFilter = 'all' | PositionGroup;

/**
 * Icône "Tous" : deux bâtons croisés, comme le GameDayIcon de
 * TopBar mais sans la rondelle. Le tracé reprend les mêmes
 * coordonnées pour que les deux icônes se ressemblent visuellement.
 */
function AllPositionsIcon({ color }: { color: string }) {
    return (
        <svg
            viewBox='0 0 24 24'
            width={26}
            height={26}
            fill='none'
            stroke={color}
            strokeWidth={1.9}
            strokeLinecap='round'
            strokeLinejoin='round'
            aria-hidden='true'
        >
            {/* Personne du centre */}
            <circle cx='12' cy='6.5' r='3.5' />
            <path d='M5.5 19v-1.5c0-2.5 2-4.5 4.5-4.5h4c2.5 0 4.5 2 4.5 4.5v1.5' />

            {/* Personne de gauche */}
            <circle cx='4.5' cy='10' r='2.5' />
            <path d='M1 19v-1.5c0-1.7 1.3-3 3-3h1.5' />

            {/* Personne de droite */}
            <circle cx='19.5' cy='10' r='2.5' />
            <path d='M23 19v-1.5c0-1.7-1.3-3-3-3h-1.5' />
        </svg>
    );
}

function ForwardIcon({ color }: { color: string }) {
    return (
        <svg
            viewBox='9 8 59 59'
            width={26}
            height={26}
            fill={color}
            stroke={color}
            strokeWidth={0.25}
            strokeLinejoin='round'
            aria-hidden='true'
        >
            <path
                d='M39.5 8.86C39.83 10.85 40.15 12.84 40.48 14.83C49.91 16.88 55.88 21.48 59.87 30.27C60.68 32.06 60.69 34.08 61.35 35.83C63.42 36.3 65.49 35.65 66.95 37.5C66.71 40.91 63.38 39.42 61.17 40.37C59.91 48 55.33 55.51 48.02 58.84C45.54 59.96 42.79 59.95 40.34 61.17C40.15 62.99 39.97 64.81 39.78 66.64C39.02 66.64 38.26 66.64 37.5 66.64C37.17 64.83 36.83 63.01 36.5 61.2C26.82 57.45 22.11 56.95 17.16 46.69C16.17 44.63 16.36 42.18 15.5 40.17C13.88 39.95 9.55 40.68 9.85 37.83C10.11 35.39 14.09 36.33 15.62 35.83C16.35 33.72 16.11 31.38 17.11 29.26C21.14 20.71 27.88 17.27 36.5 14.67C36.83 12.73 37.17 10.8 37.5 8.86C38.17 8.86 38.83 8.86 39.5 8.86ZM36.5 19.2C31.26 18.31 24.96 23.29 22.23 27.39C20.61 29.81 20.2 32.84 19.5 35.56C22.26 36.53 26.82 34.75 28.78 37.33C28.78 38.08 28.78 38.83 28.78 39.58C25.66 39.89 22.53 40.19 19.41 40.5C20.39 43.19 20.6 46.17 22.2 48.64C24.82 52.72 31.54 57.88 36.63 56.65C36.63 53.71 36.63 50.78 36.63 47.84C37.7 47.84 38.77 47.84 39.83 47.84C40.06 50.86 40.28 53.89 40.5 56.91C48.4 57 57.7 48.54 56.83 40.31C53.93 40.04 51.02 39.77 48.11 39.5C48.11 38.5 48.11 37.5 48.11 36.5C50.99 36.28 53.86 36.06 56.74 35.83C58.7 28.65 47.4 18.24 40.5 19.27C40.28 22.37 40.06 25.47 39.84 28.57C38.95 28.57 38.06 28.57 37.17 28.57C36.94 25.45 36.72 22.33 36.5 19.2ZM37.26 35.12C40.87 33.74 42.89 39.67 39.42 40.89C35.66 42.21 33.59 36.52 37.26 35.12Z'
                fillRule='evenodd'
            />
        </svg>
    );
}

function DefenseIcon({ color }: { color: string }) {
    return (
        <svg
            viewBox='185 155 656 716'
            width={26}
            height={26}
            fill={color}
            stroke={color}
            strokeWidth={0.25}
            strokeLinejoin='round'
            aria-hidden='true'
        >
            <path
                d='M831.42 256.5C834.43 313.52 832.62 370.03 823.78 426.47C805.73 541.74 751.1 650.81 670.85 735.33C622.49 786.25 571.17 823.95 512.5 861.87C501.82 857.36 489.11 847.82 479.29 841.22C453.09 823.63 427.99 804.97 403.84 784.66C299.42 696.82 227.59 575.14 201.39 441.24C193.57 401.22 189.04 360.29 188.15 319.5C187.69 298.47 188.38 277.51 188.77 256.5C195.11 252.25 204.91 250.9 212.26 248.66C228.6 243.7 244.89 238.6 261.24 233.66C314.65 217.51 367.9 200.85 421.32 184.74C442.02 178.49 462.72 172.2 483.36 165.77C489.27 163.94 505.28 157.74 510.5 157.89C516.01 158.06 524.35 161.94 529.82 163.61C542.08 167.34 554.37 171 566.59 174.83C608.89 188.06 651.36 200.74 693.74 213.69C725.41 223.36 757.06 233.06 788.73 242.69C797.68 245.41 806.61 248.15 815.55 250.9C820.72 252.49 827 253.49 831.42 256.5ZM787.09 290.5C781.39 286.95 773.19 285.64 766.7 283.72C751.34 279.2 736.07 274.33 720.75 269.68C676.04 256.09 631.4 242.27 586.69 228.73C568.3 223.15 549.92 217.53 531.55 211.87C526.86 210.43 513.88 205.15 509.72 205.48C504.14 205.93 497.72 209.11 492.35 210.76C480.62 214.39 468.88 218.07 457.1 221.55C420.76 232.27 384.61 243.66 348.39 254.79C321.33 263.09 294.31 271.52 267.19 279.61C258.45 282.21 240.62 286.04 233.6 290.5C232.83 360.7 241.74 431.38 263.27 498.31C305.4 629.28 396.32 734.66 511.5 807.83C521.69 803.27 534.87 792.44 544.12 785.61C564.98 770.21 584.87 753.97 604.19 736.68C679.44 669.34 735.55 581.39 763.81 484.43C782.13 421.53 788.6 355.87 787.09 290.5ZM510.15 240.31C510.15 417.38 510.15 594.44 510.15 771.5C503.57 769.58 485.35 755.4 478.88 750.6C455.45 733.21 433.08 714.69 412.41 694.08C345.84 627.73 299.17 544.5 279.2 452.45C272.12 419.83 268.2 386.81 266.31 353.5C265.59 340.85 265.91 328.16 265.63 315.5C347.13 290.44 428.64 265.38 510.15 240.31Z'
                fillRule='evenodd'
            />
        </svg>
    );
}

/**
 * Icône "Gardiens" : masque de gardien, SVG fourni par le
 * commissaire. Le tracé d'origine utilisait un fill noir
 * hardcodé (#020202) ; ici on le remplace par le color prop pour
 * que l'icône prenne la teinte or comme les trois autres icônes
 * de filtre.
 *
 * Contrairement aux trois autres, cette icône est un shape plein
 * (fill) et non un tracé (stroke) : la silhouette du masque est
 * dessinée par le contour du path, pas par une ligne. Le
 * strokeWidth est réduit à 0.25 (valeur d'origine) parce qu'il
 * sert juste à épaissir légèrement le contour extérieur.
 */
function GoalieIcon({ color }: { color: string }) {
    return (
        <svg
            viewBox='0 0 128 128'
            width={26}
            height={26}
            fill={color}
            stroke={color}
            strokeWidth={0.25}
            strokeLinejoin='round'
            aria-hidden='true'
        >
            <path d='M52.72 0.06C60.24 0.06 67.76 0.06 75.28 0.06C75.31 2.65 75.34 5.24 75.37 7.83C77.93 9.38 81.49 9.31 84.34 10.17C90.28 11.96 95.9 15.14 100.51 19.32C105.48 23.81 108.63 29.87 110.76 36.09C111.47 38.16 111.27 43.35 112.74 44.76C114.08 46.04 125.35 44.93 127.94 45.28C127.94 52.76 127.94 60.24 127.94 67.72C125.48 68.05 112.53 67.15 111.59 68.41C110.42 69.98 108.8 80.1 107.79 82.94C104.13 93.11 99.41 102.98 92.72 111.56C88.65 116.79 83.21 121.81 77.27 124.78C75.92 125.45 69.33 127.36 69.04 127.94C65.68 127.94 62.33 127.94 58.97 127.94C58.66 127.32 52.14 125.47 50.77 124.74C44.84 121.56 39.43 116.86 35.3 111.53C28.72 103.02 23.52 93.19 20.18 82.98C19.31 80.31 17.46 69.83 16.41 68.41C15.47 67.15 2.52 68.05 0.06 67.72C0.06 60.24 0.06 52.76 0.06 45.28C3.18 44.86 12.96 46.31 15.07 44.89C16.61 43.85 16.58 37.98 17.23 36.08C19.34 29.83 22.54 23.83 27.48 19.31C32.21 14.98 37.76 12.3 43.73 10.21C46.56 9.21 50.05 9.39 52.63 7.83C52.66 5.24 52.69 2.65 52.72 0.06ZM67.78 7.64C65.26 7.64 62.74 7.64 60.22 7.64C60.22 10.08 60.22 12.52 60.22 14.96C62.74 14.96 65.26 14.96 67.78 14.96C67.78 12.52 67.78 10.08 67.78 7.64ZM52.53 16.17C50.06 15.84 47.25 17 44.96 17.8C33.18 21.94 25.06 31.05 23.16 43.62C19.98 64.7 27.48 88.16 39.82 105.01C45.47 112.72 53.73 120.31 63.83 120.43C73.66 120.54 81.34 113.47 87.17 106.33C99.79 90.85 108.52 63.36 104.8 43.43C102.45 30.92 95.03 22 83.04 17.8C80.74 17 77.94 15.84 75.47 16.17C75.26 18.3 75.04 20.43 74.83 22.55C67.61 22.55 60.39 22.55 53.17 22.55C52.96 20.43 52.74 18.3 52.53 16.17ZM50.5 31.09C55.27 30.95 59.46 37.19 64.17 37.03C68.69 36.87 73.05 30.51 77.6 31.17C78.47 33.28 79.34 35.39 80.2 37.5C78.01 39.12 66.15 45.51 63.83 45.39C62.16 45.3 49.56 38.78 47.8 37.5C48.7 35.36 49.6 33.23 50.5 31.09ZM42.87 45.42C60.56 41.15 67.48 70.45 48.74 74.86C29.43 79.42 22.51 50.33 42.87 45.42ZM80.26 45.46C98.02 40.87 105.14 70.9 86.12 74.89C66.68 78.95 60.28 50.62 80.26 45.46ZM15.02 52.85C12.54 52.85 10.05 52.85 7.57 52.85C7.57 55.28 7.57 57.71 7.57 60.14C10.05 60.14 12.54 60.14 15.02 60.14C15.02 57.71 15.02 55.28 15.02 52.85ZM120.43 52.85C117.95 52.85 115.46 52.85 112.98 52.85C112.98 55.28 112.98 57.71 112.98 60.14C115.46 60.14 117.95 60.14 120.43 60.14C120.43 57.71 120.43 55.28 120.43 52.85ZM42.9 53.11C34.37 55.4 37.79 69.63 46.49 67.65C56.45 65.39 52.97 50.41 42.9 53.11ZM80.53 53.09C71.72 55.19 75.31 69.81 84.15 67.61C93.83 65.19 90.47 50.72 80.53 53.09ZM45.13 82.87C45.13 85.29 45.13 87.71 45.13 90.13C42.71 90.13 40.29 90.13 37.87 90.13C37.87 87.71 37.87 85.29 37.87 82.87C40.29 82.87 42.71 82.87 45.13 82.87ZM60.13 82.87C60.13 85.29 60.13 87.71 60.13 90.13C57.71 90.13 55.29 90.13 52.87 90.13C52.87 87.71 52.87 85.29 52.87 82.87C55.29 82.87 57.71 82.87 60.13 82.87ZM75.13 82.87C75.13 85.29 75.13 87.71 75.13 90.13C72.71 90.13 70.29 90.13 67.87 90.13C67.87 87.71 67.87 85.29 67.87 82.87C70.29 82.87 72.71 82.87 75.13 82.87ZM90.13 82.87C90.13 85.29 90.13 87.71 90.13 90.13C87.71 90.13 85.29 90.13 82.87 90.13C82.87 87.71 82.87 85.29 82.87 82.87C85.29 82.87 87.71 82.87 90.13 82.87ZM60.13 97.87C60.13 100.29 60.13 102.71 60.13 105.13C57.71 105.13 55.29 105.13 52.87 105.13C52.87 102.71 52.87 100.29 52.87 97.87C55.29 97.87 57.71 97.87 60.13 97.87ZM75.13 97.87C75.13 100.29 75.13 102.71 75.13 105.13C72.71 105.13 70.29 105.13 67.87 105.13C67.87 102.71 67.87 100.29 67.87 97.87C70.29 97.87 72.71 97.87 75.13 97.87Z' />
        </svg>
    );
}

/**
 * Bouton de filtre par position utilisé au-dessus du tableau
 * "Meilleurs pointeurs".
 *
 * Deux états :
 *
 *   - Inactif : bordure fine (1.5px) dans la couleur d'accent, pas
 *     de lueur. Le contraste avec l'état actif est ce qui indique
 *     visuellement que ce bouton n'est pas celui qui filtre
 *     présentement.
 *
 *   - Actif : bordure plus épaisse (2px) dans la couleur d'accent,
 *     plus une filament intérieur (1px inset near-white) et deux
 *     halos cyan/violet à l'intérieur du bouton. C'est la technique
 *     du "contained filament" : rien ne dépasse de la boîte du
 *     bouton, la lecture "néon" vient du contraste entre le tube
 *     saturé et le filament clair à l'intérieur.
 *
 * Aucun box-shadow externe, aucun filtre blur : tout reste contenu
 * dans le bouton.
 */
function PositionFilterButton({
    active,
    onClick,
    label,
    color,
    icon,
}: {
    active: boolean;
    onClick: () => void;
    label: string;
    color: string;
    icon: React.ReactNode;
}) {
    const [hovered, setHovered] = useState(false);

    // #RRGGBB -> rgba(), so we can dial the opacity of each glow
    // layer independently. The active border uses the raw hex so
    // the tube stays fully saturated.
    const hexToRgba = (hex: string, alpha: number) => {
        const clean = hex.replace('#', '');
        const r = parseInt(clean.substring(0, 2), 16);
        const g = parseInt(clean.substring(2, 4), 16);
        const b = parseInt(clean.substring(4, 6), 16);
        return `rgba(${r}, ${g}, ${b}, ${alpha})`;
    };

    return (
        <button
            type='button'
            onClick={onClick}
            aria-pressed={active}
            onMouseEnter={() => setHovered(true)}
            onMouseLeave={() => setHovered(false)}
            className='
                relative
                flex
                h-[54px]
                min-w-0
                flex-1
                cursor-pointer
                flex-col
                items-center
                justify-center
                gap-0.5
                rounded-none
                px-1
                transition-all
                duration-200
                ease-out
                hover:-translate-y-[1px]
            '
            style={{
                /*
                 * Dark blue/black base with a soft radial highlight
                 * at the top, tinted in the button's own accent
                 * color. Brightens slightly on hover, and more on
                 * active. This is what gives the button the
                 * "premium panel" look from the reference image.
                 */
                background: `
                    radial-gradient(
                        circle at 50% 0%,
                        ${hexToRgba(
                    color,
                    active ? 0.10 : hovered ? 0.06 : 0.035,
                )} 0%,
                        transparent 58%
                    ),
                    linear-gradient(
                        180deg,
                        #081827 0%,
                        #06111F 100%
                    )
                `,

                /*
                 * Thin tube border. 1px in both states; the glow does
                 * the heavy lifting, so the border itself does not
                 * need to be thicker when active. The inactive border
                 * is brightened on hover so the button reads as
                 * interactive without lighting up.
                 */
                border: active
                    ? `1px solid ${color}`
                    : `1px solid ${hexToRgba(
                        color,
                        hovered ? 0.95 : 0.62,
                    )}`,

                /*
                 * NEON GLOW (outer, allowed for this component).
                 *
                 * Active state:
                 *   1. Tight bright halo at 3px -> the "tube" itself,
                 *      the sharpest read of the color.
                 *   2. Medium halo at 8px at 0.90 -> the main visible
                 *      bloom.
                 *   3. Wide soft halo at 17px at 0.48 -> the ambient
                 *      bleed that makes the button look lit.
                 *   4. Inset 7px at 0.16 -> subtle inner illumination
                 *      so the button's interior is not dead-flat.
                 *   5. Inset 1px white at 0.45 -> a tiny highlight on
                 *      the inner edge, like a glass tube catching
                 *      light.
                 *
                 * Inactive state: a very faint 5px outer halo, so the
                 * button reads as "off but alive" without competing
                 * with the active one.
                 */
                boxShadow: active
                    ? [
                        `0 0 3px ${color}`,
                        `0 0 8px ${hexToRgba(color, 0.90)}`,
                        `0 0 17px ${hexToRgba(color, 0.48)}`,
                        `inset 0 0 7px ${hexToRgba(color, 0.16)}`,
                        `inset 0 0 1px ${hexToRgba('#FFFFFF', 0.45)}`,
                    ].join(', ')
                    : hovered
                        ? [
                            `0 0 3px ${hexToRgba(color, 0.40)}`,
                            `0 0 9px ${hexToRgba(color, 0.25)}`,
                        ].join(', ')
                        : `0 0 5px ${hexToRgba(color, 0.16)}`,
            }}
        >
            {icon}

            <span
                className='
                    text-[0.7rem]
                    font-semibold
                    leading-none
                    text-white
                '
            >
                {label}
            </span>
        </button>
    );
}

function DurationDropdown({ value, onChange }: { value: number, onChange: (v: number) => void }) {
    const [isOpen, setIsOpen] = useState(false);
    const ref = useRef<HTMLDivElement>(null);

    useEffect(() => {
        function handleClickOutside(event: MouseEvent) {
            if (ref.current && !ref.current.contains(event.target as Node)) {
                setIsOpen(false);
            }
        }
        document.addEventListener('mousedown', handleClickOutside);
        return () => document.removeEventListener('mousedown', handleClickOutside);
    }, []);

    const options = [0, 1, 2, 3, 4, 5, 6, 7, 8];
    const label = value === 0 ? 'Tous' : `${value} an${value > 1 ? 's' : ''}`;

    // Three states, same rule as the two inputs above:
    //   - value === 0 ("Tous") and closed  -> gray
    //   - value === 0 and OPEN             -> cyan
    //   - value !== 0 (any focus state)    -> cyan
    // "Open" is the dropdown's equivalent of "focused": it is
    // what the user is currently interacting with, so it lights up
    // even before a choice is made. Once a value is picked the
    // control stays cyan after the panel closes, matching the
    // "filled = active filter" rule the inputs follow.
    const hasValue = value !== 0;
    const isBlue = hasValue || isOpen;

    const triggerBorderClass = isBlue
        ? 'border-[#00E5FF]'
        : 'border-gray-500/50';

    const caretColorClass = isBlue
        ? 'text-[#00E5FF]'
        : 'text-gray-500';

    return (
        <div ref={ref} className="relative w-full">
            <button
                type="button"
                onClick={() => setIsOpen(!isOpen)}
                className={`flex h-8 w-full items-center justify-between rounded-md border bg-[#050A18] px-2 text-xs text-white focus:outline-none ${triggerBorderClass}`}
            >
                {label}
                <span className={`text-[0.5rem] ${caretColorClass} transition-transform duration-200 ${isOpen ? 'rotate-180' : ''}`}>▼</span>
            </button>
            {isOpen && (
                <ul className="absolute left-0 right-0 z-50 mt-1 max-h-48 overflow-y-auto rounded-lg border border-[#00E5FF]/50 bg-[#0F1626] shadow-[0_0_20px_rgba(0,229,255,0.35),0_8px_24px_rgba(0,0,0,0.6)] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
                    {options.map((opt) => (
                        <li key={opt}>
                            <button
                                type="button"
                                onClick={() => {
                                    onChange(opt);
                                    setIsOpen(false);
                                }}
                                className={`w-full px-2 py-1.5 text-center text-xs transition-colors ${value === opt
                                        ? 'bg-[#00E5FF]/20 font-bold text-[#00E5FF]'
                                        : 'text-white hover:bg-[#00E5FF]/10'
                                    }`}
                            >
                                {opt === 0 ? 'Tous' : `${opt} an${opt > 1 ? 's' : ''}`}
                            </button>
                        </li>
                    ))}
                </ul>
            )}
        </div>
    );
}

function PlayerFilterDropdown({ value, onChange }: { value: string, onChange: (v: string) => void }) {
    const [isOpen, setIsOpen] = useState(false);
    const ref = useRef<HTMLDivElement>(null);

    useEffect(() => {
        function handleClickOutside(event: MouseEvent) {
            if (ref.current && !ref.current.contains(event.target as Node)) {
                setIsOpen(false);
            }
        }
        document.addEventListener('mousedown', handleClickOutside);
        return () => document.removeEventListener('mousedown', handleClickOutside);
    }, []);

    const options = [
        { value: 'rostered', label: 'Qui ont une équipe' },
        { value: 'freeAgents', label: "N'ont pas d'équipe" },
        { value: 'all', label: 'Tous les joueurs' },
    ];

    const selectedOption = options.find(o => o.value === value) || options[0];

    const isBlue = value !== 'rostered' || isOpen;

    const triggerBorderClass = isBlue
        ? 'border-[#00E5FF]'
        : 'border-gray-500/50';

    const caretColorClass = isBlue
        ? 'text-[#00E5FF]'
        : 'text-gray-500';

    return (
        <div ref={ref} className="relative w-full">
            <button
                type="button"
                onClick={() => setIsOpen(!isOpen)}
                className={`flex h-8 w-full items-center justify-between rounded-md border bg-[#050A18] px-2 text-xs text-white focus:outline-none ${triggerBorderClass}`}
            >
                <span className="truncate">{selectedOption.label}</span>
                <span className={`text-[0.5rem] shrink-0 ml-1 ${caretColorClass} transition-transform duration-200 ${isOpen ? 'rotate-180' : ''}`}>▼</span>
            </button>
            {isOpen && (
                <ul className="absolute left-0 right-0 z-50 mt-1 max-h-48 overflow-y-auto rounded-lg border border-[#00E5FF]/50 bg-[#0F1626] shadow-[0_0_20px_rgba(0,229,255,0.35),0_8px_24px_rgba(0,0,0,0.6)] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
                    {options.map((opt) => (
                        <li key={opt.value}>
                            <button
                                type="button"
                                onClick={() => {
                                    onChange(opt.value);
                                    setIsOpen(false);
                                }}
                                className={`w-full px-2 py-1.5 text-center text-xs transition-colors ${value === opt.value
                                    ? 'bg-[#00E5FF]/20 font-bold text-[#00E5FF]'
                                    : 'text-white hover:bg-[#00E5FF]/10'
                                    }`}
                            >
                                {opt.label}
                            </button>
                        </li>
                    ))}
                </ul>
            )}
        </div>
    );
}

/**
 * Bouton "Filtres" qui ouvre le modal des filtres avancés.
 *
 * Même technique visuelle que les boutons `PositionFilterButton`
 * juste au-dessus : le bouton garde TOUJOURS la même couleur bleue
 * (#3B82F6), qu'il y ait des filtres actifs ou non. Il n'y a plus
 * de vert "filtres actifs" — l'intensité de l'aura bleue est ce qui
 * distingue les deux états :
 *
 *   - Inactif : bordure à ~62% d'opacité, aura à 0.16 d'opacité.
 *   - Hover   : bordure à ~95%, aura un peu plus prononcée, bouton
 *               qui se soulève de 1px (même comportement que les
 *               boutons de position).
 *   - Actif   : bordure pleine, aura multi-couches complète
 *               (tight / medium / wide + filament inset blanc),
 *               identique à l'état actif des boutons de position.
 *
 * L'état actif lit donc comme "ce bouton a quelque chose à
 * signaler" tout en restant dans la même famille chromatique que
 * le bouton inactif, ce qui est exactement ce que les boutons de
 * position font (bleu "Défenseurs", cyan "Tous", etc.).
 */
function FiltersButton({
    hasActiveFilters,
    onClick,
}: {
    hasActiveFilters: boolean;
    onClick: () => void;
}) {
    const [hovered, setHovered] = useState(false);

    // Blue when active, white when inactive.
    const color = hasActiveFilters ? '#3B82F6' : '#FFFFFF';

    const hexToRgba = (hex: string, alpha: number) => {
        const clean = hex.replace('#', '');
        const r = parseInt(clean.substring(0, 2), 16);
        const g = parseInt(clean.substring(2, 4), 16);
        const b = parseInt(clean.substring(4, 6), 16);
        return `rgba(${r}, ${g}, ${b}, ${alpha})`;
    };

    return (
        <button
            type='button'
            onClick={onClick}
            aria-pressed={hasActiveFilters}
            onMouseEnter={() => setHovered(true)}
            onMouseLeave={() => setHovered(false)}
            className='
                relative
                flex
                shrink-0
                items-center
                gap-1.5
                rounded-md
                px-3
                py-1
                text-[0.65rem]
                font-bold
                uppercase
                tracking-wider
                transition-all
                duration-200
                ease-out
                hover:-translate-y-[1px]
            '
            style={{
                color,
                background: `
                    radial-gradient(
                        circle at 50% 0%,
                        ${hexToRgba(
                    color,
                    hasActiveFilters ? 0.10 : hovered ? 0.06 : 0.035,
                )} 0%,
                        transparent 58%
                    ),
                    linear-gradient(
                        180deg,
                        #081827 0%,
                        #06111F 100%
                    )
                `,
                border: hasActiveFilters
                    ? `1px solid ${color}`
                    : `1px solid ${hexToRgba(
                        color,
                        hovered ? 0.95 : 0.62,
                    )}`,
                boxShadow: hasActiveFilters
                    ? [
                        `0 0 3px ${color}`,
                        `0 0 8px ${hexToRgba(color, 0.90)}`,
                        `0 0 17px ${hexToRgba(color, 0.48)}`,
                        `inset 0 0 7px ${hexToRgba(color, 0.16)}`,
                        `inset 0 0 1px ${hexToRgba('#FFFFFF', 0.45)}`,
                    ].join(', ')
                    : hovered
                        ? [
                            `0 0 3px ${hexToRgba(color, 0.40)}`,
                            `0 0 9px ${hexToRgba(color, 0.25)}`,
                        ].join(', ')
                        : `0 0 5px ${hexToRgba(color, 0.16)}`,
            }}
        >
            Filtres
        </button>
    );
}

const TopScorersTable = memo(function TopScorersTable({
    rows,
    loading,
    error,
    myTeamId,
    showContracts,
    onToggleContracts,
}: {
    rows: TopScorerRow[];
    loading: boolean;
    error: string | null;
    myTeamId: number | null;
    showContracts: boolean;
    onToggleContracts: (checked: boolean) => void;
}) {
    const { user, updatePreferences } = useAuth();
    const playerFilter = user?.statistiquesPlayerFilter || 'rostered';

    const listRef = useRef<HTMLDivElement | null>(null);

    const [scrollMargin, setScrollMargin] = useState(0);

    const savedFilters = getStatsFilters();

    // League rule: the "Meilleurs pointeurs" table ALWAYS starts
    // sorted by FP descending. The previous implementation read the
    // last-saved sort key from the module store, which meant a user
    // who had previously clicked PTS (or any other column) would see
    // that stale sort on their next visit — and players with more FP
    // would end up below players with less FP. We now hardcode the
    // initial sort to FP desc and force it back on every filter
    // change (see the effect below).
    const [sort, setSort] = useState<SortState>({
        key: 'fp',
        direction: 'desc',
    });

    const [positionFilter, setPositionFilter] =
        useState<PositionFilter>(savedFilters.positionFilter);

    const [isFiltersOpen, setIsFiltersOpen] = useState(savedFilters.isFiltersOpen);

    interface FilterState {
        maxAgeStr: string;
        maxSalaryStr: string;
        minContractLength: number;
        useSecondContract: boolean;
    }

    const defaultFilterState: FilterState = {
        maxAgeStr: '',
        maxSalaryStr: '',
        minContractLength: 0,
        useSecondContract: true,
    };

    const [appliedFilters, setAppliedFilters] = useState<FilterState>({
        maxAgeStr: savedFilters.maxAgeStr,
        maxSalaryStr: savedFilters.maxSalaryStr,
        minContractLength: savedFilters.minContractLength,
        useSecondContract: savedFilters.useSecondContract,
    });

    const [draftFilters, setDraftFilters] = useState<FilterState>(appliedFilters);
    const [draftPlayerFilter, setDraftPlayerFilter] = useState(playerFilter);

    useEffect(() => {
        setDraftPlayerFilter(playerFilter);
    }, [playerFilter]);

    const hasActiveFilters =
        appliedFilters.maxAgeStr !== '' ||
        appliedFilters.maxSalaryStr !== '' ||
        appliedFilters.minContractLength > 0 ||
        !appliedFilters.useSecondContract ||
        playerFilter !== 'rostered';

    const isDraftDefault =
        draftFilters.maxAgeStr === '' &&
        draftFilters.maxSalaryStr === '' &&
        draftFilters.minContractLength === 0 &&
        draftFilters.useSecondContract === true &&
        draftPlayerFilter === 'rostered';

    const showQuitButton = !hasActiveFilters && isDraftDefault;

    // Sync the local React state back to the module store on every change
    // so it survives when the user navigates away and returns.
    // Note: the sort itself is intentionally NOT restored on mount
    // (see the useState above) — only the filter selection is
    // persisted. The sort is always forced back to FP desc on mount
    // and on every filter change.
    useEffect(() => {
        setStatsFilters({
            sortKey: sort.key,
            sortDirection: sort.direction,
            positionFilter,
            isFiltersOpen,
            maxAgeStr: appliedFilters.maxAgeStr,
            maxSalaryStr: appliedFilters.maxSalaryStr,
            minContractLength: appliedFilters.minContractLength,
            useSecondContract: appliedFilters.useSecondContract,
        });
    }, [
        sort,
        positionFilter,
        isFiltersOpen,
        appliedFilters,
    ]);

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

    /**
     * Force the sort back to FP desc whenever the user changes any
     * filter — the three position buttons at the top of the table
     * AND the modal "Appliquer" button. This is required by the
     * league rules: the table must always be FP-sorted by default,
     * and any filter change must snap back to that default so the
     * highest-FP player among the filtered set is always on top.
     *
     * The manual sort via the column headers is preserved as long
     * as the filters don't change. Once the filters change, the
     * manual sort is discarded and FP desc is restored.
     *
     * We store the previous filter values in refs and only reset
     * the sort when they differ. This means the effect is a no-op
     * on the initial mount (refs start at the current values),
     * so the initial `useState` above is what controls the very
     * first render.
     */
    const prevPositionFilterRef = useRef(positionFilter);
    const prevAppliedFiltersRef = useRef(appliedFilters);

    useEffect(() => {
        const positionChanged =
            prevPositionFilterRef.current !== positionFilter;
        const appliedChanged =
            prevAppliedFiltersRef.current !== appliedFilters;

        if (positionChanged || appliedChanged) {
            setSort({ key: 'fp', direction: 'desc' });
            prevPositionFilterRef.current = positionFilter;
            prevAppliedFiltersRef.current = appliedFilters;
        }
    }, [positionFilter, appliedFilters]);

    /**
     * Filtrage avant tri.
     *
     * On filtre `rows` en premier, puis on trie le résultat. Cela
     * garantit que la colonne de rang (#) montre 1..N dans le
     * sous-ensemble filtré, ce qui correspond à la lecture visuelle
     * attendue : quand on sélectionne "Gardiens", on veut voir les
     * rangs 1, 2, 3... des gardiens, pas des rangs qui sautent
     * parce que les patineurs se sont intercalés.
     */
    const filteredRows = useMemo(() => {
        return rows.filter((r) => {
            // Position Filter
            if (positionFilter !== 'all' && toPositionGroup(r.position) !== positionFilter) {
                return false;
            }

            // Age Filter
            if (appliedFilters.maxAgeStr) {
                const parsedMaxAge = parseInt(appliedFilters.maxAgeStr, 10);
                if (!isNaN(parsedMaxAge)) {
                    if (r.age == null || r.age > parsedMaxAge) {
                        return false;
                    }
                }
            }

            // Contract Filter Logic
            // Si la case est cochée ET que le joueur a un 2e contrat, on utilise le 2e.
            // Sinon (case décochée OU joueur avec 1 seul contrat), on utilise le 1er.
            const contractToUse =
                appliedFilters.useSecondContract && r.secondContract
                    ? r.secondContract
                    : r.currentContract;

            // Salary Filter
            if (appliedFilters.maxSalaryStr) {
                const parsedMaxSalary = parseSalaryInput(appliedFilters.maxSalaryStr);
                if (parsedMaxSalary !== null) {
                    if (!contractToUse || contractToUse.salary > parsedMaxSalary) {
                        return false;
                    }
                }
            }

            // Contract Duration Filter
            if (appliedFilters.minContractLength > 0) {
                if (!contractToUse || contractToUse.yearsRemaining < appliedFilters.minContractLength) {
                    return false;
                }
            }

            return true;
        });
    }, [rows, positionFilter, appliedFilters]);

    const sortedRows = useMemo(() => {
        const copy = [...filteredRows];

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
                case 'wins':
                    cmp = compareNullable(
                        a.wins,
                        b.wins,
                        sort.direction,
                    );
                    break;
                case 'losses':
                    cmp = compareNullable(
                        a.losses,
                        b.losses,
                        sort.direction,
                    );
                    break;
                case 'overtimeLosses':
                    cmp = compareNullable(
                        a.overtimeLosses,
                        b.overtimeLosses,
                        sort.direction,
                    );
                    break;
                case 'shutouts':
                    cmp = compareNullable(
                        a.shutouts,
                        b.shutouts,
                        sort.direction,
                    );
                    break;
                case 'savePercentage':
                    cmp = compareNullable(
                        a.savePercentage,
                        b.savePercentage,
                        sort.direction,
                    );
                    break;
                case 'goalsAgainstAverage':
                    cmp = compareNullable(
                        a.goalsAgainstAverage,
                        b.goalsAgainstAverage,
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
    }, [filteredRows, sort]);

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

    const virtualItems = virtualizer.getVirtualItems();

    return (
        <div className='mt-1 w-full'>
            {/*
             * Les boutons de filtre par position restent visibles
             * dans tous les états (chargement, erreur, vide, rempli)
             * pour que l'utilisateur puisse toujours changer de
             * filtre sans avoir à attendre un re-fetch.
             */}
            <div className='mb-3 flex w-full gap-1.5'>
                <PositionFilterButton
                    active={positionFilter === 'all'}
                    onClick={() => setPositionFilter('all')}
                    label='Tous'
                    color='#00E5FF'
                    icon={<AllPositionsIcon color='#00E5FF' />}
                />

                <PositionFilterButton
                    active={positionFilter === 'F'}
                    onClick={() => setPositionFilter('F')}
                    label='Attaquants'
                    color='#FF3B5C'
                    icon={<ForwardIcon color='#FF3B5C' />}
                />

                <PositionFilterButton
                    active={positionFilter === 'D'}
                    onClick={() => setPositionFilter('D')}
                    label='Défenseurs'
                    color='#3B82F6'
                    icon={<DefenseIcon color='#3B82F6' />}
                />

                <PositionFilterButton
                    active={positionFilter === 'G'}
                    onClick={() => setPositionFilter('G')}
                    label='Gardiens'
                    color='#FFC72C'
                    icon={<GoalieIcon color='#FFC72C' />}
                />
            </div>

            <div className='mb-3 flex w-full flex-wrap items-center gap-2'>
                <FiltersButton
                    hasActiveFilters={hasActiveFilters}
                    onClick={() => {
                        setDraftFilters(appliedFilters);
                        setIsFiltersOpen(true);
                    }}
                />

                <button
                    type='button'
                    disabled={!hasActiveFilters}
                    onClick={() => {
                        setAppliedFilters(defaultFilterState);
                        setDraftFilters(defaultFilterState);
                        void updatePreferences({ statistiquesPlayerFilter: 'rostered' });
                    }}
                    className='flex h-[26px] flex-1 min-w-[100px] items-center justify-center rounded-md border border-[#00E5FF]/30 bg-[#050A18] px-1 text-center text-[0.55rem] font-bold uppercase leading-tight tracking-wider text-[#7DD3FC] transition-colors hover:border-[#00E5FF] hover:text-[#00E5FF] disabled:cursor-not-allowed disabled:border-white/10 disabled:text-white/30 disabled:hover:border-white/10 disabled:hover:text-white/30'
                >
                    Réinitialiser les filtres
                </button>

                <label className="flex shrink-0 items-center gap-2 cursor-pointer text-[0.7rem] font-semibold text-[#7DD3FC] select-none transition-colors hover:text-[#00E5FF]">
                    <div className="relative flex items-center justify-center">
                        <input
                            type="checkbox"
                            checked={showContracts}
                            onChange={(e) => onToggleContracts(e.target.checked)}
                            className="peer sr-only"
                        />
                        <div className="h-4 w-4 rounded border border-[#00E5FF]/50 bg-[#050A18] transition-colors peer-checked:border-[#00E5FF] peer-checked:bg-[#00E5FF]/20" />
                        <svg
                            className="absolute h-3 w-3 text-[#00E5FF] opacity-0 peer-checked:opacity-100 transition-opacity pointer-events-none"
                            viewBox="0 0 24 24"
                            fill="none"
                            stroke="currentColor"
                            strokeWidth="3"
                            strokeLinecap="round"
                            strokeLinejoin="round"
                        >
                            <polyline points="20 6 9 17 4 12" />
                        </svg>
                    </div>
                    <span>Afficher les contrats</span>
                </label>
            </div>

            {isFiltersOpen && (
                <div className='fixed inset-0 z-[100] flex items-center justify-center bg-black/60 px-4' onClick={() => setIsFiltersOpen(false)}>
                    <div
                        className='w-full max-w-sm rounded-lg border border-[#00E5FF]/50 bg-[#0F1626] p-4 shadow-[0_0_20px_rgba(0,229,255,0.35),0_8px_24px_rgba(0,0,0,0.6)]'
                        onClick={(e) => e.stopPropagation()}
                    >
                        <div className='relative mb-3 flex items-center justify-end border-b border-[#00E5FF]/20 pb-2'>
                            <h3 className='absolute left-1/2 -translate-x-1/2 text-sm font-bold uppercase tracking-wider text-white'>
                                Filtres
                            </h3>
                            <button
                                type='button'
                                onClick={() => setIsFiltersOpen(false)}
                                className='text-white/60 transition-colors hover:text-white'
                            >
                                ✕
                            </button>
                        </div>

                        <div className='grid w-full grid-cols-2 gap-2'>
                            <div className='col-span-2 flex flex-col gap-1 pb-1'>
                                <label className='text-center text-[0.55rem] font-bold uppercase tracking-wider text-white'>Afficher les joueurs :</label>
                                <PlayerFilterDropdown
                                    value={draftPlayerFilter}
                                    onChange={setDraftPlayerFilter}
                                />
                            </div>
                            {/* All labels are centered horizontally over
                                their input / dropdown. The two salary /
                                duration filters are prefixed with
                                "Contrat :" so it is immediately clear
                                they target the contract rows (current
                                and/or second) rather than some other
                                per-player number, and "Durée minimum"
                                replaces the terse "(ans)" form that was
                                easy to misread as a duration window
                                rather than a minimum.
                                The checkbox row is a flex row (box +
                                text), so it needs justify-center as
                                well as text-center.
                                INPUT / CHECKBOX CHROME
                                Three states per field:
                                  - empty + not focused  -> gray border
                                  - empty + focused      -> cyan border
                                  - filled (any focus)   -> cyan border
                                The focus state is what restores the
                                pre-change behaviour where interacting
                                with an empty field lit it up. Once a
                                value is entered the field stays cyan
                                even when the user tabs away, so an
                                active filter is always visible at a
                                glance. Labels and typed values stay
                                white; only the border changes. The
                                checkbox follows the same visual rule
                                via peer-checked (checked -> cyan,
                                unchecked -> gray); checking it is what
                                "selected" means for a checkbox. */}
                            <div className='flex flex-col gap-1'>
                                <label className='text-center text-[0.55rem] font-bold uppercase tracking-wider text-white'>Âge max</label>
                                <input
                                    type='number'
                                    placeholder='Ex: 25'
                                    value={draftFilters.maxAgeStr}
                                    onChange={(e) => setDraftFilters(prev => ({ ...prev, maxAgeStr: e.target.value }))}
                                    className={`h-8 rounded-md border bg-[#050A18] px-2 text-xs text-white placeholder:text-white/20 focus:outline-none ${draftFilters.maxAgeStr !== '' ? 'border-[#00E5FF]' : 'border-gray-500/50 focus:border-[#00E5FF]'}`}
                                />
                            </div>
                            <div className='flex flex-col gap-1'>
                                <label className='text-center text-[0.55rem] font-bold uppercase tracking-wider text-white'>Contrat : Salaire maximum</label>
                                <input
                                    type='text'
                                    placeholder='Ex: 2M, 2 ou 2000000'
                                    value={draftFilters.maxSalaryStr}
                                    onChange={(e) => setDraftFilters(prev => ({ ...prev, maxSalaryStr: e.target.value }))}
                                    className={`h-8 rounded-md border bg-[#050A18] px-2 text-xs text-white placeholder:text-white/20 focus:outline-none ${draftFilters.maxSalaryStr !== '' ? 'border-[#00E5FF]' : 'border-gray-500/50 focus:border-[#00E5FF]'}`}
                                />
                            </div>
                            <div className='flex flex-col gap-1'>
                                <label className='text-center text-[0.55rem] font-bold uppercase tracking-wider text-white'>Contrat : Durée minimum</label>
                                <DurationDropdown value={draftFilters.minContractLength} onChange={(v) => setDraftFilters(prev => ({ ...prev, minContractLength: v }))} />
                            </div>
                            <div className='flex flex-col justify-end pb-1.5'>
                                <label className='flex cursor-pointer items-center justify-center gap-2 text-center text-[0.7rem] font-semibold text-white select-none'>
                                    <div className='relative flex items-center justify-center'>
                                        <input
                                            type='checkbox'
                                            checked={draftFilters.useSecondContract}
                                            onChange={(e) => setDraftFilters(prev => ({ ...prev, useSecondContract: e.target.checked }))}
                                            className='peer sr-only'
                                        />
                                        <div className='h-4 w-4 rounded border border-gray-500/50 bg-[#050A18] transition-colors peer-checked:border-[#00E5FF] peer-checked:bg-[#00E5FF]/20' />
                                        <svg
                                            className='pointer-events-none absolute h-3 w-3 text-[#00E5FF] opacity-0 transition-opacity peer-checked:opacity-100'
                                            viewBox='0 0 24 24'
                                            fill='none'
                                            stroke='currentColor'
                                            strokeWidth='3'
                                            strokeLinecap='round'
                                            strokeLinejoin='round'
                                        >
                                            <polyline points='20 6 9 17 4 12' />
                                        </svg>
                                    </div>
                                    Inclure 2e contrats?
                                </label>
                            </div>
                        </div>

                        <div className='mt-4 flex w-full gap-2'>
                            <button
                                type='button'
                                disabled={isDraftDefault}
                                onClick={() => {
                                    setDraftFilters(defaultFilterState);
                                    setDraftPlayerFilter('rostered');
                                }}
                                className='flex-1 rounded-md border border-[#00E5FF]/30 bg-[#050A18] px-2 py-1.5 text-center text-[0.55rem] font-bold uppercase tracking-wider text-[#7DD3FC] transition-colors hover:border-[#00E5FF] hover:text-[#00E5FF] disabled:cursor-not-allowed disabled:border-white/10 disabled:text-white/30 disabled:hover:border-white/10 disabled:hover:text-white/30'
                            >
                                Réinitialiser
                            </button>
                            {showQuitButton ? (
                                <button
                                    type='button'
                                    onClick={() => setIsFiltersOpen(false)}
                                    className='flex-1 rounded-md border border-[#EF4444] bg-[#EF4444]/10 px-2 py-1.5 text-center text-[0.55rem] font-bold uppercase tracking-wider text-[#EF4444] transition-colors hover:bg-[#EF4444]/20'
                                >
                                    Quitter
                                </button>
                            ) : (
                                <button
                                    type='button'
                                    onClick={() => {
                                        setAppliedFilters(draftFilters);
                                        if (draftPlayerFilter !== playerFilter) {
                                            void updatePreferences({ statistiquesPlayerFilter: draftPlayerFilter });
                                        }
                                        setIsFiltersOpen(false);
                                    }}
                                    className='flex-1 rounded-md border border-[#22C55E] bg-[#22C55E]/10 px-2 py-1.5 text-center text-[0.55rem] font-bold uppercase tracking-wider text-[#22C55E] transition-colors hover:bg-[#22C55E]/20'
                                >
                                    Appliquer
                                </button>
                            )}
                        </div>
                    </div>
                </div>
            )}

            {loading ? (
                <p className='mt-3 text-center text-sm text-muted-foreground'>
                    Chargement...
                </p>
            ) : error ? (
                <p className='mt-3 w-full rounded-lg border border-destructive/40 bg-destructive/10 px-3 py-2 text-center text-sm text-destructive'>
                    {error}
                </p>
            ) : sortedRows.length === 0 ? (
                <p className='mt-3 w-full rounded-lg border border-border bg-card px-3 py-6 text-center text-sm text-muted-foreground'>
                    {positionFilter === 'all'
                        ? 'Aucun joueur sur une équipe fantasy.'
                        : 'Aucun joueur à cette position.'}
                </p>
            ) : (
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
                            showGoalieColumns={positionFilter === 'G'}
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
                                            showGoalieColumns={
                                                positionFilter === 'G'
                                            }
                                            showContracts={showContracts}
                                        />
                                    </div>
                                );
                            })}
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
});

// ---------------------------------------------------------------------
// NHL standings ("Équipes" tab)
//
// Three views over the same NHL team standings rows:
//
//   Ligue      - one table, 32 teams ranked league-wide.
//   Conférence - two sections (Est, Ouest), ranked within conference.
//   Division   - four sections (Atlantique, Métropolitaine, Centrale,
//                Pacifique), ranked within division.
//
// Ranking uses the standard NHL tiebreak chain: points, then wins,
// then goal differential, then fewer games played, then alphabetic.
// Left-edge bar is a contained-filament triple (accent / mid / core)
// derived from each team's aura color, so dark team colors stay
// readable on the dark background.
// ---------------------------------------------------------------------

type StandingsView = 'league' | 'conference' | 'division';

const STANDINGS_VIEWS: { key: StandingsView; label: string }[] = [
    { key: 'division', label: 'Division' },
    { key: 'conference', label: 'Conférence' },
    { key: 'league', label: 'Ligue' },
];

const CONFERENCE_LABELS: Record<string, string> = {
    Eastern: 'Est',
    Western: 'Ouest',
};

const DIVISION_LABELS: Record<string, string> = {
    Atlantic: 'Atlantique',
    Metropolitan: 'Métropolitaine',
    Central: 'Centrale',
    Pacific: 'Pacifique',
};

const CONFERENCE_ORDER = ['Eastern', 'Western'];

const DIVISION_ORDER = [
    'Atlantic',
    'Metropolitan',
    'Central',
    'Pacific',
];

const TEAM_STANDINGS_GRID =
    '18px minmax(0, 1fr) 22px 22px 22px 26px 28px 32px';

function compareStandings(
    a: NhlTeamStandingsRow,
    b: NhlTeamStandingsRow,
): number {
    if (b.points !== a.points) return b.points - a.points;
    if (b.wins !== a.wins) return b.wins - a.wins;

    if (b.goalDifferential !== a.goalDifferential) {
        return b.goalDifferential - a.goalDifferential;
    }

    if (a.gamesPlayed !== b.gamesPlayed) {
        return a.gamesPlayed - b.gamesPlayed;
    }

    return a.teamAbbreviation.localeCompare(b.teamAbbreviation);
}

function formatDiff(diff: number): string {
    if (diff > 0) return `+${diff}`;
    return String(diff);
}

interface StandingsGroup {
    key: string;
    label: string;
    teams: NhlTeamStandingsRow[];
}

function groupStandings(
    rows: NhlTeamStandingsRow[],
    view: StandingsView,
): StandingsGroup[] {
    if (view === 'league') {
        return [
            {
                key: 'league',
                label: 'LNH',
                teams: Array.from(rows).sort(compareStandings),
            },
        ];
    }

    const field: 'conferenceName' | 'divisionName' =
        view === 'conference' ? 'conferenceName' : 'divisionName';

    const order =
        view === 'conference' ? CONFERENCE_ORDER : DIVISION_ORDER;

    const labels =
        view === 'conference' ? CONFERENCE_LABELS : DIVISION_LABELS;

    const groups = new Map<string, NhlTeamStandingsRow[]>();

    for (const row of rows) {
        const raw = row[field];
        const key = raw ?? 'Autre';

        const existing = groups.get(key);
        if (existing) {
            existing.push(row);
        } else {
            groups.set(key, [row]);
        }
    }

    return Array.from(groups.entries())
        .sort(([a], [b]) => {
            const ai = order.indexOf(a);
            const bi = order.indexOf(b);

            if (ai === -1 && bi === -1) return a.localeCompare(b);
            if (ai === -1) return 1;
            if (bi === -1) return -1;
            return ai - bi;
        })
        .map(([rawKey, teams]) => ({
            key: rawKey,
            label: labels[rawKey] ?? rawKey,
            teams: Array.from(teams).sort(compareStandings),
        }));
}

const NhlStandingsTable = memo(function NhlStandingsTable({
    view,
}: {
    view: StandingsView;
}) {
    const [rows, setRows] = useState<NhlTeamStandingsRow[]>([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);

    useEffect(() => {
        let cancelled = false;

        setLoading(true);
        setError(null);

        getNhlStandings()
            .then((data) => {
                if (!cancelled) {
                    setRows(data);
                    setError(null);
                }
            })
            .catch(() => {
                if (!cancelled) {
                    setError(
                        'Impossible de charger le classement LNH.',
                    );
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
    }, []);

    const groups = useMemo(
        () => groupStandings(rows, view),
        [rows, view],
    );

    if (loading) {
        return (
            <p className='mt-3 text-center text-sm text-muted-foreground'>
                Chargement du classement LNH...
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

    if (rows.length === 0) {
        return (
            <p className='mt-3 w-full rounded-lg border border-border bg-card px-3 py-6 text-center text-sm text-muted-foreground'>
                Aucune donnée de classement LNH pour le moment.
            </p>
        );
    }

    return (
        <div className='mt-1.5 flex flex-col gap-8'>
            {groups.map((group) => (
                <div key={group.key}>
                    <h3 className='mb-2 text-center text-sm font-bold uppercase tracking-wider text-white'>
                        {group.label}
                    </h3>

                    <div className='w-full overflow-hidden'>
                        {/* Header Row */}
                        <div
                            className='grid w-full items-center py-2 px-3 text-[0.8rem] font-black uppercase leading-none sm:text-[0.85rem]'
                            style={{
                                gridTemplateColumns: TEAM_STANDINGS_GRID,
                                columnGap: '0.3rem',
                                border: '2px solid #FFFFFF',
                            }}
                        >
                            <div className='text-center text-white'>#</div>
                            <div className='pl-1 text-white tracking-wider'>Équipe</div>
                            <div className='text-center text-white'>GP</div>
                            <div className='text-center text-white'>V</div>
                            <div className='text-center text-white'>D</div>
                            <div className='text-center text-white'>DP</div>
                            <div className='text-center text-white'>PTS</div>
                            <div className='text-center text-white'>DIFF</div>
                        </div>

                        {/* Data Rows */}
                        <div>
                            {group.teams.map((team, index) => (
                                <div
                                    key={team.id}
                                    className='grid items-center py-2 px-3 text-[1.05rem] font-bold tabular-nums leading-none transition-[filter] duration-150 hover:brightness-110'
                                    style={{
                                        gridTemplateColumns: TEAM_STANDINGS_GRID,
                                        backgroundColor: getNhlTeamColor(team.teamAbbreviation),
                                        color: getNhlTeamTextColor(team.teamAbbreviation),
                                        columnGap: '0.3rem',
                                        border: '2px solid transparent',
                                        contentVisibility: 'auto',
                                        containIntrinsicSize: '40px',
                                    } as React.CSSProperties}
                                >
                                    <div className='text-center'>
                                        {index + 1}
                                    </div>

                                    <div className='flex min-w-0 items-center gap-3 pl-2'>
                                        <div
                                            style={{
                                                width: 20,
                                                height: 20,
                                                flexShrink: 0,
                                                transform: 'scale(2)',
                                                transformOrigin: 'center',
                                            }}
                                        >
                                            <NhlTeamLogo
                                                abbreviation={team.teamAbbreviation}
                                                size={20}
                                            />
                                        </div>
                                        <span className='truncate'>
                                            {team.teamAbbreviation}
                                        </span>
                                    </div>

                                    <div className='text-center'>
                                        {team.gamesPlayed}
                                    </div>
                                    <div className='text-center'>
                                        {team.wins}
                                    </div>
                                    <div className='text-center'>
                                        {team.losses}
                                    </div>
                                    <div className='text-center'>
                                        {team.otLosses}
                                    </div>
                                    <div className='text-center'>
                                        {team.points}
                                    </div>
                                    <div className='text-center'>
                                        {formatDiff(team.goalDifferential)}
                                    </div>
                                </div>
                            ))}
                        </div>
                    </div>
                </div>
            ))}
        </div>
    );
});

function TeamsSection() {
    const { user, updatePreferences } = useAuth();
    const [view, setView] = useState<StandingsView>(
        (user?.statistiquesStandingsView as StandingsView) || 'division'
    );

    useEffect(() => {
        if (user?.statistiquesStandingsView) {
            setView(user.statistiquesStandingsView as StandingsView);
        }
    }, [user?.statistiquesStandingsView]);

    const handleViewChange = (v: StandingsView) => {
        setView(v);
        if (user?.statistiquesStandingsView !== v) {
            void updatePreferences({ statistiquesStandingsView: v });
        }
    };

    return (
        <div className='w-full flex flex-col items-center'>
            <div className='mb-1.5 flex items-center justify-center'>
                <div
                    className='marketplace-sub-toggle flex items-center rounded-full border border-[#00E5FF]/60 bg-[#050A18]/80 p-0.5 text-xs'
                    style={{
                        boxShadow:
                            '0 0 6px rgba(0, 229, 255, 0.35), inset 0 0 6px rgba(0, 229, 255, 0.08)',
                    }}
                >
                    {STANDINGS_VIEWS.map((v) => (
                        <button
                            key={v.key}
                            type='button'
                            onClick={() => handleViewChange(v.key)}
                            className={`cursor-pointer whitespace-nowrap rounded-full px-3 py-0.5 font-semibold transition-colors ${view === v.key
                                ? 'bg-[#00E5FF] text-[#080D1A]'
                                : 'bg-transparent text-[#A6ECFF] hover:text-white'
                                }`}
                        >
                            {v.label}
                        </button>
                    ))}
                </div>
            </div>

            <div className='w-full'>
                <NhlStandingsTable view={view} />
            </div>
        </div>
    );
}

// ---------------------------------------------------------------------
// StatistiquesPage
// ---------------------------------------------------------------------

export default function StatistiquesPage() {
    const { user, updatePreferences } = useAuth();

    const myTeamId = user?.fantasyTeamId ?? null;
    const showContracts = user?.showContractsStats ?? false;

    const [mainTab, setMainTab] = useState<MainTab>('players');
    const location = useLocation();

    useEffect(() => {
        if (location.state && (location.state as any).resetTab) {
            setMainTab('players');
            window.scrollTo(0, 0);
        }
    }, [location.state]);

    const [scorerRows, setScorerRows] = useState<TopScorerRow[]>([]);
    const [scorerLoading, setScorerLoading] = useState(true);
    const [scorerError, setScorerError] = useState<string | null>(null);

    const playerFilter = user?.statistiquesPlayerFilter || 'rostered';

    useEffect(() => {
        let cancelled = false;

        setScorerLoading(true);

        getTopScorers(playerFilter)
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
    }, [playerFilter]);

    const [hasVisitedInjuries, setHasVisitedInjuries] = useState(false);
    const [hasVisitedTeams, setHasVisitedTeams] = useState(false);

    useEffect(() => {
        if (mainTab === 'injuries') {
            setHasVisitedInjuries(true);
        }
    }, [mainTab]);

    useEffect(() => {
        if (mainTab === 'teams') {
            setHasVisitedTeams(true);
        }
    }, [mainTab]);

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

    useEffect(() => {
        if (scorerLoading) return;
        if (hasVisitedTeams) return;

        let cleanup: (() => void) | null = null;

        if (typeof window.requestIdleCallback === 'function') {
            const handle = window.requestIdleCallback(
                () => setHasVisitedTeams(true),
                { timeout: 2000 },
            );

            cleanup = () => window.cancelIdleCallback(handle);
        } else {
            const timer = window.setTimeout(
                () => setHasVisitedTeams(true),
                500,
            );

            cleanup = () => window.clearTimeout(timer);
        }

        return () => {
            cleanup?.();
        };
    }, [scorerLoading, hasVisitedTeams]);

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

                <button
                    type='button'
                    onClick={() => setMainTab('injuries')}
                    className={`flex-1 cursor-pointer rounded-full px-2.5 py-0.5 text-xs font-bold transition-all duration-200 ${mainTab === 'injuries'
                        ? 'bg-white text-[#1D1B61]'
                        : 'bg-transparent text-[#F2F5FA] hover:bg-[#00A8FF]/15 hover:text-white'
                        }`}
                    style={
                        mainTab === 'injuries'
                            ? MAIN_BUTTON_ACTIVE_STYLE
                            : undefined
                    }
                >
                    Blessures
                </button>
            </div>

            <div
                className={
                    mainTab === 'players'
                        ? 'block w-full'
                        : 'hidden'
                }
            >
                <TopScorersTable
                    rows={scorerRows}
                    loading={scorerLoading}
                    error={scorerError}
                    myTeamId={myTeamId}
                    showContracts={showContracts}
                    onToggleContracts={(checked) => void updatePreferences({ showContractsStats: checked })}
                />
            </div>

            {hasVisitedTeams && (
                <div
                    className={
                        mainTab === 'teams'
                            ? 'block w-full'
                            : 'hidden'
                    }
                >
                    <TeamsSection />
                </div>
            )}

            {hasVisitedInjuries && (
                <div
                    className={
                        mainTab === 'injuries'
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