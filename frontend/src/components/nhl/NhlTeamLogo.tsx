import { memo } from 'react';

interface NhlTeamLogoProps {
    abbreviation: string;
    size?: number;
}

/**
 * NHL team logo, loaded as an SVG directly from the NHL's public
 * CDN. Replaces the previous `react-nhl-logos` library, which
 * shipped all 32 logos inline and cost ~100 KB in the JS bundle.
 *
 * The URL format is stable and used by nhl.com itself:
 *   https://assets.nhle.com/logos/nhl/svg/{TEAM}_light.svg
 *
 * The browser fetches each logo on demand (only the teams that
 * actually appear on screen), then caches them indefinitely.
 *
 * Wrapped in React.memo: an unchanged (abbreviation, size) pair
 * short-circuits the render entirely. This matters a lot because
 * NhlTeamLogo is rendered inside nearly every lineup row and every
 * player card, so on a full Mon équipe page there are 30+ instances
 * of it. Without memo, opening the team picker (or any other
 * unrelated parent re-render) would schedule 30+ brand-new <img>
 * elements. With memo, React reuses the previous subtree.
 */
export const NhlTeamLogo = memo(function NhlTeamLogo({
    abbreviation,
    size = 32,
}: NhlTeamLogoProps) {
    const abbr = abbreviation?.toUpperCase();

    if (!abbr) {
        return null;
    }

    return (
        <img
            src={`https://assets.nhle.com/logos/nhl/svg/${abbr}_light.svg`}
            alt={abbr}
            width={size}
            height={size}
            loading='lazy'
            decoding='async'
            style={{
                display: 'block',
                objectFit: 'contain',
            }}
        />
    );
});