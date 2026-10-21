/**
 * Tiny module-level store that remembers the "anchor" page for the
 * current player exploration session.
 */
export interface NonPlayerLocation {
    pathname: string;
    search: string;
    hash: string;
    idx?: number; // The React Router history index of this page
}

let lastNonPlayerLocation: NonPlayerLocation | null = null;

export function isPlayerPath(pathname: string): boolean {
    return /^\/joueurs\/[^/]+$/.test(pathname);
}

export function setLastNonPlayerLocation(location: NonPlayerLocation): void {
    lastNonPlayerLocation = location;
}

export function getLastNonPlayerLocation(): NonPlayerLocation | null {
    return lastNonPlayerLocation;
}