import { useEffect, useMemo, useState } from 'react';
import { Link, useLocation, useParams } from 'react-router-dom';
import { ArrowLeft } from 'lucide-react';
import {
    getNhlStandings,
    getTopScorers,
    type NhlTeamStandingsRow,
    type TopScorerRow,
} from '@/api/client';
import { NhlTeamLogo } from '@/components/nhl/NhlTeamLogo';
import {
    getNhlTeamColor,
    getNhlTeamTextColor,
    getNhlTeamAuraColor,
    desaturateHex,
} from '@/lib/nhlTeamColors';

// ---------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------

function formatPct(val: number): string {
    if (val === 0) return '0.0%';
    return (val <= 1 ? val * 100 : val).toFixed(1) + '%';
}

function formatDiff(diff: number): string {
    return diff > 0 ? `+${diff}` : String(diff);
}

function streakRankValue(row: NhlTeamStandingsRow): number {
    if (!row.streakCode) return 0;
    if (row.streakCode === 'W') return row.streakCount;
    if (row.streakCode === 'L') return -row.streakCount;
    return 0;
}

// Helper to convert hex to rgba for the aura box-shadow
const hexToRgba = (hex: string, alpha: number) => {
    let clean = hex.replace('#', '');
    if (clean.length === 3) {
        clean = clean.split('').map((c) => c + c).join('');
    }
    const r = parseInt(clean.substring(0, 2), 16);
    const g = parseInt(clean.substring(2, 4), 16);
    const b = parseInt(clean.substring(4, 6), 16);
    return `rgba(${r}, ${g}, ${b}, ${alpha})`;
};

type Direction = 'asc' | 'desc';

interface StatDefinition {
    label: string;
    direction: Direction;
    format: (row: NhlTeamStandingsRow) => string;
    value: (row: NhlTeamStandingsRow) => number;
}

const statsConfig = {
    V: {
        label: 'V',
        direction: 'desc',
        format: (r: NhlTeamStandingsRow) => String(r.wins),
        value: (r: NhlTeamStandingsRow) => r.wins,
    },
    D: {
        label: 'D',
        direction: 'asc',
        format: (r: NhlTeamStandingsRow) => String(r.losses),
        value: (r: NhlTeamStandingsRow) => r.losses,
    },
    DP: {
        label: 'DP',
        direction: 'asc',
        format: (r: NhlTeamStandingsRow) => String(r.otLosses),
        value: (r: NhlTeamStandingsRow) => r.otLosses,
    },
    PTS: {
        label: 'PTS',
        direction: 'desc',
        format: (r: NhlTeamStandingsRow) => String(r.points),
        value: (r: NhlTeamStandingsRow) => r.points,
    },
    PCT: {
        label: '%',
        direction: 'desc',
        format: (r: NhlTeamStandingsRow) => formatPct(r.pointPctg),
        value: (r: NhlTeamStandingsRow) => r.pointPctg,
    },
    DIFF: {
        label: 'DIFF',
        direction: 'desc',
        format: (r: NhlTeamStandingsRow) => formatDiff(r.goalDifferential),
        value: (r: NhlTeamStandingsRow) => r.goalDifferential,
    },
    BP: {
        label: 'BP',
        direction: 'desc',
        format: (r: NhlTeamStandingsRow) => String(r.goalsFor),
        value: (r: NhlTeamStandingsRow) => r.goalsFor,
    },
    BC: {
        label: 'BC',
        direction: 'asc',
        format: (r: NhlTeamStandingsRow) => String(r.goalsAgainst),
        value: (r: NhlTeamStandingsRow) => r.goalsAgainst,
    },
    MJ: {
        label: 'MJ%',
        direction: 'desc',
        format: (r: NhlTeamStandingsRow) => formatPct(r.faceoffWinPct),
        value: (r: NhlTeamStandingsRow) => r.faceoffWinPct,
    },
    AN: {
        label: 'AN%',
        direction: 'desc',
        format: (r: NhlTeamStandingsRow) => formatPct(r.powerPlayPct),
        value: (r: NhlTeamStandingsRow) => r.powerPlayPct,
    },
    DN: {
        label: 'DN%',
        direction: 'desc',
        format: (r: NhlTeamStandingsRow) => formatPct(r.penaltyKillPct),
        value: (r: NhlTeamStandingsRow) => r.penaltyKillPct,
    },
    SEQ: {
        label: 'SÉQ',
        direction: 'desc',
        format: (r: NhlTeamStandingsRow) =>
            r.streakCode ? `${r.streakCode}${r.streakCount}` : '—',
        value: (r: NhlTeamStandingsRow) => streakRankValue(r),
    },
    L10: {
        label: '10D',
        direction: 'desc',
        format: (r: NhlTeamStandingsRow) =>
            `${r.l10Wins}-${r.l10Losses}-${r.l10OtLosses}`,
        value: (r: NhlTeamStandingsRow) =>
            r.l10Wins * 2 + r.l10OtLosses,
    },
} as const;

function computeRank(
    teams: NhlTeamStandingsRow[],
    stat: StatDefinition,
    team: NhlTeamStandingsRow,
): number {
    const sorted = [...teams].sort((a, b) => {
        const av = stat.value(a);
        const bv = stat.value(b);

        if (av === bv) {
            return a.teamAbbreviation.localeCompare(b.teamAbbreviation);
        }

        return stat.direction === 'asc' ? av - bv : bv - av;
    });

    return sorted.findIndex(
        t => t.nhlTeamId === team.nhlTeamId,
    ) + 1;
}

// ---------------------------------------------------------------------
// Compact technical stat cell
// ---------------------------------------------------------------------

function TechnicalStat({
    label,
    value,
    align = 'left',
    valueColor,
    textOutlineStyle,
    rank,
}: {
    label: string;
    value: string;
    align?: 'left' | 'center' | 'right';
    valueColor: string;
    textOutlineStyle?: React.CSSProperties;
    rank?: number;
}) {
    return (
        <div
            className={`flex min-w-0 items-center py-1 ${align === 'center'
                ? 'justify-center text-center px-1'
                : align === 'right'
                    ? 'justify-end text-right pr-1 sm:pr-2'
                    : 'justify-start text-left pl-0 sm:pl-1'
                }`}
        >
            <span
                className="text-sm font-semibold uppercase tracking-[0.12em] sm:text-base whitespace-nowrap"
                style={{ color: valueColor, ...textOutlineStyle }}
            >
                {label}
            </span>

            <span
                className="ml-1.5 flex items-baseline gap-1 whitespace-nowrap"
                style={{ color: valueColor, ...textOutlineStyle }}
            >
                <span
                    className="text-sm font-bold tabular-nums sm:text-base"
                >
                    {value}
                </span>

                {rank !== undefined && (
                    <span
                        className="text-[0.65rem] font-bold tabular-nums opacity-80"
                        style={{ color: valueColor, ...textOutlineStyle }}
                    >
                        {rank}e
                    </span>
                )}
            </span>
        </div>
    );
}

// ---------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------

export default function NhlEquipePage() {
    const { nhlTeamId } = useParams<{ nhlTeamId: string }>();
    const location = useLocation();

    const returnTo =
        (location.state as { returnTo?: string } | null)?.returnTo;

    const backTo = returnTo || '/statistiques';
    const backState = returnTo
        ? undefined
        : { initialTab: 'teams' as const };

    const [rows, setRows] = useState<NhlTeamStandingsRow[]>([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);

    const [allPlayers, setAllPlayers] = useState<TopScorerRow[]>([]);

    useEffect(() => {
        let cancelled = false;

        setLoading(true);
        setError(null);

        Promise.all([
            getNhlStandings(),
            getTopScorers('all')
        ])
            .then(([standingsData, playersData]) => {
                if (!cancelled) {
                    setRows(standingsData);
                    setAllPlayers(playersData);
                }
            })
            .catch(() => {
                if (!cancelled) {
                    setError(
                        "Impossible de charger les statistiques de l'équipe.",
                    );
                }
            })
            .finally(() => {
                if (!cancelled) setLoading(false);
            });

        return () => {
            cancelled = true;
        };
    }, []);

    const team = useMemo(() => {
        const id = Number(nhlTeamId);

        if (!Number.isFinite(id)) return null;

        return rows.find(t => t.nhlTeamId === id) ?? null;
    }, [rows, nhlTeamId]);

    const teamPlayers = useMemo(() => {
        if (!team) return [];
        return allPlayers
            .filter(p => p.nhlTeamAbbreviation === team.teamAbbreviation && p.gamesPlayed > 0)
            .sort((a, b) => (b.fantasyPoints ?? 0) - (a.fantasyPoints ?? 0));
    }, [allPlayers, team]);

    const skaters = useMemo(() => teamPlayers.filter(p => p.position !== 'G'), [teamPlayers]);
    const goalies = useMemo(() => teamPlayers.filter(p => p.position === 'G'), [teamPlayers]);

    if (loading) {
        return (
            <section className="-mt-4 flex min-h-full w-full flex-col items-center gap-3 pt-2.5 sm:-mt-6">
                <p className="text-base text-muted-foreground">
                    Chargement...
                </p>
            </section>
        );
    }

    if (error || !team) {
        return (
            <section className="-mt-4 flex min-h-full w-full flex-col items-center gap-3 pt-2.5 sm:-mt-6">
                <div className="w-full max-w-5xl">
                    <Link
                        to={backTo}
                        state={backState}
                        className="inline-flex items-center gap-2 text-base text-muted-foreground transition-colors hover:text-white"
                    >
                        <ArrowLeft className="h-5 w-5" />
                        <span>Retour</span>
                    </Link>
                </div>

                <p className="text-base text-destructive">
                    {error ?? 'Équipe introuvable.'}
                </p>
            </section>
        );
    }

    const primaryColor = getNhlTeamColor(team.teamAbbreviation);
    const textColor = getNhlTeamTextColor(team.teamAbbreviation);
    const auraColor = getNhlTeamAuraColor(team.teamAbbreviation);

    // Specific overrides
    const isBlackBgTeam = team.teamAbbreviation === 'VGK' || team.teamAbbreviation === 'BOS';
    const isUtahOrNashville = team.teamAbbreviation === 'UTA' || team.teamAbbreviation === 'NSH';
    const isOttawa = team.teamAbbreviation === 'OTT';
    const isFlorida = team.teamAbbreviation === 'FLA';
    const isMontreal = team.teamAbbreviation?.toUpperCase() === 'MTL';
    const isSanJose = team.teamAbbreviation === 'SJS';
    const isAnaheim = team.teamAbbreviation === 'ANA';
    const isColumbus = team.teamAbbreviation === 'CBJ';
    const isChicago = team.teamAbbreviation === 'CHI';

    let customBg = '';
    if (isOttawa) {
        customBg = desaturateHex(primaryColor, 0.8)
            .replace('hsl', 'hsla')
            .replace(')', ', 0.35)');
    } else if (isUtahOrNashville) {
        customBg = desaturateHex(primaryColor, 1)
            .replace('hsl', 'hsla')
            .replace(')', ', 0.6)');
    } else if (isAnaheim) {
        customBg = desaturateHex(primaryColor, 1)
            .replace('hsl', 'hsla')
            .replace(')', ', 0.7)');
    } else if (isChicago) {
        customBg = desaturateHex(primaryColor, 1)
            .replace('hsl', 'hsla')
            .replace(')', ', 1)');
    } else {
        customBg = desaturateHex(primaryColor, 0.7)
            .replace('hsl', 'hsla')
            .replace(')', ', 0.4)');
    }

    const statsBgColor = isBlackBgTeam ? '#000000' : customBg;

    let statsFontColor = textColor;
    if (isBlackBgTeam) statsFontColor = primaryColor;
    if (isOttawa || isFlorida || isMontreal || isSanJose || isColumbus) statsFontColor = '#FFFFFF';

    const badgeBgColor = primaryColor;
    const badgeTextColor = isBlackBgTeam || isColumbus ? '#FFFFFF' : textColor;

    // Removed outline styles entirely
    const textOutlineStyle: React.CSSProperties = {};

    // Calculate ranks for the top section
    const rankDiff = team ? computeRank(rows, statsConfig.DIFF, team) : undefined;
    const rankBP = team ? computeRank(rows, statsConfig.BP, team) : undefined;
    const rankBC = team ? computeRank(rows, statsConfig.BC, team) : undefined;
    const rankMJ = team ? computeRank(rows, statsConfig.MJ, team) : undefined;
    const rankAN = team ? computeRank(rows, statsConfig.AN, team) : undefined;
    const rankDN = team ? computeRank(rows, statsConfig.DN, team) : undefined;

    // Adapt the team name font size based on specific team names and length
    let nameSizeClass = 'text-2xl sm:text-3xl';

    if (team.teamCommonName === 'Golden Knights') {
        nameSizeClass = 'text-base sm:text-lg'; // Specific small size for Golden Knights
    } else if (
        team.teamCommonName === 'Blackhawks' ||
        team.teamCommonName === 'Avalanche' ||
        team.teamCommonName === 'Red Wings' ||
        team.teamCommonName === 'Canadiens'
    ) {
        nameSizeClass = 'text-xl sm:text-2xl'; // Matches Blackhawks
    } else if (team.teamCommonName.length > 10) {
        nameSizeClass = 'text-lg sm:text-xl';
    } else if (team.teamCommonName.length > 8) {
        nameSizeClass = 'text-xl sm:text-2xl';
    }

    return (
        <section className="-mt-4 flex min-h-full w-full flex-col items-center pt-2.5 sm:-mt-6 relative">

            {/* Sticky Retour Button - h-0 prevents it from pushing content down */}
            <div className="sticky top-[calc(var(--header-height,4rem)+0.5rem)] z-[60] w-full max-w-5xl px-3 h-0 pointer-events-none flex justify-end">
                <Link
                    to={backTo}
                    state={backState}
                    className="pointer-events-auto inline-flex items-center gap-2 text-lg font-bold text-white transition-colors hover:text-white/80 -translate-y-1"
                >
                    <ArrowLeft className="h-5 w-5" />
                    <span>Retour</span>
                </Link>
            </div>

            {/* Dark broadcast panel with Statistiques-style neon effect */}
            <div
                className="relative w-full max-w-5xl overflow-hidden rounded-lg border"
                style={{
                    border: `1px solid ${auraColor}`,
                    backgroundColor: statsBgColor,
                    boxShadow: [
                        `0 0 3px ${auraColor}`,
                        `0 0 8px ${hexToRgba(auraColor, 0.90)}`,
                        `0 0 17px ${hexToRgba(auraColor, 0.48)}`,
                        `inset 0 0 7px ${hexToRgba(auraColor, 0.16)}`,
                        `inset 0 0 1px ${hexToRgba('#FFFFFF', 0.45)}`,
                    ].join(', '),
                }}
            >
                {/* Identity row */}
                <div className="relative flex items-center gap-3 px-3 pb-2 pl-4 pt-3 sm:gap-4 sm:px-5 sm:pl-6">
                    {/* Logo in a separate dark tile */}
                    <div
                        className="relative flex h-[76px] w-[76px] shrink-0 items-center justify-center overflow-hidden rounded-md sm:h-[86px] sm:w-[86px]"
                        style={{
                            transform: 'scale(1.25)',
                            zIndex: 10,
                        }}
                    >
                        <NhlTeamLogo
                            abbreviation={team.teamAbbreviation}
                            size={104}
                        />
                    </div>

                    {/* Team identity */}
                    <div className="min-w-0 flex-1 self-stretch flex flex-col justify-center">
                        <div className="flex items-center gap-2">
                            <span
                                className="text-xs font-black uppercase tracking-[0.2em] sm:text-sm"
                                style={{ color: statsFontColor, ...textOutlineStyle }}
                            >
                                {team.teamPlaceName}
                            </span>

                            <span className="h-px flex-1" style={{ backgroundColor: statsFontColor, opacity: 0.2 }} />
                        </div>

                        <div className="mt-1 flex items-baseline gap-3 min-w-0">
                            <h1
                                className={`truncate font-black leading-tight tracking-tight ${nameSizeClass}`}
                                style={{ color: statsFontColor, ...textOutlineStyle }}
                            >
                                {team.teamCommonName}
                            </h1>

                            <span
                                className="shrink-0 text-base font-bold tabular-nums sm:text-lg"
                                style={{ color: statsFontColor, ...textOutlineStyle }}
                            >
                                {team.wins}-{team.losses}-{team.otLosses}
                            </span>
                        </div>

                        {/* Moved form indicator */}
                        <div className="mt-1.5 flex w-full items-center justify-between">
                            <div className="flex items-center gap-2">
                                <span
                                    className="text-sm font-bold uppercase tracking-[0.16em]"
                                    style={{ color: statsFontColor, ...textOutlineStyle }}
                                >
                                    10D
                                </span>

                                <span
                                    className="h-1 w-1 rounded-full"
                                    style={{ backgroundColor: statsFontColor }}
                                />

                                <span
                                    className="text-base font-black tabular-nums"
                                    style={{ color: statsFontColor, ...textOutlineStyle }}
                                >
                                    {team.l10Wins}
                                    <span className="mx-1 opacity-40">–</span>
                                    {team.l10Losses}
                                    <span className="mx-1 opacity-40">–</span>
                                    {team.l10OtLosses}
                                </span>
                            </div>

                            <span
                                className="rounded-sm px-2 py-0.5 text-xs font-black uppercase"
                                style={{
                                    color: badgeTextColor,
                                    backgroundColor: badgeBgColor,
                                }}
                            >
                                {team.streakCode
                                    ? `${team.streakCode}${team.streakCount}`
                                    : '—'}
                            </span>
                        </div>
                    </div>

                    {/* Standalone points block */}
                    <div
                        className="relative flex min-w-[68px] shrink-0 flex-col items-center justify-center self-stretch overflow-hidden rounded-md border px-2 py-2 sm:min-w-[82px] sm:px-3"
                        style={{
                            borderColor: `${auraColor}65`,
                            background: `linear-gradient(145deg, ${auraColor}28, ${primaryColor}20 70%, rgba(0,0,0,0.22))`,
                            boxShadow: `inset 0 1px 0 rgba(255,255,255,0.08), 0 0 15px ${auraColor}10`,
                        }}
                    >
                        <div
                            className="absolute left-2 right-2 top-0 h-[2px]"
                            style={{
                                background: `linear-gradient(90deg, transparent, ${auraColor}, transparent)`,
                            }}
                        />

                        <span
                            className="text-[9px] font-black uppercase tracking-[0.2em]"
                            style={{ color: statsFontColor, ...textOutlineStyle }}
                        >
                            PTS
                        </span>

                        <span
                            className="mt-0.5 text-3xl font-black leading-none tracking-tight tabular-nums sm:text-4xl"
                            style={{
                                color: statsFontColor,
                                textShadow: `0 0 18px ${auraColor}70`,
                                ...textOutlineStyle,
                            }}
                        >
                            {team.points}
                        </span>

                        <span
                            className="mt-1 text-[10px] font-bold tabular-nums"
                            style={{ color: statsFontColor, ...textOutlineStyle }}
                        >
                            {formatPct(team.pointPctg)}
                        </span>
                    </div>
                </div>

                {/* Compact technical statistics */}
                <div className="relative grid grid-cols-3 gap-y-2 px-3 pt-0 pb-2.5 sm:grid-cols-6 sm:px-4 border-b border-white/10">
                    <TechnicalStat
                        label="DIFF"
                        value={formatDiff(team.goalDifferential)}
                        align="left"
                        valueColor={statsFontColor}
                        textOutlineStyle={textOutlineStyle}
                        rank={rankDiff}
                    />
                    <TechnicalStat
                        label="BP"
                        value={String(team.goalsFor)}
                        align="center"
                        valueColor={statsFontColor}
                        textOutlineStyle={textOutlineStyle}
                        rank={rankBP}
                    />
                    <TechnicalStat
                        label="BC"
                        value={String(team.goalsAgainst)}
                        align="right"
                        valueColor={statsFontColor}
                        textOutlineStyle={textOutlineStyle}
                        rank={rankBC}
                    />
                    <TechnicalStat
                        label="MJ%"
                        value={formatPct(team.faceoffWinPct)}
                        align="left"
                        valueColor={statsFontColor}
                        textOutlineStyle={textOutlineStyle}
                        rank={rankMJ}
                    />
                    <TechnicalStat
                        label="AN%"
                        value={formatPct(team.powerPlayPct)}
                        align="center"
                        valueColor={statsFontColor}
                        textOutlineStyle={textOutlineStyle}
                        rank={rankAN}
                    />
                    <TechnicalStat
                        label="DN%"
                        value={formatPct(team.penaltyKillPct)}
                        align="right"
                        valueColor={statsFontColor}
                        textOutlineStyle={textOutlineStyle}
                        rank={rankDN}
                    />
                </div>

                {/* Skaters Table */}
                <div className="flex flex-col">
                    <div
                        className="flex items-center justify-between border-b border-white/10 px-3 py-2 text-[0.65rem] font-black uppercase tracking-wider sm:px-4"
                        style={{ backgroundColor: statsFontColor, color: isBlackBgTeam ? '#000000' : primaryColor }}
                    >
                        <div className="flex-1 text-center pr-8">Joueur</div>
                        <div className="w-6 text-center relative -left-3">POS</div>
                        <div className="w-6 text-center">GP</div>
                        <div className="w-6 text-center">G</div>
                        <div className="w-6 text-center">A</div>
                        <div className="w-8 text-center">PTS</div>
                        <div className="w-12 text-center">ATOI</div>
                        <div className="w-8 text-center">FP</div>
                    </div>

                    {skaters.length === 0 ? (
                        <div className="px-3 py-6 text-center text-sm text-muted-foreground">
                            Aucun patineur n'a joué de match cette année.
                        </div>
                    ) : (
                        skaters.map(p => (
                            <Link
                                key={p.playerId}
                                to={`/joueurs/${p.nhlPlayerId}`}
                                className="flex items-center justify-between border-b border-white/5 px-3 py-2 text-sm transition-colors hover:bg-white/5 last:border-b-0 sm:px-4"
                            >
                                <div className="flex-1 text-center min-w-0 pr-8">
                                    <span className="truncate font-semibold" style={{ color: statsFontColor }}>
                                        {p.firstName} {p.lastName}
                                    </span>
                                </div>
                                <div className="w-6 text-center text-xs relative -left-3" style={{ color: statsFontColor }}>{p.position}</div>
                                <div className="w-6 text-center font-bold" style={{ color: statsFontColor }}>{p.gamesPlayed}</div>
                                <div className="w-6 text-center text-white">{p.goals}</div>
                                <div className="w-6 text-center text-white">{p.assists}</div>
                                <div className="w-8 text-center font-bold text-[#FFC72C]">{p.points}</div>
                                <div className="w-12 text-center text-xs text-white">{p.timeOnIce ?? '—'}</div>
                                <div className="w-8 text-center font-bold text-[#FFC72C]">{p.fantasyPoints ?? '—'}</div>
                            </Link>
                        ))
                    )}
                </div>

                {/* Goalies Table */}
                {goalies.length > 0 && (
                    <div className="flex flex-col border-t-2 border-white/10">
                        <div
                            className="flex items-center justify-between border-b border-white/10 px-3 py-2 text-[0.65rem] font-black uppercase tracking-wider sm:px-4"
                            style={{ backgroundColor: statsFontColor, color: isBlackBgTeam ? '#000000' : primaryColor }}
                        >
                            <div className="flex-1 text-center pr-8">Gardien</div>
                            <div className="w-6 text-center">GP</div>
                            <div className="w-6 text-center">W</div>
                            <div className="w-6 text-center">L</div>
                            <div className="w-7 text-center">OTL</div>
                            <div className="w-6 text-center">SO</div>
                            <div className="w-9 text-center">SV%</div>
                            <div className="w-8 text-center">GAA</div>
                            <div className="w-8 text-center">FP</div>
                        </div>

                        {goalies.map(p => (
                            <Link
                                key={p.playerId}
                                to={`/joueurs/${p.nhlPlayerId}`}
                                className="flex items-center justify-between border-b border-white/5 px-3 py-2 text-sm transition-colors hover:bg-white/5 last:border-b-0 sm:px-4"
                            >
                                <div className="flex-1 text-center min-w-0 pr-8">
                                    <span className="truncate font-semibold" style={{ color: statsFontColor }}>
                                        {p.firstName} {p.lastName}
                                    </span>
                                </div>
                                <div className="w-6 text-center font-bold" style={{ color: statsFontColor }}>{p.gamesPlayed}</div>
                                <div className="w-6 text-center text-white">{p.wins}</div>
                                <div className="w-6 text-center text-white">{p.losses}</div>
                                <div className="w-7 text-center text-white">{p.overtimeLosses}</div>
                                <div className="w-6 text-center text-white">{p.shutouts}</div>
                                <div className="w-9 text-center text-xs text-white">{p.savePercentage.toFixed(3)}</div>
                                <div className="w-8 text-center text-xs text-white">{p.goalsAgainstAverage.toFixed(2)}</div>
                                <div className="w-8 text-center font-bold text-[#FFC72C]">{p.fantasyPoints ?? '—'}</div>
                            </Link>
                        ))}
                    </div>
                )}
            </div>
        </section>
    );
}