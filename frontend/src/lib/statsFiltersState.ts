export interface StatsFiltersState {
    positionFilter: 'all' | 'F' | 'D' | 'G';
    maxAgeStr: string;
    maxSalaryStr: string;
    minContractLength: number;
    useSecondContract: boolean;
    isFiltersOpen: boolean;
    sortKey: string;
    sortDirection: 'asc' | 'desc';
}

const defaultState: StatsFiltersState = {
    positionFilter: 'all',
    maxAgeStr: '',
    maxSalaryStr: '',
    minContractLength: 0,
    useSecondContract: true,
    isFiltersOpen: false,
    sortKey: 'fp',
    sortDirection: 'desc',
};

let currentState: StatsFiltersState = { ...defaultState };

export function getStatsFilters(): StatsFiltersState {
    return currentState;
}

export function setStatsFilters(state: Partial<StatsFiltersState>): void {
    currentState = { ...currentState, ...state };
}

// ---------------------------------------------------------------------
// Main Tab Persistence
//
// Remembers which tab ('players', 'teams', 'injuries') was last active
// on the Statistiques page. This allows the page to restore the correct
// tab when you navigate back to it using the browser's Back button
// (or the 'Retour'/'Fermer' buttons on other pages).
//
// It is explicitly reset to 'players' when you click the Statistiques
// icon in the TopBar (which passes state.resetTab).
// ---------------------------------------------------------------------

export type StatsMainTab = 'players' | 'injuries' | 'teams';

let currentMainTab: StatsMainTab = 'players';

export function getStatsMainTab(): StatsMainTab {
    return currentMainTab;
}

export function setStatsMainTab(tab: StatsMainTab): void {
    currentMainTab = tab;
}