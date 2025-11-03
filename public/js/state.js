/**
 * Application state management
 */

export const state = {
    currentPage: 1,
    pageSize: 50,
    totalTransactions: 0,
    isRunning: false,
    autoRefreshInterval: null,
    currentTab: 'transactions',
    selectedWalletForTransactions: null, // For transactions tab (single wallet filter)
    selectedWalletForAnalysis: null // For analysis tab (single)
};

