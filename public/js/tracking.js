/**
 * Tracking control (start/stop)
 */

import { state } from './state.js';
import * as api from './api.js';
import { showNotification } from './utils.js';
import { getAddresses } from './walletManager.js';
import { fetchStatus } from './uiState.js';
import { startAutoRefresh, stopAutoRefresh } from './transactionManager.js';

/**
 * Start tracking
 */
export async function startTracking() {
    const addresses = getAddresses();
    
    if (addresses.length === 0) {
        showNotification('Please enter at least one address', 'error');
        return;
    }

    try {
        const result = await api.startTracking(addresses);

        if (result.success) {
            showNotification(result.data.message, 'success');
            await fetchStatus();
            startAutoRefresh();
        } else {
            throw new Error(result.error || result.data.message);
        }
    } catch (error) {
        showNotification(`Failed to start: ${error.message}`, 'error');
    }
}

/**
 * Stop tracking
 */
export async function stopTracking() {
    try {
        const result = await api.stopTracking();

        if (result.success) {
            showNotification(result.data.message, 'success');
            await fetchStatus();
            stopAutoRefresh();
        } else {
            throw new Error(result.error || result.data.message);
        }
    } catch (error) {
        showNotification(`Failed to stop: ${error.message}`, 'error');
    }
}

