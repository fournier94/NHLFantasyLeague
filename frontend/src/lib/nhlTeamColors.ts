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

/**
 * Converts a hex color like "#AF1E2D" to an "hsl(H, S%, L%)" string,
 * with the saturation scaled by `saturationScale`.
 *
 *   saturationScale = 1    -> original color
 *   saturationScale = 0.5  -> half the saturation
 *   saturationScale = 0    -> grayscale
 *
 * The hue and lightness are preserved, so a red team stays red, just
 * muted, and a blue team stays blue.
 */
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