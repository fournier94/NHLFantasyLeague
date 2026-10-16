/**
 * Module-level store for GameDayPage state restoration.
 *
 * WHY THIS EXISTS
 *
 * When a user opens a player page from a GameDay boxscore and then
 * returns to GameDay via the "Fermer" button on the player page or
 * the browser back button, we want GameDayPage to reopen exactly as
 * the user left it: same selected date in the top dropdown, same
 * expanded game, same expanded side (away / home).
 *
 * If instead the user navigates from the player page to some other
 * page (e.g. Classement), the saved GameDay state must NOT be
 * applied when he eventually lands back on GameDay.
 *
 * HOW IT WORKS
 *
 * GameDayPage writes its state into this store whenever any of the
 * three relevant fields change.
 *
 * Layout.tsx clears the store whenever the user lands on a page
 * that is neither GameDay nor a player page.
 *
 * Net behaviour:
 *
 *   GameDay -> Player -> GameDay                : restore applied
 *   GameDay -> Player -> Classement -> GameDay  : cleared on Classement, no restore
 *   GameDay -> Classement -> GameDay            : cleared on Classement, no restore
 *   GameDay -> Player -> Player -> GameDay      : restore applied
 *
 * The store never touches the DB; it is a process-memory variable,
 * lost on hard reload, which matches "the user just navigated away
 * and came back".
 */

export interface GameDaySnapshot {
    /** Selected date in the dropdown, ISO yyyy-MM-dd. */
    selectedDate: string;

    /** Currently expanded game id, or null when nothing is open. */
    expandedGameId: number | null;

    /** Currently expanded side, or null when nothing is open. */
    expandedSide: 'away' | 'home' | null;
}

let savedSnapshot: GameDaySnapshot | null = null;

/**
 * Records the current GameDayPage state. Called by GameDayPage on
 * every change to any of the three snapshot fields.
 */
export function saveGameDaySnapshot(snapshot: GameDaySnapshot): void {
    savedSnapshot = snapshot;
}

/**
 * Returns the saved snapshot WITHOUT clearing it. Used by Layout.tsx
 * to decide whether the current navigation is a restore, and by
 * GameDayPage's restore effect to read the snapshot while still
 * leaving it available to Layout for one more tick.
 *
 * GameDayPage clears it after applying the restore (see the
 * deferred clear inside its restore effect), which is what lets
 * Layout's scroll-to-top effect run afterwards without finding the
 * snapshot still armed.
 */
export function peekGameDaySnapshot(): GameDaySnapshot | null {
    return savedSnapshot;
}

/**
 * Clears the saved snapshot without returning it. Called by
 * Layout.tsx whenever the user lands on a page that is neither
 * GameDay nor a player page, and by GameDayPage after it has
 * applied the restore.
 */
export function clearGameDaySnapshot(): void {
    savedSnapshot = null;
}