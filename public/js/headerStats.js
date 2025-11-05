/**
 * Header Stats Management
 * Updates the compact stats display in the header
 */

import { state } from './state.js';
import { getAddresses } from './walletManager.js';

/**
 * Update header stats display
 */
export function updateHeaderStats() {
    const statsCompact = document.getElementById('statsCompact');
    const headerTotalTransactions = document.getElementById('headerTotalTransactions');
    const headerTrackedAddresses = document.getElementById('headerTrackedAddresses');
    
    if (!statsCompact || !headerTotalTransactions || !headerTrackedAddresses) {
        return;
    }
    
    // Get tracked addresses count from wallet list
    const addresses = getAddresses();
    const trackedAddressesCount = addresses.length;
    
    // Get total transactions from state
    const totalTransactions = state.totalTransactions || 0;
    
    // Update compact display (format: "1005 / 0")
    statsCompact.textContent = `${totalTransactions} / ${trackedAddressesCount}`;
    
    // Update expanded display
    headerTotalTransactions.textContent = totalTransactions.toLocaleString();
    headerTrackedAddresses.textContent = trackedAddressesCount.toLocaleString();
}

// Make function available globally
window.updateHeaderStats = updateHeaderStats;

