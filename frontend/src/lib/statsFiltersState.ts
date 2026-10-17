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