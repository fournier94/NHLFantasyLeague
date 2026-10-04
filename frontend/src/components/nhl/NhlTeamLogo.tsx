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
 * Sizing: width/height are set as inline styles, not just HTML
 * attributes. Tailwind v4's preflight applies `height: auto` and
 * `max-width: 100%` to every <img>, which silently overrides the
 * width/height attributes and lets the logo shrink to whatever the
 * parent's flex algorithm decides. Inline styles have higher
 * specificity than the preflight rule, so the size is enforced.
 * minWidth/minHeight + flexShrink: 0 prevent the flex parent from
 * squeezing the image below its intended size.
 *
 * Wrapped in React.memo so an unchanged (abbreviation, size) pair
 * short-circuits the render entirely. This matters because the
 * component is used inside every lineup row and every player card.
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
            loading='lazy'
            decoding='async'
            style={{
                display: 'block',
                width: size,
                height: size,
                minWidth: size,
                minHeight: size,
                flexShrink: 0,
                objectFit: 'contain',
            }}
        />
    );
});