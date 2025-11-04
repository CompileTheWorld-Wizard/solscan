/**
 * API service for making HTTP requests
 */

/**
 * Fetch application status
 */
export async function fetchStatus() {
    try {
        const response = await fetch('/api/status', {
            credentials: 'include'
        });
        const data = await response.json();
        return { success: true, data };
    } catch (error) {
        console.error('Failed to fetch status:', error);
        return { success: false, error };
    }
}

/**
 * Start tracking
 */
export async function startTracking(addresses) {
    try {
        // Set addresses first
        const setResponse = await fetch('/api/addresses', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            credentials: 'include',
            body: JSON.stringify({ addresses })
        });

        if (!setResponse.ok) {
            const error = await setResponse.json();
            throw new Error(error.error);
        }

        // Start tracking
        const startResponse = await fetch('/api/start', {
            method: 'POST',
            credentials: 'include'
        });

        const result = await startResponse.json();
        return { success: startResponse.ok, data: result };
    } catch (error) {
        return { success: false, error: error.message };
    }
}

/**
 * Stop tracking
 */
export async function stopTracking() {
    try {
        const response = await fetch('/api/stop', {
            method: 'POST',
            credentials: 'include'
        });

        const result = await response.json();
        return { success: response.ok, data: result };
    } catch (error) {
        return { success: false, error: error.message };
    }
}

/**
 * Fetch transactions
 */
export async function fetchTransactions(page, pageSize, selectedWallets = []) {
    try {
        const offset = (page - 1) * pageSize;
        let queryString = `limit=${pageSize}&offset=${offset}`;
        
        // Add wallet filter if a wallet is selected
        if (selectedWallets && selectedWallets.length > 0) {
            queryString += `&wallets=${selectedWallets.join(',')}`;
        }
        
        const response = await fetch(`/api/transactions?${queryString}`, {
            credentials: 'include'
        });
        const data = await response.json();
        return { success: true, data };
    } catch (error) {
        console.error('Failed to fetch transactions:', error);
        return { success: false, error: error.message };
    }
}

/**
 * Analyze wallet
 */
export async function analyzeWallet(walletAddress) {
    try {
        const response = await fetch(`/api/analyze/${walletAddress}`, {
            credentials: 'include'
        });
        
        if (!response.ok) {
            throw new Error('Failed to analyze wallet');
        }
        
        const data = await response.json();
        return { success: true, data };
    } catch (error) {
        return { success: false, error: error.message };
    }
}

/**
 * Fetch skip tokens
 */
export async function fetchSkipTokens() {
    try {
        const response = await fetch('/api/skip-tokens', {
            credentials: 'include'
        });
        const data = await response.json();
        return { success: data.success, data: data.skipTokens };
    } catch (error) {
        console.error('Failed to fetch skip tokens:', error);
        return { success: false, error: error.message };
    }
}

/**
 * Add skip token
 */
export async function addSkipToken(mintAddress, symbol) {
    try {
        const response = await fetch('/api/skip-tokens', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            credentials: 'include',
            body: JSON.stringify({
                mint_address: mintAddress,
                symbol: symbol || null,
                description: null
            })
        });
        
        const data = await response.json();
        return { success: data.success, data, error: data.error };
    } catch (error) {
        return { success: false, error: error.message };
    }
}

/**
 * Fetch all unique wallets from transactions
 */
export async function fetchAllWallets() {
    try {
        const response = await fetch('/api/wallets', {
            credentials: 'include'
        });
        const data = await response.json();
        return { success: data.success, wallets: data.wallets || [] };
    } catch (error) {
        console.error('Failed to fetch wallets:', error);
        return { success: false, error: error.message, wallets: [] };
    }
}

/**
 * Remove skip token
 */
export async function removeSkipToken(mintAddress) {
    try {
        const response = await fetch(`/api/skip-tokens/${encodeURIComponent(mintAddress)}`, {
            method: 'DELETE',
            credentials: 'include'
        });
        
        const data = await response.json();
        return { success: data.success, error: data.error };
    } catch (error) {
        return { success: false, error: error.message };
    }
}

