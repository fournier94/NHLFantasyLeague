/**
 * Primary NHL team colors used for the neon glow around team logos.
 */
export const NHL_TEAM_COLORS: Record<string, string> = {
    MTL: '#AF1E2D',
    TOR: '#003E7E',
    BOS: '#FFB81C',
    BUF: '#003087',
    DET: '#CE1126',
    FLA: '#C8102E',
    TBL: '#002868',
    OTT: '#C52032',
    NYR: '#0038A8',
    NYI: '#00539B',
    NJD: '#CE1126',
    PHI: '#F74902',
    PIT: '#FCB514',
    WSH: '#C8102E',
    CAR: '#CC0000',
    CBJ: '#002654',
    CHI: '#CF0A2C',
    DAL: '#006847',
    MIN: '#154734',
    NSH: '#FFB81C',
    STL: '#002F87',
    COL: '#6F263D',
    UTA: '#010101',
    WPG: '#041E42',
    ANA: '#FC4C02',
    CGY: '#C8102E',
    EDM: '#041E42',
    LAK: '#111111',
    SJS: '#006D75',
    VAN: '#00205B',
    VGK: '#B4975A',
    SEA: '#001628',
};

export function getNhlTeamColor(
    abbreviation: string | null | undefined,
): string {
    return (
        NHL_TEAM_COLORS[abbreviation?.toUpperCase() ?? ''] ??
        '#00A8FF'
    );
}