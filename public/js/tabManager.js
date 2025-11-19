/**
 * Tab and wallet filter management
 */

import { state } from './state.js';
import { getAddresses } from './walletManager.js';
import { fetchTransactions } from './transactionManager.js';
import { analyzeSelectedWallet } from './analysisManager.js';
import * as api from './api.js';

/**
 * Switch tabs
 */
export async function switchTab(tabName) {
    state.currentTab = tabName;
    
    // Update tab buttons
    document.querySelectorAll('.tab-btn').forEach(btn => {
        btn.classList.remove('active');
        if (btn.dataset.tab === tabName) {
            btn.classList.add('active');
        }
    });
    
    // Update tab content
    document.querySelectorAll('.tab-content').forEach(content => {
        content.classList.remove('active');
    });
    
    if (tabName === 'transactions') {
        document.getElementById('transactionsTab').classList.add('active');
        // Re-render wallet list to update selection state
        const { getAddresses, renderWalletAddressesList } = await import('./walletManager.js');
        renderWalletAddressesList(getAddresses());
        // Update wallet filter dropdown
        const { updateWalletFilterDropdown } = await import('./walletFilter.js');
        updateWalletFilterDropdown();
    } else if (tabName === 'analysis') {
        document.getElementById('analysisTab').classList.add('active');
        await updateAnalysisWalletSelect(); // Now async - fetches all wallets from transaction history
        // Re-render wallet list to update selection state
        const { getAddresses, renderWalletAddressesList } = await import('./walletManager.js');
        renderWalletAddressesList(getAddresses());
    } else if (tabName === 'dashboard') {
        document.getElementById('dashboardTab').classList.add('active');
        // Initialize dashboard wallets if not already done
        const { initializeDashboard } = await import('./dashboardManager.js');
        await initializeDashboard();
        // Restore wallet selection from state if it exists
        if (state.selectedWalletForDashboard) {
            const select = document.getElementById('dashboardWalletSelect');
            if (select) {
                select.value = state.selectedWalletForDashboard;
                // Load dashboard data for the selected wallet
                const { loadDashboardData } = await import('./dashboardManager.js');
                loadDashboardData();
            }
        }
    }
}

// Cache wallets list for analysis dropdown
let cachedAnalysisWallets = [];
let analysisWalletsCacheTime = 0;
const ANALYSIS_CACHE_DURATION = 60000; // 1 minute cache

/**
 * Fetch wallets from transactions table for analysis dropdown
 */
async function fetchWalletsForAnalysis() {
    const now = Date.now();
    // Use cache if available and not expired
    if (cachedAnalysisWallets.length > 0 && (now - analysisWalletsCacheTime) < ANALYSIS_CACHE_DURATION) {
        return cachedAnalysisWallets;
    }
    
    try {
        const result = await api.fetchAllWallets();
        if (result.success && result.wallets) {
            cachedAnalysisWallets = result.wallets;
            analysisWalletsCacheTime = now;
            return cachedAnalysisWallets;
        }
    } catch (error) {
        console.error('Failed to fetch wallets for analysis:', error);
    }
    
    return cachedAnalysisWallets;
}

/**
 * Update analysis wallet select dropdown
 */
export async function updateAnalysisWalletSelect() {
    const select = document.getElementById('walletSelectTab');
    if (!select) return;
    
    // Fetch all wallets from transaction history
    const addresses = await fetchWalletsForAnalysis();
    
    // Clear existing options (except the default)
    select.innerHTML = '<option value="">-- Select a wallet --</option>';
    
    // Add wallet options
    addresses.forEach((addr) => {
        const option = document.createElement('option');
        option.value = addr;
        option.textContent = addr; // Show full address
        if (state.selectedWalletForAnalysis === addr) {
            option.selected = true;
        }
        select.appendChild(option);
    });
}

/**
 * Update transaction wallet filter (no longer used, but kept for compatibility)
 */
export async function updateTransactionWalletFilter() {
    // This function is no longer needed since selection is handled by toggleWalletSelection
    // But kept for compatibility in case of any remaining references
    const { renderWalletAddressesList, getAddresses } = await import('./walletManager.js');
    renderWalletAddressesList(getAddresses());
}

/**
 * Update analysis wallet filter
 */
export async function updateAnalysisWalletFilter() {
    const select = document.getElementById('walletSelectTab');
    const previousWallet = state.selectedWalletForAnalysis;
    state.selectedWalletForAnalysis = select ? select.value : null;
    
    // Reset pagination to page 1 when wallet changes
    if (previousWallet !== state.selectedWalletForAnalysis) {
        state.analysisPage = 1;
    }
    
    // Update wallet list to reflect selection
    const { renderWalletAddressesList, getAddresses } = await import('./walletManager.js');
    renderWalletAddressesList(getAddresses());
    
    // Automatically trigger analysis when wallet is selected
    if (state.selectedWalletForAnalysis) {
        analyzeSelectedWallet();
    } else {
        // Clear the analysis if no wallet is selected
        document.getElementById('walletInfoContainer').innerHTML = '';
    }
}

/**
 * Update wallet filter based on current active tab (deprecated, kept for compatibility)
 */
export async function updateWalletFilterForCurrentTab() {
    // This function is no longer needed since selection is handled directly
    // But kept for compatibility
    const { renderWalletAddressesList, getAddresses } = await import('./walletManager.js');
    renderWalletAddressesList(getAddresses());
    
    if (state.currentTab === 'analysis') {
        await updateAnalysisWalletSelect();
    }
}

/**
 * Refresh analysis for currently selected wallet
 */
export async function refreshAnalysis() {
    const select = document.getElementById('walletSelectTab');
    const walletAddress = select ? select.value : state.selectedWalletForAnalysis;
    
    if (!walletAddress) {
        // Show notification if no wallet is selected
        const { showNotification } = await import('./utils.js');
        showNotification('Please select a wallet first', 'error');
        return;
    }
    
    // Trigger analysis
    await analyzeSelectedWallet();
}

/**
 * Remove wallet and all its transactions from database
 */
export async function removeWalletFromAnalysis() {
    // Try dashboard wallet select first, then fall back to analysis select for backward compatibility
    const dashboardSelect = document.getElementById('dashboardWalletSelect');
    const analysisSelect = document.getElementById('walletSelectTab');
    const select = dashboardSelect || analysisSelect;
    const walletAddress = select ? select.value : state.selectedWalletForAnalysis;
    
    if (!walletAddress) {
        // Show notification if no wallet is selected
        const { showNotification } = await import('./utils.js');
        showNotification('Please select a wallet first', 'error');
        return;
    }
    
    // Show confirmation dialog
    const confirmMessage = `Are you sure you want to remove this wallet and all its transactions from the database?\n\nWallet: ${walletAddress}\n\nThis action cannot be undone.`;
    if (!confirm(confirmMessage)) {
        return;
    }
    
    try {
        const { showNotification } = await import('./utils.js');
        const result = await api.deleteWalletAndTransactions(walletAddress);
        
        if (result.success) {
            const message = `✅ Wallet removed successfully (${result.transactionsDeleted || 0} transactions, ${result.walletsDeleted || 0} wallet entries deleted)`;
            showNotification(message, 'success');
            
            // Clear selection
            state.selectedWalletForAnalysis = null;
            state.selectedWalletForDashboard = null;
            if (dashboardSelect) {
                dashboardSelect.value = '';
            }
            if (analysisSelect) {
                analysisSelect.value = '';
            }
            
            // Clear analysis display if it exists
            const walletInfoContainer = document.getElementById('walletInfoContainer');
            if (walletInfoContainer) {
                walletInfoContainer.innerHTML = '';
            }
            
            // Refresh wallet dropdowns (clear cache and refetch)
            cachedAnalysisWallets = [];
            analysisWalletsCacheTime = 0;
            if (analysisSelect) {
                await updateAnalysisWalletSelect();
            }
            
            // Refresh dashboard wallet select and clear dashboard data if active
            if (dashboardSelect) {
                const { initializeDashboard, clearDashboardData } = await import('./dashboardManager.js');
                await initializeDashboard();
                
                // Clear dashboard data if dashboard tab is active
                if (state.currentTab === 'dashboard') {
                    clearDashboardData();
                }
            }
            
            // Always refresh transactions list regardless of active tab
            // This ensures the list is updated when user switches to transactions tab
            const { fetchTransactions } = await import('./transactionManager.js');
            await fetchTransactions();
        } else {
            showNotification('❌ ' + (result.error || 'Failed to remove wallet'), 'error');
        }
    } catch (error) {
        console.error('Failed to remove wallet:', error);
        const { showNotification } = await import('./utils.js');
        showNotification('❌ Error removing wallet', 'error');
    }
}

// Make functions globally available for inline handlers
window.updateTransactionWalletFilter = updateTransactionWalletFilter;
window.updateAnalysisWalletFilter = updateAnalysisWalletFilter;
window.refreshAnalysis = refreshAnalysis;
window.removeWalletFromAnalysis = removeWalletFromAnalysis;

