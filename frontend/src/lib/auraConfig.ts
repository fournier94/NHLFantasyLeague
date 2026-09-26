/**
 * Every aura (glow) effect in the app has one entry here.
 *
 * Intensities are 0-10:
 *   0  = aura disabled (no shadow, no filter, no animation)
 *   1  = subtlest
 *   10 = flashiest
 *
 * All auras pulse: the value below sets the *base* size, and the pulse
 * breathes it between two endpoints derived from that base. At 0 the
 * pulse is off entirely.
 *
 * HOW TO TUNE:
 *
 *   1. Pick the channel you want to change in AURA_RANGES below.
 *   2. Adjust its `min` (value at slider 1) or `max` (value at slider 10).
 *   3. The values between 1 and 10 are interpolated linearly, so a change
 *      of 1 on the slider always produces the same visual step.
 *   4. AURA_GLOBAL_PUNCH multiplies the gap (max - min) for every channel
 *      at once. 1.0 = the base range, 1.5 = +50%, 2.0 = +100%, etc.
 *
 * Later, when the values are stored per-user in the DB, the ranges below
 * become the defaults and only the intensities move to the user profile.
 */

import type { CSSProperties } from 'react';

// =====================================================================
// QUICK-EDIT SECTION
// =====================================================================

/** Every aura channel in the app. */
export type AuraChannel =
    | 'mobilePageTitle'
    | 'mobileMenuIcon'
    | 'leagueLogo'
    | 'rosterSectionTitle'
    | 'playerCardBackground'
    | 'playerCardName'
    | 'playerCardLogo'
    | 'playerCardPicture'
    | 'playerCardText'
    | 'capBarTrack';

/**
 * Multiplies the (max - min) gap of every channel by this factor.
 * 1.0 = base range, 1.5 = +50%, 2.0 = +100%.
 */
export const AURA_GLOBAL_PUNCH = 1.5;

/** Default intensity per channel. 0 disables the aura. */
export const AURA_DEFAULTS: Record<AuraChannel, number> = {
    mobilePageTitle: 7,
    mobileMenuIcon: 7,
    leagueLogo: 6,
    rosterSectionTitle: 5,
    playerCardBackground: 6,
    playerCardName: 3,
    playerCardLogo: 4,
    playerCardPicture: 5,
    playerCardText: 5,
    capBarTrack: 3,
};

/**
 * League-logo-only pulse amplitude.
 *
 * Every aura pulses between two shadows. For most channels the two
 * endpoints are close (subtle breathing). For the league logo we want
 * the pulse to go from nearly-invisible to fairly large, so the two
 * endpoints are far apart.
 *
 *   logoRestScale = factor applied to the resting (smallest) shadow
 *   logoPeakScale = factor applied to the peak (largest) shadow
 *
 * Set rest to 0.05 (5% of the computed size) to make the aura almost
 * vanish at the trough. Bump peak to 1.5 for a noticeably larger breath.
 */
export const LEAGUE_LOGO_PULSE_REST_SCALE = 0.05;
export const LEAGUE_LOGO_PULSE_PEAK_SCALE = 1.5;

// =====================================================================
// END QUICK-EDIT SECTION
// =====================================================================

/** Labels shown next to each slider on the admin page. */
export const AURA_CHANNELS: { key: AuraChannel; label: string }[] = [
    { key: 'mobilePageTitle', label: 'Titre de page (mobile)' },
    { key: 'mobileMenuIcon', label: 'Icône menu (mobile)' },
    { key: 'leagueLogo', label: 'Logo de la ligue' },
    { key: 'rosterSectionTitle', label: 'Titres de section roster' },
    { key: 'playerCardBackground', label: 'Carte · fond (auras équipe)' },
    { key: 'playerCardName', label: 'Carte · nom + position' },
    { key: 'playerCardLogo', label: 'Carte · logo LNH' },
    { key: 'playerCardPicture', label: 'Carte · photo' },
    { key: 'playerCardText', label: 'Carte · texte (stats + contrats)' },
    { key: 'capBarTrack', label: 'Barre de masse' },
];

export interface AuraLayerRange {
    min: number;
    max: number;
}

export interface AuraChannelRanges {
    layers: AuraLayerRange[];
}

export const AURA_RANGES: Record<AuraChannel, AuraChannelRanges> = {
    mobilePageTitle: {
        layers: [
            { min: 1, max: 3 },
            { min: 4, max: 9 },
            { min: 10, max: 18 },
            { min: 18, max: 32 },
        ],
    },
    mobileMenuIcon: {
        layers: [
            { min: 1, max: 2 },
            { min: 4, max: 7 },
            { min: 7, max: 14 },
            { min: 12, max: 24 },
        ],
    },

    // Halved relative to the previous version (you said the logo was too
    // strong even at 1). The pulse overrides rest/peak further in TopBar.
    leagueLogo: {
        layers: [
            { min: 1, max: 2 },
            { min: 1, max: 5 },
            { min: 2, max: 10 },
            { min: 3, max: 16 },
        ],
    },
    rosterSectionTitle: {
        layers: [
            { min: 1, max: 2 },
            { min: 3, max: 6 },
            { min: 6, max: 12 },
            { min: 10, max: 22 },
        ],
    },

    playerCardBackground: {
        layers: [
            { min: 22, max: 42 },
            { min: 20, max: 40 },
        ],
    },

    // Merged: this slider now drives both the player name and the
    // position label, both in team color. The range is the name's
    // original range, which is large enough to cover the position text
    // too without looking absurd.
    playerCardName: {
        layers: [
            { min: 1, max: 3 },
            { min: 3, max: 6 },
            { min: 5, max: 16 },
        ],
    },
    playerCardLogo: {
        layers: [
            { min: 1, max: 3 },
            { min: 3, max: 6 },
            { min: 5, max: 14 },
        ],
    },
    playerCardPicture: {
        layers: [
            { min: 3, max: 6 },
            { min: 6, max: 14 },
            { min: 10, max: 34 },
            { min: 10, max: 60 },
        ],
    },
    playerCardText: {
        layers: [
            { min: 1, max: 2 },
            { min: 2, max: 5 },
        ],
    },

    // Single aura around the whole cap bar. There is no separate fill
    // channel anymore. The min values are intentionally tiny so slider 1
    // barely glows; the max values are unchanged so slider 10 is
    // untouched.
    capBarTrack: {
        layers: [
            { min: 1, max: 8 },
            { min: 3, max: 22 },
            { min: 6, max: 40 },
        ],
    },
};

export function auraLayerRange(
    channel: AuraChannel,
    layerIndex: number,
): AuraLayerRange {
    const ranges = AURA_RANGES[channel];
    const layer = ranges.layers[layerIndex];

    if (!layer) {
        throw new Error(
            `Aura channel "${channel}" has no layer ${layerIndex}`,
        );
    }

    return layer;
}

export function clampAura(value: number): number {
    return Math.max(0, Math.min(10, Math.floor(value)));
}

export function isAuraOff(intensity: number): boolean {
    return clampAura(intensity) === 0;
}

export function auraProgress(intensity: number): number {
    const level = clampAura(intensity);
    if (level === 0) return 0;
    return (level - 1) / 9;
}

export function auraLerp(intensity: number, min: number, max: number): number {
    return min + (max - min) * auraProgress(intensity);
}

export function auraRange(
    intensity: number,
    min: number,
    max: number,
): number {
    const punchedMax = min + (max - min) * AURA_GLOBAL_PUNCH;
    return auraLerp(intensity, min, punchedMax);
}

export function auraRangeFor(
    intensity: number,
    channel: AuraChannel,
    layerIndex: number,
): number {
    const { min, max } = auraLayerRange(channel, layerIndex);
    return auraRange(intensity, min, max);
}

export function auraAlphaHex(
    intensity: number,
    min: number,
    max: number,
): string {
    const byte = Math.round(auraRange(intensity, min, max));
    const clamped = Math.max(0, Math.min(255, byte));
    return clamped.toString(16).padStart(2, '0').toUpperCase();
}

export type AuraPulseStyle = CSSProperties & {
    '--aura-rest': string;
    '--aura-peak': string;
};

export type AuraPulseKind =
    | 'text'
    | 'filter'
    | 'box';

export function auraPulseClass(kind: AuraPulseKind): string {
    switch (kind) {
        case 'text':
            return 'aura-pulse-text';
        case 'filter':
            return 'aura-pulse-filter';
        case 'box':
            return 'aura-pulse-box';
    }
}

export function auraPulseStyle(
    rest: string,
    peak: string,
): AuraPulseStyle {
    return {
        '--aura-rest': rest,
        '--aura-peak': peak,
    };
}