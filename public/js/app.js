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
import { analyzeSelectedWallet } from './analysisManager.js';
import { addSkipToken } from './skipTokens.js';
import './walletFilter.js'; // Initialize wallet filter

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
    
    // Check status periodically (only update if something actually changed)
    // Increased interval to 10 seconds to reduce unnecessary checks
    setInterval(fetchStatus, 10000);
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

// Make functions globally available for inline handlers
window.switchTab = switchTab;
window.previousPage = previousPage;
window.nextPage = nextPage;
window.analyzeSelectedWallet = analyzeSelectedWallet;
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

