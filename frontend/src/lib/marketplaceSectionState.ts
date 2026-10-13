/**
 * Module-level store that remembers which section of the
 * Marketplace the user was on, so navigating away (to a PlayerPage
 * via a player name click, typically) and coming back lands on the
 * same tab.
 *
 * The section is `view` (add / browse / received / sent) and, when
 * the user is on browse, `browseSubView` (view / mine / publish).
 * These are the only two pieces of state that are NOT already
 * encoded in the URL — the route is always /marketplace, so
 * remounting the page starts from the initial useState value
 * without this store.
 *
 * Not consumed on read. The value persists for the tab's lifetime,
 * which matches the intuition "the app remembers my last tab".
 * Cleared only by a full page reload, same convention as every
 * other module-level store in the app (scrollRestoration,
 * playerNavigation, marketplacePopupRestoration, directOfferState,
 * marketplaceTradeState, marketplacePicksState).
 */

export type MarketplaceView = 'add' | 'browse' | 'received' | 'sent';

export type MarketplaceBrowseSubView = 'view' | 'mine' | 'publish';

export interface MarketplaceSection {
    view: MarketplaceView;
    browseSubView: MarketplaceBrowseSubView;
}

const DEFAULT_SECTION: MarketplaceSection = {
    view: 'browse',
    browseSubView: 'view',
};

let currentSection: MarketplaceSection = DEFAULT_SECTION;

/**
 * Records the current section. Called by MarketplacePage whenever
 * `view` or `browseSubView` changes.
 *
 * No-ops when the section has not changed, so a re-render that does
 * not actually change the tab does not touch the store.
 */
export function setMarketplaceSection(section: MarketplaceSection): void {
    if (
        currentSection.view === section.view &&
        currentSection.browseSubView === section.browseSubView
    ) {
        return;
    }

    currentSection = section;
}

/**
 * Returns the last recorded section, or the default (browse / view)
 * when nothing has been recorded yet (first visit in this tab).
 */
export function getMarketplaceSection(): MarketplaceSection {
    return currentSection;
}