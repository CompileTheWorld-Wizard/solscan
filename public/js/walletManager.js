/**
 * Wallet address management
 */

import { state } from './state.js';
import { showNotification } from './utils.js';
import { updateWalletFilterForCurrentTab, updateAnalysisWalletSelect } from './tabManager.js';

/**
 * Get addresses from the wallet list
 */
export function getAddresses() {
    const addresses = [];
    const listItems = document.querySelectorAll('.wallet-address-item');
    listItems.forEach(item => {
        const address = item.dataset.address;
        if (address) {
            addresses.push(address);
        }
    });
    return addresses;
}

/**
 * Add wallet address
 */
export function addWalletAddress() {
    const input = document.getElementById('newAddressInput');
    const address = input.value.trim();
    
    if (!address) {
        showNotification('Please enter a wallet address', 'error');
        return;
    }
    
    // Validate Solana address format (basic check - 32-44 characters, base58)
    if (address.length < 32 || address.length > 44) {
        showNotification('Invalid Solana address format', 'error');
        return;
    }
    
    // Check if already exists
    const existingAddresses = getAddresses();
    if (existingAddresses.includes(address)) {
        showNotification('This wallet address is already added', 'error');
        return;
    }
    
    // Check max limit
    if (existingAddresses.length >= 5) {
        showNotification('Maximum 5 wallet addresses allowed', 'error');
        return;
    }
    
    // Add to list
    const newAddresses = [...existingAddresses, address];
    renderWalletAddressesList(newAddresses);
    
    // Clear input
    input.value = '';
    input.focus();
    
    // Update wallet filter dropdown if on transactions tab
    if (state.currentTab === 'transactions') {
        import('./walletFilter.js').then(({ updateWalletFilterDropdown }) => {
            updateWalletFilterDropdown();
        });
    }
}

/**
 * Remove wallet address
 */
export function removeWalletAddress(address) {
    const addresses = getAddresses();
    const filtered = addresses.filter(addr => addr !== address);
    renderWalletAddressesList(filtered);
    
    // Update wallet filter immediately
    updateWalletFilterForCurrentTab();
    
    // If removed wallet was selected for transactions, clear selection
    if (state.currentTab === 'transactions') {
        if (state.selectedWalletForTransactions === address) {
            state.selectedWalletForTransactions = null;
            const searchInput = document.getElementById('walletFilterSearch');
            const hiddenInput = document.getElementById('walletFilterSelect');
            if (searchInput) searchInput.value = '';
            if (hiddenInput) hiddenInput.value = '';
            import('./walletFilter.js').then(({ updateWalletFilterDropdown }) => {
                updateWalletFilterDropdown();
            });
        }
    } else if (state.currentTab === 'analysis') {
        // If removed wallet was selected for analysis, clear selection
        if (state.selectedWalletForAnalysis === address) {
            state.selectedWalletForAnalysis = null;
            const select = document.getElementById('walletSelectTab');
            if (select) {
                select.value = '';
            }
            document.getElementById('walletInfoContainer').innerHTML = '';
        }
        updateAnalysisWalletSelect();
    }
}

/**
 * Toggle wallet selection (removed - no longer selecting from tracking addresses)
 * This function is kept for compatibility but does nothing
 */
export async function toggleWalletSelection(address) {
    // Selection logic removed - wallet items in tracking addresses are not selectable
}

/**
 * Render wallet addresses list
 */
export function renderWalletAddressesList(addresses) {
    const container = document.getElementById('walletAddressesList');
    const isRunning = document.getElementById('statusBadge').classList.contains('running');
    
    if (addresses.length === 0) {
        container.innerHTML = '';
        return;
    }
    
    container.innerHTML = addresses.map((addr, index) => {
        // No selection logic - wallet items are just display items with remove button
        return `
        <div class="wallet-address-item" 
             data-address="${addr.replace(/"/g, '&quot;')}"
             style="cursor: default;">
            <span class="address-text">${addr}</span>
            <button class="remove-btn" 
                    data-remove-address="${addr.replace(/"/g, '&quot;')}" 
                    ${isRunning ? 'disabled' : ''}
                    onclick="event.stopPropagation(); window.removeWalletAddress('${addr.replace(/'/g, "\\'")}')"
                    title="Remove">
                🗑️
            </button>
        </div>
    `;
    }).join('');
}

