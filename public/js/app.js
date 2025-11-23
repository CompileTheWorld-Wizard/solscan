/**
 * Main application initialization
 */

import { isAuthenticated, logout } from './auth.js';
import { state } from './state.js';
import { fetchStatus } from './uiState.js';
import { fetchTransactions } from './transactionManager.js';
import { fetchSkipTokens } from './skipTokens.js';
import { addWalletAddress } from './walletManager.js';
import { removeWalletAddress } from './walletManager.js';
import { toggleWalletSelection } from './walletManager.js';
import { startTracking, stopTracking } from './tracking.js';
import { previousPage, nextPage } from './transactionManager.js';
import { switchTab, refreshAnalysis } from './tabManager.js';
import { analyzeSelectedWallet, analysisPreviousPage, analysisNextPage } from './analysisManager.js';
import { addSkipToken } from './skipTokens.js';
import { fetchSolPrice } from './api.js';
import './walletFilter.js'; // Initialize wallet filter
import './headerStats.js'; // Initialize header stats
import { initializeDashboard } from './dashboardManager.js';

/**
 * Initialize the application
 */
export function init() {
    
    // Add Enter key support for new address input
    const newAddressInput = document.getElementById('newAddressInput');
    if (newAddressInput) {
        newAddressInput.addEventListener('keypress', (e) => {
            if (e.key === 'Enter') {
                addWalletAddress();
            }
        });
    }
    
    // Event listeners
    document.getElementById('startBtn').addEventListener('click', startTracking);
    document.getElementById('stopBtn').addEventListener('click', stopTracking);
    document.getElementById('refreshBtn').addEventListener('click', fetchTransactions);
    
    // Initialize data
    fetchStatus();
    fetchTransactions();
    fetchSkipTokens();
    
    // Initialize header stats
    if (window.updateHeaderStats) {
        window.updateHeaderStats();
    }
    
    // Initialize dashboard
    initializeDashboard();
    
    // Initialize SOL price display
    updateSolPrice();
    
    // Check status periodically (only update if something actually changed)
    // Increased interval to 10 seconds to reduce unnecessary checks
    setInterval(fetchStatus, 10000);
    
    // Update SOL price every 7 seconds (5-10 second range)
    setInterval(updateSolPrice, 7000);
}

/**
 * Update SOL price display
 */
async function updateSolPrice() {
    try {
        const result = await fetchSolPrice();
        const priceElement = document.getElementById('solPriceValue');
        
        if (result.success && priceElement && result.price !== null && result.price !== undefined) {
            const price = parseFloat(result.price);
            if (!isNaN(price)) {
                // Format price with 2 decimal places
                priceElement.textContent = price.toFixed(2);
                priceElement.style.color = '#10b981'; // Green color
            } else {
                priceElement.textContent = '--';
                priceElement.style.color = '#94a3b8';
            }
        } else {
            if (priceElement) {
                priceElement.textContent = '--';
                priceElement.style.color = '#94a3b8';
            }
        }
    } catch (error) {
        console.error('Failed to update SOL price:', error);
        const priceElement = document.getElementById('solPriceValue');
        if (priceElement) {
            priceElement.textContent = '--';
            priceElement.style.color = '#94a3b8';
        }
    }
}

// Copy address to clipboard function
window.copyAddressToClipboard = async function(text) {
    try {
        await navigator.clipboard.writeText(text);
        const { showNotification } = await import('./utils.js');
        showNotification('Copied to clipboard!', 'success');
    } catch (err) {
        // Fallback for older browsers
        const textArea = document.createElement('textarea');
        textArea.value = text;
        textArea.style.position = 'fixed';
        textArea.style.left = '-999999px';
        document.body.appendChild(textArea);
        textArea.select();
        try {
            document.execCommand('copy');
            const { showNotification } = await import('./utils.js');
            showNotification('Copied to clipboard!', 'success');
        } catch (err) {
            const { showNotification } = await import('./utils.js');
            showNotification('Failed to copy', 'error');
        }
        document.body.removeChild(textArea);
    }
};

// Toggle skip tokens panel
window.toggleSkipTokensPanel = function() {
    const content = document.getElementById('skipTokensContent');
    const icon = document.getElementById('skipTokensToggleIcon');
    
    if (content && icon) {
        content.classList.toggle('collapsed');
        icon.classList.toggle('rotated');
    }
};

// Open Solscan link from wallet selector
window.openSolscanFromSelect = async function() {
    const select = document.getElementById('walletSelectTab');
    const walletAddress = select ? select.value : null;
    
    if (!walletAddress) {
        const { showNotification } = await import('./utils.js');
        showNotification('Please select a wallet first', 'error');
        return;
    }
    
    const solscanUrl = `https://solscan.io/account/${walletAddress}`;
    window.open(solscanUrl, '_blank', 'noopener,noreferrer');
};

// Make functions globally available for inline handlers
window.switchTab = switchTab;
window.previousPage = previousPage;
window.nextPage = nextPage;
window.analyzeSelectedWallet = analyzeSelectedWallet;
window.analysisPreviousPage = analysisPreviousPage;
window.analysisNextPage = analysisNextPage;
window.addWalletAddress = addWalletAddress;
window.removeWalletAddress = removeWalletAddress;
window.toggleWalletSelection = toggleWalletSelection;
window.addSkipToken = addSkipToken;
window.refreshAnalysis = refreshAnalysis;

// Initialize when DOM is ready
// Server handles authentication and redirects - no need to check here
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => {
        init();
    });
} else {
    // DOM already loaded, initialize immediately
    init();
}

// Make logout available globally
window.logout = logout;

