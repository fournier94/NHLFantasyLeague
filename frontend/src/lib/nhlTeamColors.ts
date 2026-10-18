export const NHL_TEAM_COLORS: Record<string, string> = {
    ANA: '#FC4C02',
    BOS: '#FFB81C',
    BUF: '#003087',
    CGY: '#D2001C',
    CAR: '#CC0000',
    CHI: '#CF0A2C',
    COL: '#6F263D',
    CBJ: '#002654',
    DAL: '#006847',
    DET: '#CE1126',
    EDM: '#041E42',
    FLA: '#C8102E',
    LAK: '#000000',
    MIN: '#154734',
    MTL: '#AF1E2D',
    NSH: '#FFB81C',
    NJD: '#CE1126',
    NYI: '#00539B',
    NYR: '#0038A8',
    OTT: '#C52032',
    PHI: '#F74902',
    PIT: '#FCB514',
    SJS: '#006D75',
    SEA: '#001628',
    STL: '#002F87',
    TBL: '#002868',
    TOR: '#003E7E',
    UTA: '#69B3E7',
    VAN: '#00205B',
    VGK: '#B4975A',
    WSH: '#C8102E',
    WPG: '#041E42',
};

export const NHL_TEAM_TEXT_COLORS: Record<string, string> = {
    ANA: '#000000',
    BOS: '#000000',
    BUF: '#FFB81C',
    CGY: '#FAAF19',
    CAR: '#FFFFFF',
    CHI: '#000000',
    COL: '#FFFFFF',
    CBJ: '#CE1126',
    DAL: '#FFFFFF',
    DET: '#FFFFFF',
    EDM: '#FF4C00',
    FLA: '#041E42',
    LAK: '#A2AAAD',
    MIN: '#c7102c',
    MTL: '#192168',
    NSH: '#041E42',
    NJD: '#FFFFFF',
    NYI: '#F47D30',
    NYR: '#FFFFFF',
    OTT: '#000000',
    PHI: '#000000',
    PIT: '#000000',
    SJS: '#000000',
    SEA: '#99D9D9',
    STL: '#FFB81C',
    TBL: '#FFFFFF',
    TOR: '#FFFFFF',
    UTA: '#000000',
    VAN: '#FFFFFF',
    VGK: '#000000',
    WSH: '#FFFFFF',
    WPG: '#FFFFFF',
};

export const NHL_TEAM_AURA_COLORS: Record<string, string> = {
    TBL: '#4A90E2',
    MIN: '#2E9E6A',
    DAL: '#009A63',
    VAN: '#3A78D0',
    TOR: '#3A78D0',
    UTA: '#B4B4B4',
    SEA: '#3FA9E0',
    COL: '#BD7990',
    CBJ: '#3A78C8',
    EDM: '#D1501A',
    WPG: '#4A90E2',
    SJS: '#338A91',
    STL: '#E3A312',
    BUF: '#CC9316',
    NYI: '#FC4C02',
    LAK: '#CCCCCC',
    PIT: '#B07F0E',
    CHI: '#BA0928',
    NSH: '#CC9316',
    NYR: '#1A4CB1',
    ANA: '#E34402',
};

export function getNhlTeamColor(
    abbreviation: string | null | undefined,
): string {
    return (
        NHL_TEAM_COLORS[abbreviation?.toUpperCase() ?? ''] ??
        '#00A8FF'
    );
}

export function getNhlTeamTextColor(
    abbreviation: string | null | undefined,
): string {
    return (
        NHL_TEAM_TEXT_COLORS[abbreviation?.toUpperCase() ?? ''] ??
        '#FFFFFF'
    );
}

export function getNhlTeamAuraColor(
    abbreviation: string | null | undefined,
): string {
    const key = abbreviation?.toUpperCase() ?? '';

    return (
        NHL_TEAM_AURA_COLORS[key] ??
        NHL_TEAM_COLORS[key] ??
        '#00A8FF'
    );
}

export function desaturateHex(
    hex: string,
    saturationScale: number,
): string {
    // Strip leading '#' and expand 3-digit hex to 6-digit.
    let h = hex.replace('#', '');

    if (h.length === 3) {
        h = h[0] + h[0] + h[1] + h[1] + h[2] + h[2];
    }

    const r = parseInt(h.substring(0, 2), 16) / 255;
    const g = parseInt(h.substring(2, 4), 16) / 255;
    const b = parseInt(h.substring(4, 6), 16) / 255;

    const max = Math.max(r, g, b);
    const min = Math.min(r, g, b);
    const l = (max + min) / 2;

    let s = 0;
    let hue = 0;

    if (max !== min) {
        const d = max - min;
        s = l > 0.5 ? d / (2 - max - min) : d / (max + min);

        switch (max) {
            case r:
                hue = ((g - b) / d + (g < b ? 6 : 0)) / 6;
                break;
            case g:
                hue = ((b - r) / d + 2) / 6;
                break;
            case b:
                hue = ((r - g) / d + 4) / 6;
                break;
        }
    }

    const newS = Math.max(0, Math.min(1, s * saturationScale));

    const hueDeg = Math.round(hue * 360);
    const satPct = Math.round(newS * 100);
    const lightPct = Math.round(l * 100);

    return `hsl(${hueDeg}, ${satPct}%, ${lightPct}%)`;
}