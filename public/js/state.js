/**
 * Application state management
 */

export const state = {
    currentPage: 1,
    pageSize: 50,
    totalTransactions: 0,
    analysisPage: 1,
    analysisPageSize: 50,
    totalAnalysisTrades: 0,
    isRunning: false,
    autoRefreshInterval: null,
    currentTab: 'transactions',
    selectedWalletForTransactions: null, // For transactions tab (single wallet filter)
    selectedWalletForAnalysis: null, // For analysis tab (single)
    selectedWalletForDashboard: null // For dashboard tab (single)
};

