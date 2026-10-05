import { memo } from 'react';

interface NhlTeamLogoProps {
    abbreviation: string;
    size?: number;
    /**
     * When true, the logo fills the height of its (flexible) container
     * and preserves a 1:1 aspect ratio. The container must have a
     * definite height for this to work — usually via `self-stretch`
     * on the parent grid cell or an explicit height.
     *
     * In this mode the `size` prop is ignored.
     */
    fillHeight?: boolean;
}

/**
 * NHL team logo, loaded as an SVG directly from the NHL's public
 * CDN.
 *
 * The URL format is stable and used by nhl.com itself:
 *   https://assets.nhle.com/logos/nhl/svg/{TEAM}_light.svg
 *
 * Sizing:
 *   - Default mode: fixed square, `size` pixels per side. Inline
 *     styles are used instead of HTML width/height attributes so
 *     Tailwind v4's preflight rules cannot shrink the image.
 *   - `fillHeight` mode: the logo takes 100% of its container's
 *     height, keeps a square aspect ratio, and grows/shrinks with
 *     the row. Used in the lineup tables where the logo should be
 *     as big as the row allows.
 *
 * Wrapped in React.memo so an unchanged (abbreviation, size,
 * fillHeight) triple short-circuits the render entirely.
 */
export const NhlTeamLogo = memo(function NhlTeamLogo({
    abbreviation,
    size = 32,
    fillHeight = false,
}: NhlTeamLogoProps) {
    const abbr = abbreviation?.toUpperCase();

    if (!abbr) {
        return null;
    }

    const style: React.CSSProperties = fillHeight
        ? {
            display: 'block',
            height: '100%',
            width: 'auto',
            aspectRatio: '1 / 1',
            maxHeight: '100%',
            flexShrink: 0,
            objectFit: 'contain',
        }
        : {
            display: 'block',
            width: size,
            height: size,
            minWidth: size,
            minHeight: size,
            flexShrink: 0,
            objectFit: 'contain',
        };

    return (
        <img
            src={`https://assets.nhle.com/logos/nhl/svg/${abbr}_light.svg`}
            alt={abbr}
            loading='lazy'
            decoding='async'
            style={style}
        />
    );
});