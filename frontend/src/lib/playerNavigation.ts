/**
 * Tiny module-level store that remembers the last non-player location
 * the user was on, so PlayerPage's "Fermer" button can jump past every
 * player page in the chain and land back on it.
 *
 * The problem it solves: if the user goes
 *   Mon équipe -> Player A -> (search) -> Player B -> (search) -> Player C
 * then clicking Fermer on Player C should NOT go back to Player B, nor
 * to Player A. It should go straight back to Mon équipe, with the same
 * scroll position the user had when they first clicked Player A.
 *
 * Like scrollRestoration.ts, this is a plain module variable:
 *   - there is only ever one "last non-player location" at a time;
 *   - it does not need to trigger a re-render;
 *   - it must outlive the PlayerPage component that set it.
 *
 * Nothing is persisted across reloads; that is deliberate. If the tab
 * is discarded or reloaded, PlayerPage falls back to /mon-equipe.
 *
 * The stored value is the full react-router location descriptor
 * (pathname + search + hash) so we can restore e.g. /mon-equipe?teamId=5.
 */

export interface NonPlayerLocation {
    pathname: string;
    search: string;
    hash: string;
}

let lastNonPlayerLocation: NonPlayerLocation | null = null;

/**
 * True when the given pathname belongs to a PlayerPage route.
 * Kept here so PlayerPage and any future consumer agree on one rule.
 */
export function isPlayerPath(pathname: string): boolean {
    return /^\/joueurs\/[^/]+$/.test(pathname);
}

/**
 * Records the last non-player location. Called by PlayerPage on mount
 * when it detects it was navigated to from a non-player page. Player ->
 * player transitions must NOT call this, otherwise the stored location
 * would creep forward one player page at a time.
 */
export function setLastNonPlayerLocation(location: NonPlayerLocation): void {
    lastNonPlayerLocation = location;
}

/**
 * Returns the stored non-player location, or null when there is none
 * (direct URL entry, hard reload on a player page, ...). Does NOT clear
 * it: the user may open another player page from Mon équipe later and
 * we still want Fermer to send them there again.
 */
export function getLastNonPlayerLocation(): NonPlayerLocation | null {
    return lastNonPlayerLocation;
}