/**
 * Primary NHL team colors used for the neon glow around team logos,
 * player card backgrounds, row tints, and anywhere else the app
 * needs to identify a team by color.
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

/**
 * Aura-only color overrides. Used by `getNhlTeamAuraColor` when the
 * base team color in NHL_TEAM_COLORS produces an aura that is too
 * dark / washed out to read on the dark UI, or when the aura should
 * be a different hue than the team's primary color.
 *
 * Strength adjustments are made by blending the hex toward white
 * (add strength) or black (reduce strength). The glow radius and
 * alpha are unchanged by these tweaks: a "reduce 20% strength" entry
 * is a 20% darker color at the same radius and opacity as before.
 *
 * Teams not listed here fall back to their NHL_TEAM_COLORS entry.
 * Changing a value here does NOT change the base team color used
 * for card backgrounds, row tints, or any other non-aura surface.
 */
export const NHL_TEAM_AURA_COLORS: Record<string, string> = {
    // Brighter aura variants (base color unchanged).
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
    SJS: '#338A91',   // new: #006D75 @ +20%

    // Full aura-only overrides (base color unchanged).
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

/**
 * Returns the color to use for team-tinted auras (glows, text
 * shadows, drop-shadows, radial gradients). Falls back to the base
 * team color when no aura override exists, and to the league cyan
 * when neither is known.
 */
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