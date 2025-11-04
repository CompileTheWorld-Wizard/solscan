/**
 * Wallet filter dropdown for transactions tab
 */

import { state } from './state.js';
import * as api from './api.js';
import { fetchTransactions } from './transactionManager.js';

// Cache wallets list
let cachedWallets = [];
let walletsCacheTime = 0;
const CACHE_DURATION = 60000; // 1 minute cache

/**
 * Fetch wallets from transactions table
 */
async function fetchWalletsFromTransactions() {
    const now = Date.now();
    // Use cache if available and not expired
    if (cachedWallets.length > 0 && (now - walletsCacheTime) < CACHE_DURATION) {
        return cachedWallets;
    }
    
    try {
        const result = await api.fetchAllWallets();
        if (result.success && result.wallets) {
            cachedWallets = result.wallets;
            walletsCacheTime = now;
            return cachedWallets;
        }
    } catch (error) {
        console.error('Failed to fetch wallets:', error);
    }
    
    return cachedWallets;
}

/**
 * Update wallet filter dropdown options
 */
export async function updateWalletFilterDropdown() {
    const dropdown = document.getElementById('walletFilterDropdown');
    
    if (!dropdown) return;
    
    // Fetch wallets from transactions table
    const addresses = await fetchWalletsFromTransactions();
    
    // Clear existing options (except "All Wallets")
    const optionsContainer = dropdown.querySelector('div');
    if (optionsContainer) {
        optionsContainer.innerHTML = `
            <div onclick="window.selectWalletFilter('')" style="padding: 8px 12px; cursor: pointer; border-radius: 4px; font-size: 0.85rem;" class="wallet-filter-option" data-value="">
                <strong>All Wallets</strong>
            </div>
        `;
        
        // Add wallet options
        addresses.forEach((addr) => {
            const option = document.createElement('div');
            option.className = 'wallet-filter-option';
            option.setAttribute('data-value', addr);
            option.style.cssText = 'padding: 8px 12px; cursor: pointer; border-radius: 4px; font-size: 0.85rem; font-family: "Courier New", monospace;';
            option.textContent = addr;
            option.onclick = () => selectWalletFilter(addr);
            optionsContainer.appendChild(option);
        });
    }
}

/**
 * Show wallet dropdown
 */
export async function showWalletDropdown() {
    const dropdown = document.getElementById('walletFilterDropdown');
    if (dropdown) {
        await updateWalletFilterDropdown();
        dropdown.style.display = 'block';
    }
}

/**
 * Hide wallet dropdown
 */
export function hideWalletDropdown() {
    const dropdown = document.getElementById('walletFilterDropdown');
    if (dropdown) {
        dropdown.style.display = 'none';
    }
}

/**
 * Filter wallet options based on search input
 */
export async function filterWalletOptions() {
    const searchInput = document.getElementById('walletFilterSearch');
    const dropdown = document.getElementById('walletFilterDropdown');
    if (!searchInput || !dropdown) return;
    
    // Ensure dropdown is populated before filtering
    const options = dropdown.querySelectorAll('.wallet-filter-option');
    if (options.length <= 1) { // Only "All Wallets" option exists
        await updateWalletFilterDropdown();
    }
    
    const searchTerm = searchInput.value.toLowerCase();
    const updatedOptions = dropdown.querySelectorAll('.wallet-filter-option');
    
    updatedOptions.forEach(option => {
        const value = option.getAttribute('data-value') || '';
        const text = option.textContent.toLowerCase();
        
        if (value === '' || text.includes(searchTerm) || value.toLowerCase().includes(searchTerm)) {
            option.style.display = 'block';
        } else {
            option.style.display = 'none';
        }
    });
    
    // Show dropdown if there are visible options
    const visibleOptions = Array.from(updatedOptions).filter(opt => opt.style.display !== 'none');
    if (visibleOptions.length > 0) {
        dropdown.style.display = 'block';
    } else {
        dropdown.style.display = 'none';
    }
}

/**
 * Select wallet filter
 */
export function selectWalletFilter(address) {
    const searchInput = document.getElementById('walletFilterSearch');
    const hiddenInput = document.getElementById('walletFilterSelect');
    const clearBtn = document.getElementById('clearWalletFilterBtn');
    
    if (address === '') {
        // All wallets selected
        state.selectedWalletForTransactions = null;
        if (searchInput) searchInput.value = '';
        if (hiddenInput) hiddenInput.value = '';
        if (clearBtn) clearBtn.style.display = 'none';
    } else {
        // Specific wallet selected
        state.selectedWalletForTransactions = address;
        if (searchInput) searchInput.value = address;
        if (hiddenInput) hiddenInput.value = address;
        if (clearBtn) clearBtn.style.display = 'block';
    }
    
    hideWalletDropdown();
}

/**
 * Clear wallet filter
 */
export function clearWalletFilter() {
    selectWalletFilter('');
}

// Make functions globally available for inline handlers
window.filterWalletOptions = () => filterWalletOptions().catch(console.error);
window.showWalletDropdown = () => showWalletDropdown().catch(console.error);
window.selectWalletFilter = selectWalletFilter;
window.clearWalletFilter = clearWalletFilter;

// Close dropdown when clicking outside (wait for DOM to be ready)
function setupDropdownCloseHandler() {
    document.addEventListener('click', (e) => {
        const searchInput = document.getElementById('walletFilterSearch');
        const dropdown = document.getElementById('walletFilterDropdown');
        
        if (searchInput && dropdown && 
            !searchInput.contains(e.target) && 
            !dropdown.contains(e.target)) {
            hideWalletDropdown();
        }
    });
}

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', setupDropdownCloseHandler);
} else {
    setupDropdownCloseHandler();
}

