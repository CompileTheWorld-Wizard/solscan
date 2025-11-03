/**
 * UI state management and updates
 */

import { state } from './state.js';
import * as api from './api.js';
import { renderWalletAddressesList, getAddresses } from './walletManager.js';
import { updateAnalysisWalletSelect } from './tabManager.js';

// Cache last known addresses to avoid unnecessary re-renders
let lastKnownRunningState = null;

/**
 * Helper function to compare arrays
 */
function arraysEqual(a, b) {
    if (!a || !b) return false;
    if (a.length !== b.length) return false;
    return a.every((val, index) => val === b[index]);
}

/**
 * Fetch and update status
 */
export async function fetchStatus() {
    try {
        const result = await api.fetchStatus();
        
        if (result.success) {
            state.isRunning = result.data.isRunning;
            await updateUIStatus(result.data.isRunning, result.data.addresses || [], true);
        }
    } catch (error) {
        console.error('Failed to fetch status:', error);
    }
}

/**
 * Update UI status based on running state
 * @param {boolean} running - Whether tracking is running
 * @param {string[]} addresses - List of wallet addresses
 * @param {boolean} fromPeriodicCheck - Whether this update is from periodic status check
 */
export async function updateUIStatus(running, addresses = [], fromPeriodicCheck = false) {
    const statusBadge = document.getElementById('statusBadge');
    const startBtn = document.getElementById('startBtn');
    const stopBtn = document.getElementById('stopBtn');
    const trackedAddressesCount = document.getElementById('trackedAddresses');
    
    // Normalize addresses array
    const normalizedAddresses = addresses || [];

    // Check if running state changed
    const runningStateChanged = lastKnownRunningState !== running;
    
    // Get current addresses from DOM to compare
    const currentAddresses = getAddresses();
    
    // Check if addresses actually changed (only for periodic checks)
    // For periodic checks, compare with DOM state to avoid unnecessary re-renders
    const addressesChanged = fromPeriodicCheck 
        ? !arraysEqual(currentAddresses, normalizedAddresses)
        : true; // Always update if called manually
    
    // Only update UI elements if state changed
    if (runningStateChanged) {
        if (running) {
            statusBadge.className = 'status-badge running';
            statusBadge.textContent = '🟢 Running';
            startBtn.disabled = true;
            stopBtn.disabled = false;
            
            // Disable add button and input when running
            const addBtn = document.getElementById('addAddressBtn');
            const newAddressInput = document.getElementById('newAddressInput');
            if (addBtn) addBtn.disabled = true;
            if (newAddressInput) newAddressInput.disabled = true;
        } else {
            statusBadge.className = 'status-badge stopped';
            statusBadge.textContent = '⚫ Stopped';
            startBtn.disabled = false;
            stopBtn.disabled = true;
            
            // Enable add button and input when stopped
            const addBtn = document.getElementById('addAddressBtn');
            const newAddressInput = document.getElementById('newAddressInput');
            if (addBtn) addBtn.disabled = false;
            if (newAddressInput) newAddressInput.disabled = false;
        }
        lastKnownRunningState = running;
    }

    // For periodic checks when stopped: preserve user-added wallets, don't overwrite with server state
    // Only update wallet list from periodic checks if tracking is running (server state is authoritative)
    if (fromPeriodicCheck && !running) {
        // When stopped, user can add wallets locally that aren't on server yet
        // Don't overwrite local state with server state during periodic checks
        // Just update the count based on DOM state
        const currentAddresses = getAddresses();
        trackedAddressesCount.textContent = currentAddresses.length;
        
        // If stopped and addresses didn't change, just re-enable remove buttons without full re-render
        if (runningStateChanged) {
            const container = document.getElementById('walletAddressesList');
            if (container) {
                container.querySelectorAll('.remove-btn').forEach(btn => {
                    btn.disabled = false;
                });
            }
        }
        return; // Exit early - don't update wallet list during periodic checks when stopped
    }

    // Only update wallet list and filters if addresses actually changed (or not from periodic check)
    if (addressesChanged) {
        // Update tracked addresses count
        trackedAddressesCount.textContent = normalizedAddresses.length;
        
        // Update wallet filters when addresses change
            if (normalizedAddresses.length > 0) {
                if (state.currentTab === 'analysis') {
                    await updateAnalysisWalletSelect(); // Now async - updates with all wallets from transaction history
                }
                // For transactions tab, the wallet selection is handled by clicking the items directly
            }

        // Re-render wallet list
        renderWalletAddressesList(normalizedAddresses);
    } else if (runningStateChanged && !running) {
        // If stopped and addresses didn't change, just re-enable remove buttons without full re-render
        const container = document.getElementById('walletAddressesList');
        if (container) {
            container.querySelectorAll('.remove-btn').forEach(btn => {
                btn.disabled = false;
            });
        }
    }
    
    // Always update count (it's cheap and doesn't cause re-renders)
    trackedAddressesCount.textContent = normalizedAddresses.length;
}

