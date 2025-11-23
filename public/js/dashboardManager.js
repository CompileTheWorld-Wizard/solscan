/**
 * Dashboard Manager
 * Handles dashboard data loading and table rendering
 */

import * as api from './api.js';

let dashboardData = [];
let filteredData = [];
let maxSells = 0;
let totalBuys = 0;
let totalSells = 0;
let averageOpenPosition = 0;

// Pagination state
let currentPage = 1;
let itemsPerPage = 50;
let totalCount = 0; // Total count from backend (all items, not filtered)
let totalPages = 1; // Total pages from backend

// Sorting state
let sortColumn = null;
let sortDirection = 'asc'; // 'asc' or 'desc'
let sortSellIndex = null; // For sell columns: which sell index (0-based) to sort by

// Selected row state
let selectedRowElement = null;

// Dynamic filters - array of filter objects
let activeFilters = [];

// Column visibility state - map of column key to visibility (default: all visible)
let columnVisibility = {};
let sellColumnVisibility = {}; // For sell columns: { 'sellNumber': true, 'sellMarketCap': true, ... }

// What-if mode state
let whatIfModeEnabled = false;
let whatIfData = []; // Store what-if calculation results
let whatIfParams = { firstSellTimeAdjustment: null, setAllSellsTo: null };

// Column definitions with keys and groups
const COLUMN_DEFINITIONS = [
    // PNL Group
    { key: 'pnlSOL', label: 'PNL per token in SOL', order: 0, group: 'PNL' },
    { key: 'pnlPercent', label: '% PNL per token', order: 1, group: 'PNL' },
    
    // Token Info Group
    { key: 'tokenName', label: 'Token Name', order: 2, group: 'Token Info' },
    { key: 'tokenSymbol', label: 'Token Symbol', order: 3, group: 'Token Info' },
    { key: 'tokenAddress', label: 'Token Address', order: 4, group: 'Token Info' },
    { key: 'creatorAddress', label: 'Creator Address', order: 5, group: 'Token Info' },
    { key: 'numberOfSocials', label: 'Number of Socials', order: 6, group: 'Token Info' },
    
    // Dev Buy Group
    { key: 'devBuyAmountSOL', label: 'Dev Buy Amount in SOL', order: 7, group: 'Dev Buy' },
    { key: 'devBuyAmountTokens', label: 'Dev Buy Amount in Tokens', order: 10, group: 'Dev Buy' },
    
    // Wallet Buy Group
    { key: 'walletBuyAmountSOL', label: 'Wallet Buy Amount in SOL', order: 8, group: 'Wallet Buy' },
    { key: 'walletBuyAmountTokens', label: 'Wallet Buy Amount in Tokens', order: 11, group: 'Wallet Buy' },
    { key: 'walletBuySOLPercentOfDev', label: 'Wallet buy SOL % of dev', order: 9, group: 'Wallet Buy' },
    { key: 'walletBuyTokensPercentOfDev', label: 'Wallet buy Tokens % of dev', order: 12, group: 'Wallet Buy' },
    
    // Supply Percentages Group
    { key: 'devBuyTokensPercentOfTotalSupply', label: 'Dev buy Tokens % of total supply', order: 13, group: 'Supply Percentages' },
    { key: 'walletBuyPercentOfTotalSupply', label: 'Wallet buy % of total supply', order: 14, group: 'Supply Percentages' },
    { key: 'walletBuyPercentOfRemainingSupply', label: 'Wallet buy % of the remaining supply', order: 15, group: 'Supply Percentages' },
    
    // Price & Market Cap Group
    { key: 'tokenPeakPriceBeforeFirstSell', label: 'Token Peak Price Before 1st Sell', order: 16, group: 'Price & Market Cap' },
    { key: 'tokenPeakPrice10sAfterFirstSell', label: 'Token Peak Price 10s After 1st Sell', order: 17, group: 'Price & Market Cap' },
    { key: 'walletBuyMarketCap', label: 'Wallet Buy Market Cap', order: 22, group: 'Price & Market Cap' },
    
    // Buy Counts Group
    { key: 'buysBeforeFirstSell', label: 'Buys Before First Sell', order: 25, group: 'Buy Counts' },
    { key: 'buysAfterFirstSell', label: 'Buys After First Sell (10s)', order: 26, group: 'Buy Counts' },
    
    // Position & Timing Group
    { key: 'walletBuyPositionAfterDev', label: 'Wallet Buy Position After Dev', order: 18, group: 'Position & Timing' },
    { key: 'walletBuyBlockNumber', label: 'Wallet Buy Block #', order: 19, group: 'Position & Timing' },
    { key: 'walletBuyBlockNumberAfterDev', label: 'Wallet Buy Block # After Dev', order: 20, group: 'Position & Timing' },
    { key: 'walletBuyTimestamp', label: 'Wallet Buy Timestamp', order: 21, group: 'Position & Timing' },
    
    // Transaction Group
    { key: 'walletGasAndFeesAmount', label: 'Wallet Gas & Fees Amount', order: 23, group: 'Transaction' },
    { key: 'transactionSignature', label: 'Transaction Signature', order: 24, group: 'Transaction' }
];

// Sell column definitions
const SELL_COLUMN_DEFINITIONS = [
    { key: 'sellNumber', label: 'Sell Number', group: 'Sell Columns' },
    { key: 'sellMarketCap', label: 'Sell Market Cap', group: 'Sell Columns' },
    { key: 'sellPNL', label: 'Sell PNL', group: 'Sell Columns' },
    { key: 'sellPercentOfBuy', label: 'Sell % of Buy', group: 'Sell Columns' },
    { key: 'sellAmountSOL', label: 'Sell Amount in SOL', group: 'Sell Columns' },
    { key: 'sellAmountTokens', label: 'Sell Amount in Tokens', group: 'Sell Columns' },
    { key: 'sellTransactionSignature', label: 'Sell Transaction Signature', group: 'Sell Columns' },
    { key: 'sellTimestamp', label: 'Sell Timestamp', group: 'Sell Columns' },
    { key: 'devStillHolding', label: 'Dev Still Holding', group: 'Sell Columns' }
];

// Initialize column visibility from localStorage or default to all visible
function initializeColumnVisibility() {
    const saved = localStorage.getItem('dashboardColumnVisibility');
    if (saved) {
        try {
            const parsed = JSON.parse(saved);
            columnVisibility = parsed.columns || {};
            sellColumnVisibility = parsed.sellColumns || {};
        } catch (e) {
            columnVisibility = {};
            sellColumnVisibility = {};
        }
    }
    
    // Set default visibility for any missing base columns
    COLUMN_DEFINITIONS.forEach(col => {
        if (columnVisibility[col.key] === undefined) {
            columnVisibility[col.key] = true; // Default: visible
        }
    });
    
    // Set default visibility for any missing sell columns
    SELL_COLUMN_DEFINITIONS.forEach(col => {
        if (sellColumnVisibility[col.key] === undefined) {
            sellColumnVisibility[col.key] = true; // Default: visible
        }
    });
}

// Save column visibility to localStorage
function saveColumnVisibility() {
    localStorage.setItem('dashboardColumnVisibility', JSON.stringify({
        columns: columnVisibility,
        sellColumns: sellColumnVisibility
    }));
}

// Data point definitions with filter types
const DATA_POINTS = [
    // SOL Amount filters
    { key: 'pnlSOL', label: 'PNL per token in SOL', type: 'sol', field: 'pnlSOL' },
    { key: 'devBuyAmountSOL', label: 'Dev Buy Amount in SOL', type: 'sol', field: 'devBuyAmountSOL' },
    { key: 'walletBuyAmountSOL', label: 'Wallet Buy Amount in SOL', type: 'sol', field: 'walletBuyAmountSOL' },
    { key: 'walletGasAndFeesAmount', label: 'Wallet Gas & Fees Amount', type: 'sol', field: 'walletGasAndFeesAmount' },
    { key: 'walletBuyMarketCap', label: 'Wallet Buy Market Cap', type: 'marketcap', field: 'walletBuyMarketCap' },
    { key: 'tokenPeakMarketCapBeforeFirstSell', label: 'Token Peak Market Cap Before 1st Sell', type: 'marketcap', field: 'tokenPeakMarketCapBeforeFirstSell' },
    { key: 'tokenPeakMarketCap10sAfterFirstSell', label: 'Token Peak Market Cap 10s After 1st Sell', type: 'marketcap', field: 'tokenPeakMarketCap10sAfterFirstSell' },
    { key: 'walletBuyBlockNumberAfterDev', label: 'Wallet Block # after dev', type: 'marketcap', field: 'walletBuyBlockNumberAfterDev' },
    { key: 'walletBuyPositionAfterDev', label: 'Wallet Position after dev', type: 'marketcap', field: 'walletBuyPositionAfterDev' },
    
    // Token Amount filters
    { key: 'devBuyAmountTokens', label: 'Dev Buy Amount in Tokens', type: 'token', field: 'devBuyAmountTokens' },
    { key: 'walletBuyAmountTokens', label: 'Wallet Buy Amount in Tokens', type: 'token', field: 'walletBuyAmountTokens' },
    
    // Percentage filters
    { key: 'pnlPercent', label: '% PNL per token', type: 'percent', field: 'pnlPercent' },
    { key: 'walletBuySOLPercentOfDev', label: 'Wallet buy SOL % of dev', type: 'percent', field: 'walletBuySOLPercentOfDev' },
    { key: 'walletBuyTokensPercentOfDev', label: 'Wallet buy Tokens % of dev', type: 'percent', field: 'walletBuyTokensPercentOfDev' },
    { key: 'devBuyTokensPercentOfTotalSupply', label: 'Dev buy Tokens % of total supply', type: 'percent', field: 'devBuyTokensPercentOfTotalSupply' },
    { key: 'walletBuyPercentOfTotalSupply', label: 'Wallet buy % of total supply', type: 'percent', field: 'walletBuyPercentOfTotalSupply' },
    { key: 'walletBuyPercentOfRemainingSupply', label: 'Wallet buy % of the remaining supply', type: 'percent', field: 'walletBuyPercentOfRemainingSupply' },
    
    // Sell-related filters (these will be handled specially)
    { key: 'sellAmountSOL', label: 'Wallet Sell Amount in SOL', type: 'sol', field: 'sells', isArray: true, arrayField: 'sellAmountSOL' },
    { key: 'sellAmountTokens', label: 'Wallet Sell Amount in Tokens', type: 'token', field: 'sells', isArray: true, arrayField: 'sellAmountTokens' },
    { key: 'sellMarketCap', label: 'Wallet Sell Market Cap', type: 'marketcap', field: 'sells', isArray: true, arrayField: 'marketCap' },
    { key: 'sellPercentOfBuy', label: 'Sell % of Buy', type: 'percent', field: 'sells', isArray: true, arrayField: 'sellPercentOfBuy' },
    { key: 'firstSellPNL', label: 'Sell PNL', type: 'percent', field: 'sells', isArray: true, arrayField: 'firstSellPNL' },
    { key: 'sellTimestamp', label: 'Wallet Sell Timestamp', type: 'timestamp', field: 'sells', isArray: true, arrayField: 'timestamp' },
    
    // Timestamp filters
    { key: 'walletBuyTimestamp', label: 'Wallet Buy Timestamp', type: 'timestamp', field: 'walletBuyTimestamp' }
];

/**
 * Initialize dashboard - load wallets into select
 */
export async function initializeDashboard() {
    try {
        // Import state to access selectedWalletForDashboard
        const { state } = await import('./state.js');
        
        const result = await api.fetchAllWallets();
        if (result.success && result.wallets) {
            const select = document.getElementById('dashboardWalletSelect');
            if (select) {
                // Clear existing options except the first one
                select.innerHTML = '<option value="">-- Select a wallet --</option>';
                
                // Add wallet options
                result.wallets.forEach(wallet => {
                    const option = document.createElement('option');
                    option.value = wallet;
                    option.textContent = wallet;
                    // Restore previously selected wallet if it exists
                    if (state.selectedWalletForDashboard === wallet) {
                        option.selected = true;
                    }
                    select.appendChild(option);
                });
                
                // Restore selection from state if it exists
                if (state.selectedWalletForDashboard) {
                    select.value = state.selectedWalletForDashboard;
                    // Load dashboard data for the selected wallet
                    loadDashboardData();
                }
            }
        }
        
        // Initialize filter presets
        await loadFilterPresets();
        
        // Initialize column visibility
        initializeColumnVisibility();
        
        // Render existing filters
        renderFilters();
    } catch (error) {
        console.error('Failed to initialize dashboard:', error);
    }
}


/**
 * Get filter configuration based on type
 */
function getFilterConfig(type) {
    switch(type) {
        case 'sol':
            return { min: -20, max: 20, defaultMin: -20, defaultMax: 20, step: 0.01, minLabel: '-20', maxLabel: '20+' };
        case 'token':
            return { min: 0, max: 1000000000, defaultMin: 0, defaultMax: 1000000000, step: 1, maxLabel: '10^9+' };
        case 'percent':
            return { min: -100, max: 100, defaultMin: -100, defaultMax: 100, step: 0.01, minLabel: '-100%', maxLabel: '100%' };
        case 'marketcap':
            return { min: 0, max: 10000, defaultMin: 0, defaultMax: 10000, step: 0.01, minLabel: '0', maxLabel: '10,000+' };
        case 'timestamp':
            // For timestamp, min/max are ISO date strings, defaults are null (no filter)
            return { min: null, max: null, defaultMin: null, defaultMax: null, step: null, minLabel: 'Start Date/Time', maxLabel: 'End Date/Time' };
        default:
            return { min: 0, max: 100, defaultMin: 0, defaultMax: 100, step: 0.01 };
    }
}

/**
 * Open add filter dialog
 */
window.openAddFilterDialog = function() {
    const modal = document.getElementById('addFilterModal');
    const list = document.getElementById('dataPointsList');
    if (!modal || !list) return;
    
    // Clear and populate data points list
    list.innerHTML = '';
    
    // Get already active filter keys
    const activeKeys = activeFilters.map(f => f.key);
    
    // For sell filters, always show them (allow multiple instances with different sell numbers)
    // For other filters, filter out already added data points
    const availableDataPoints = DATA_POINTS.filter(dp => {
        // Always show sell filters (isArray && field === 'sells')
        if (dp.isArray && dp.field === 'sells') {
            return true;
        }
        // For non-sell filters, only show if not already added
        return !activeKeys.includes(dp.key);
    });
    
    if (availableDataPoints.length === 0) {
        list.innerHTML = '<div style="padding: 20px; text-align: center; color: #94a3b8;">All available data points have been added as filters.</div>';
    } else {
        availableDataPoints.forEach(dataPoint => {
            const item = document.createElement('div');
            item.style.cssText = 'padding: 12px; background: #1a1f2e; border: 1px solid #334155; border-radius: 6px; cursor: pointer; transition: all 0.2s;';
            item.onmouseover = () => {
                item.style.background = '#334155';
                item.style.borderColor = '#3b82f6';
            };
            item.onmouseout = () => {
                item.style.background = '#1a1f2e';
                item.style.borderColor = '#334155';
            };
            item.onclick = () => {
                addFilter(dataPoint.key);
                window.closeAddFilterDialog();
            };
            
            const label = document.createElement('div');
            label.style.cssText = 'color: #e0e7ff; font-weight: 600; margin-bottom: 4px;';
            label.textContent = dataPoint.label;
            item.appendChild(label);
            
            const type = document.createElement('div');
            type.style.cssText = 'color: #94a3b8; font-size: 0.85rem;';
            const typeLabels = { sol: 'SOL Amount', token: 'Token Amount', percent: 'Percentage', marketcap: 'Market Cap', timestamp: 'Date/Time' };
            let typeText = `Type: ${typeLabels[dataPoint.type] || 'Unknown'}`;
            
            // For sell filters, show which sell numbers are already used
            if (dataPoint.isArray && dataPoint.field === 'sells') {
                const existingFilters = activeFilters.filter(f => f.key === dataPoint.key);
                if (existingFilters.length > 0) {
                    const usedSellNumbers = existingFilters
                        .map(f => f.sellNumber || 1)
                        .sort((a, b) => a - b);
                    const sellNumbersText = usedSellNumbers.map(n => 
                        n === 1 ? '1st' : n === 2 ? '2nd' : n === 3 ? '3rd' : `${n}th`
                    ).join(', ');
                    typeText += ` (${existingFilters.length} filter${existingFilters.length > 1 ? 's' : ''} added: ${sellNumbersText} sell${usedSellNumbers.length > 1 ? 's' : ''} - can add more with different sell numbers)`;
                } else {
                    typeText += ' (can add multiple with different sell numbers)';
                }
            }
            type.textContent = typeText;
            item.appendChild(type);
            
            list.appendChild(item);
        });
    }
    
    modal.classList.add('active');
    
    // Add click-outside-to-close
    const handleOverlayClick = (e) => {
        if (e.target === modal) {
            window.closeAddFilterDialog();
        }
    };
    modal.addEventListener('click', handleOverlayClick);
    modal._overlayHandler = handleOverlayClick;
};

/**
 * Close add filter dialog
 */
window.closeAddFilterDialog = function() {
    const modal = document.getElementById('addFilterModal');
    if (!modal) return;
    
    modal.classList.remove('active');
    
    // Clear search
    const searchInput = document.getElementById('filterSearchInput');
    if (searchInput) {
        searchInput.value = '';
    }
    
    // Remove overlay click handler
    if (modal._overlayHandler) {
        modal.removeEventListener('click', modal._overlayHandler);
        delete modal._overlayHandler;
    }
};

/**
 * Filter data point options by search
 */
window.filterDataPointOptions = function() {
    const searchInput = document.getElementById('filterSearchInput');
    const list = document.getElementById('dataPointsList');
    if (!searchInput || !list) return;
    
    const searchTerm = searchInput.value.toLowerCase();
    const items = Array.from(list.children);
    
    items.forEach(item => {
        if (item.tagName === 'DIV') {
            const label = item.querySelector('div:first-child')?.textContent.toLowerCase() || '';
            if (label.includes(searchTerm)) {
                item.style.display = '';
            } else {
                item.style.display = 'none';
            }
        }
    });
};

/**
 * Add a filter
 */
function addFilter(dataPointKey) {
    const dataPoint = DATA_POINTS.find(dp => dp.key === dataPointKey);
    if (!dataPoint) return;
    
    const config = getFilterConfig(dataPoint.type);
    
    // Create filter object
    const filter = {
        id: Date.now() + Math.random(), // Unique ID for this filter instance
        key: dataPointKey,
        label: dataPoint.label,
        type: dataPoint.type,
        min: config.defaultMin,
        max: config.defaultMax,
        minEnabled: true,
        maxEnabled: true
    };
    
    // Add sellNumber for sell filters
    if (dataPoint.isArray && dataPoint.field === 'sells') {
        // Get all existing sell numbers for this filter key (explicitly check for sellNumber property)
        const existingFiltersForThisKey = activeFilters.filter(f => f.key === dataPointKey);
        const existingSellNumbers = existingFiltersForThisKey
            .filter(f => f.sellNumber !== null && f.sellNumber !== undefined)
            .map(f => f.sellNumber)
            .sort((a, b) => a - b);
        
        // Find the first available sell number starting from 1
        let defaultSellNumber = 1;
        for (let i = 1; i <= 20; i++) { // Check up to 20th sell
            if (!existingSellNumbers.includes(i)) {
                defaultSellNumber = i;
                break;
            }
        }
        
        // Check if this exact combination (key + sellNumber) already exists BEFORE assigning
        // Use strict comparison to ensure we catch all duplicates
        const duplicateExists = existingFiltersForThisKey.some(f => {
            // Handle both cases: explicit sellNumber and default to 1
            const existingSellNum = (f.sellNumber !== null && f.sellNumber !== undefined) ? f.sellNumber : 1;
            return existingSellNum === defaultSellNumber;
        });
        
        if (duplicateExists) {
            // This exact filter already exists, don't add it
            // Could show a notification here if needed
            console.log(`Filter for ${dataPoint.label} with ${defaultSellNumber === 1 ? '1st' : defaultSellNumber === 2 ? '2nd' : defaultSellNumber === 3 ? '3rd' : `${defaultSellNumber}th`} sell already exists`);
            return;
        }
        
        filter.sellNumber = defaultSellNumber;
    } else {
        // For non-sell filters, prevent duplicates (same key)
        if (activeFilters.find(f => f.key === dataPointKey)) {
            return;
        }
    }
    
    activeFilters.push(filter);
    renderFilters();
    // Don't auto-apply, wait for user to click "Apply Filters" button
}

/**
 * Remove a filter
 */
function removeFilter(filterId) {
    activeFilters = activeFilters.filter(f => f.id !== filterId);
    renderFilters();
    // Don't auto-apply, wait for user to click "Apply Filters" button
}

/**
 * Render all active filters
 */
function renderFilters() {
    const container = document.getElementById('dynamicFiltersContainer');
    if (!container) return;
    
    container.innerHTML = '';
    
    if (activeFilters.length === 0) {
        const emptyMsg = document.createElement('div');
        emptyMsg.style.cssText = 'padding: 20px; text-align: center; color: #94a3b8; font-size: 0.9rem;';
        emptyMsg.textContent = 'No filters added. Click "Add Filter" to add filters.';
        container.appendChild(emptyMsg);
        return;
    }
    
    activeFilters.forEach((filter, index) => {
        const filterDiv = document.createElement('div');
        filterDiv.style.cssText = 'margin-bottom: 20px; padding: 15px; background: #1a1f2e; border: 1px solid #334155; border-radius: 6px;';
        filterDiv.id = `filter-${filter.id}`;
        
        // Header with label and remove button
        const header = document.createElement('div');
        header.style.cssText = 'display: flex; justify-content: space-between; align-items: center; margin-bottom: 12px;';
        
        // Get data point for this filter
        const dataPoint = DATA_POINTS.find(dp => dp.key === filter.key);
        
        const label = document.createElement('label');
        label.style.cssText = 'font-weight: 600; color: #cbd5e1; font-size: 0.9rem;';
        // For sell filters, show sell number in label if specified
        let labelText = filter.label;
        if (dataPoint && dataPoint.isArray && dataPoint.field === 'sells' && filter.sellNumber) {
            const sellNumText = filter.sellNumber === 1 ? '1st' : filter.sellNumber === 2 ? '2nd' : filter.sellNumber === 3 ? '3rd' : `${filter.sellNumber}th`;
            labelText = `${filter.label} (${sellNumText} sell)`;
        }
        label.textContent = labelText;
        header.appendChild(label);
        
        const removeBtn = document.createElement('button');
        removeBtn.style.cssText = 'padding: 4px 12px; background: #ef4444; color: white; border: none; border-radius: 4px; cursor: pointer; font-size: 0.85rem; transition: all 0.2s;';
        removeBtn.textContent = 'Remove';
        removeBtn.onclick = () => removeFilter(filter.id);
        removeBtn.onmouseover = () => { removeBtn.style.background = '#dc2626'; };
        removeBtn.onmouseout = () => { removeBtn.style.background = '#ef4444'; };
        header.appendChild(removeBtn);
        
        filterDiv.appendChild(header);
        
        // Sell number selector for sell filters
        if (dataPoint && dataPoint.isArray && dataPoint.field === 'sells') {
            const sellNumberDiv = document.createElement('div');
            sellNumberDiv.style.cssText = 'margin-bottom: 12px; display: flex; align-items: center; gap: 10px;';
            
            const sellNumberLabel = document.createElement('label');
            sellNumberLabel.style.cssText = 'color: #94a3b8; font-size: 0.85rem;';
            sellNumberLabel.textContent = 'Sell Number:';
            sellNumberDiv.appendChild(sellNumberLabel);
            
            const sellNumberSelect = document.createElement('select');
            sellNumberSelect.id = `filter-${filter.key}-sellNumber`;
            sellNumberSelect.style.cssText = 'padding: 6px 10px; border: 1px solid #334155; background: #0f1419; color: #e0e7ff; border-radius: 6px; font-size: 0.85rem; cursor: pointer;';
            
            // Determine max sell number to show (use maxSells or a reasonable default like 10)
            const maxSellOptions = Math.max(maxSells || 10, 10);
            
            for (let i = 1; i <= maxSellOptions; i++) {
                const option = document.createElement('option');
                option.value = i;
                option.textContent = i === 1 ? '1st sell' : i === 2 ? '2nd sell' : i === 3 ? '3rd sell' : `${i}th sell`;
                sellNumberSelect.appendChild(option);
            }
            
            // Set current value
            sellNumberSelect.value = filter.sellNumber || 1;
            
            // Update filter when selection changes
            sellNumberSelect.onchange = async () => {
                const newSellNumber = parseInt(sellNumberSelect.value);
                
                // Check if this sell number is already used by another filter with the same key
                const duplicateExists = activeFilters.some(f => {
                    if (f.id === filter.id) return false; // Don't check against itself
                    if (f.key !== filter.key) return false; // Different datapoint
                    const existingSellNum = f.sellNumber !== null && f.sellNumber !== undefined ? f.sellNumber : 1;
                    return existingSellNum === newSellNumber;
                });
                
                if (duplicateExists) {
                    // Revert to previous value
                    sellNumberSelect.value = filter.sellNumber || 1;
                    const { showNotification } = await import('./utils.js');
                    const sellNumText = newSellNumber === 1 ? '1st' : newSellNumber === 2 ? '2nd' : newSellNumber === 3 ? '3rd' : `${newSellNumber}th`;
                    showNotification(`Sell number ${sellNumText} is already used for this datapoint`, 'error');
                    return;
                }
                
                filter.sellNumber = newSellNumber;
                // Don't auto-apply, wait for user to click "Apply Filters" button
            };
            
            sellNumberDiv.appendChild(sellNumberSelect);
            filterDiv.appendChild(sellNumberDiv);
        }
        
        // Filter controls
        const config = getFilterConfig(filter.type);
        const controlsDiv = document.createElement('div');
        controlsDiv.style.cssText = 'display: flex; gap: 15px; align-items: center; flex-wrap: wrap;';
        
        // Handle timestamp filters differently - use datetime-local inputs
        if (filter.type === 'timestamp') {
            const timestampDiv = document.createElement('div');
            timestampDiv.style.cssText = 'display: flex; gap: 10px; align-items: center; flex: 1; flex-wrap: wrap;';
            
            // Helper function to convert formatted timestamp to datetime-local format
            const convertToDatetimeLocal = (timestampStr) => {
                if (!timestampStr) return '';
                try {
                    // Parse the formatted timestamp (e.g., "2024-01-15 14:30:00")
                    const date = new Date(timestampStr);
                    if (isNaN(date.getTime())) return '';
                    // Convert to datetime-local format (YYYY-MM-DDTHH:mm)
                    const year = date.getFullYear();
                    const month = String(date.getMonth() + 1).padStart(2, '0');
                    const day = String(date.getDate()).padStart(2, '0');
                    const hours = String(date.getHours()).padStart(2, '0');
                    const minutes = String(date.getMinutes()).padStart(2, '0');
                    return `${year}-${month}-${day}T${hours}:${minutes}`;
                } catch (e) {
                    return '';
                }
            };
            
            // Start datetime input
            const startLabel = document.createElement('label');
            startLabel.style.cssText = 'color: #94a3b8; font-size: 0.85rem; white-space: nowrap;';
            startLabel.textContent = 'From:';
            timestampDiv.appendChild(startLabel);
            
            const startInput = document.createElement('input');
            startInput.type = 'datetime-local';
            startInput.id = `filter-${filter.key}-min`;
            startInput.value = convertToDatetimeLocal(filter.min);
            startInput.style.cssText = 'padding: 8px; border: 1px solid #334155; background: #0f1419; color: #e0e7ff; border-radius: 6px; font-size: 0.85rem; min-width: 180px;';
            startInput.onchange = () => {
                if (startInput.value) {
                    // Convert datetime-local to ISO string for storage
                    const date = new Date(startInput.value);
                    filter.min = date.toISOString();
                } else {
                    filter.min = null;
                }
                // Don't auto-apply, wait for user to click "Apply Filters" button
            };
            timestampDiv.appendChild(startInput);
            
            // End datetime input
            const endLabel = document.createElement('label');
            endLabel.style.cssText = 'color: #94a3b8; font-size: 0.85rem; white-space: nowrap; margin-left: 10px;';
            endLabel.textContent = 'To:';
            timestampDiv.appendChild(endLabel);
            
            const endInput = document.createElement('input');
            endInput.type = 'datetime-local';
            endInput.id = `filter-${filter.key}-max`;
            endInput.value = convertToDatetimeLocal(filter.max);
            endInput.style.cssText = 'padding: 8px; border: 1px solid #334155; background: #0f1419; color: #e0e7ff; border-radius: 6px; font-size: 0.85rem; min-width: 180px;';
            endInput.onchange = () => {
                if (endInput.value) {
                    // Convert datetime-local to ISO string for storage
                    const date = new Date(endInput.value);
                    filter.max = date.toISOString();
                } else {
                    filter.max = null;
                }
                // Don't auto-apply, wait for user to click "Apply Filters" button
            };
            timestampDiv.appendChild(endInput);
            
            controlsDiv.appendChild(timestampDiv);
        } else {
            // Regular number inputs and sliders for non-timestamp filters
            // Inputs
            const inputsDiv = document.createElement('div');
            inputsDiv.style.cssText = 'flex: 1; min-width: 150px;';
            
            const inputsInner = document.createElement('div');
            inputsInner.style.cssText = 'display: flex; gap: 10px; align-items: center;';
            
            // Min input
            const minInput = document.createElement('input');
            minInput.type = 'number';
            minInput.id = `filter-${filter.key}-min`;
            minInput.min = (filter.type === 'percent' || filter.type === 'sol') ? undefined : config.min; // Percent and SOL can be unset
            minInput.step = config.step;
            minInput.value = filter.min;
            minInput.placeholder = (filter.type === 'percent' || filter.type === 'sol') ? 'Min' : config.min.toString();
            minInput.style.cssText = 'width: 100px; padding: 8px; border: 1px solid #334155; background: #0f1419; color: #e0e7ff; border-radius: 6px; font-size: 0.85rem;';
            inputsInner.appendChild(minInput);
            
            const toSpan = document.createElement('span');
            toSpan.style.cssText = 'color: #94a3b8;';
            toSpan.textContent = 'to';
            inputsInner.appendChild(toSpan);
            
            // Max input
            const maxInput = document.createElement('input');
            maxInput.type = 'number';
            maxInput.id = `filter-${filter.key}-max`;
            maxInput.min = filter.type === 'sol' || filter.type === 'token' || filter.type === 'marketcap' ? config.min : undefined; // SOL/Token/MarketCap min is 0, percent can be unset
            maxInput.step = config.step;
            maxInput.value = filter.max;
            maxInput.placeholder = 'Max';
            maxInput.style.cssText = 'width: 100px; padding: 8px; border: 1px solid #334155; background: #0f1419; color: #e0e7ff; border-radius: 6px; font-size: 0.85rem;';
            inputsInner.appendChild(maxInput);
            
            inputsDiv.appendChild(inputsInner);
            controlsDiv.appendChild(inputsDiv);
            
            // Slider
            const sliderDiv = document.createElement('div');
            sliderDiv.style.cssText = 'flex: 4; min-width: 300px; position: relative; display: flex; justify-content: space-between; gap: 5px; align-items: center;';
            
            // Min label
            const minLabel = document.createElement('span');
            minLabel.id = `filter-${filter.key}-min-label`;
            minLabel.style.cssText = 'color: #94a3b8; font-size: 0.85rem; text-align: right; min-width: 50px; flex-shrink: 0;';
            if (filter.type === 'percent') {
                minLabel.textContent = config.minLabel;
            } else if (filter.type === 'sol') {
                minLabel.textContent = config.minLabel || config.min;
            } else {
                minLabel.textContent = config.min;
            }
            sliderDiv.appendChild(minLabel);
            
            // Slider container
            const sliderContainer = document.createElement('div');
            sliderContainer.className = 'dual-range-container';
            sliderContainer.style.cssText = 'position: relative; height: 40px; padding: 15px 0; width: 100%;';
            
            const track = document.createElement('div');
            track.className = 'dual-range-track';
            track.style.cssText = 'position: absolute; width: 100%; height: 6px; background: #334155; border-radius: 3px; top: 15px; z-index: 1;';
            sliderContainer.appendChild(track);
            
            const progress = document.createElement('div');
            progress.className = 'dual-range-progress';
            progress.id = `filter-${filter.key}-progress`;
            progress.style.cssText = 'position: absolute; height: 6px; background: #3b82f6; border-radius: 3px; top: 15px; z-index: 1; left: 0%; width: 100%;';
            sliderContainer.appendChild(progress);
            
            const minSlider = document.createElement('input');
            minSlider.type = 'range';
            minSlider.id = `filter-${filter.key}-slider-min`;
            minSlider.className = 'dual-range-input';
            minSlider.min = config.min;
            minSlider.max = config.max;
            minSlider.step = config.step;
            minSlider.value = filter.min;
            minSlider.style.cssText = 'position: absolute; width: 100%; top: 10px; z-index: 2;';
            sliderContainer.appendChild(minSlider);
            
            const maxSlider = document.createElement('input');
            maxSlider.type = 'range';
            maxSlider.id = `filter-${filter.key}-slider-max`;
            maxSlider.className = 'dual-range-input';
            maxSlider.min = config.min;
            maxSlider.max = config.max;
            maxSlider.step = config.step;
            maxSlider.value = filter.max;
            maxSlider.style.cssText = 'position: absolute; width: 100%; top: 10px; z-index: 3;';
            sliderContainer.appendChild(maxSlider);
            
            sliderDiv.appendChild(sliderContainer);
            
            // Max label
            const maxLabel = document.createElement('span');
            maxLabel.id = `filter-${filter.key}-max-label`;
            maxLabel.style.cssText = 'color: #94a3b8; font-size: 0.85rem; text-align: left; min-width: 50px; flex-shrink: 0;';
            maxLabel.textContent = (filter.type === 'percent' || filter.type === 'marketcap') ? config.maxLabel : config.max;
            sliderDiv.appendChild(maxLabel);
            
            controlsDiv.appendChild(sliderDiv);
        }
        
        filterDiv.appendChild(controlsDiv);
        container.appendChild(filterDiv);
        
        // Setup slider (only for non-timestamp filters)
        if (filter.type !== 'timestamp') {
            setupDynamicDualRangeSlider(filter.key, config);
        }
    });
}

/**
 * Setup dual-range slider for dynamic filter
 */
function setupDynamicDualRangeSlider(filterKey, config) {
    const minInput = document.getElementById(`filter-${filterKey}-min`);
    const maxInput = document.getElementById(`filter-${filterKey}-max`);
    const minSlider = document.getElementById(`filter-${filterKey}-slider-min`);
    const maxSlider = document.getElementById(`filter-${filterKey}-slider-max`);
    const progress = document.getElementById(`filter-${filterKey}-progress`);
    const minLabel = document.getElementById(`filter-${filterKey}-min-label`);
    const maxLabel = document.getElementById(`filter-${filterKey}-max-label`);
    
    if (!minInput || !maxInput || !minSlider || !maxSlider || !progress) return;
    
    const filter = activeFilters.find(f => f.key === filterKey);
    if (!filter) return;
    
    // Update progress bar and labels
    function updateProgress() {
        // Get actual filter values (may be beyond slider range)
        const actualMin = filter.min !== null && filter.min !== undefined ? filter.min : (filter.type === 'percent' ? config.min : config.min);
        const actualMax = filter.max !== null && filter.max !== undefined ? filter.max : (filter.type === 'percent' ? config.max : config.max);
        
        // For progress bar, use slider values (clamped to range)
        const minVal = parseFloat(minSlider.value);
        const maxVal = parseFloat(maxSlider.value);
        const minPercent = ((minVal - config.min) / (config.max - config.min)) * 100;
        const maxPercent = ((maxVal - config.min) / (config.max - config.min)) * 100;
        
        progress.style.left = `${minPercent}%`;
        progress.style.width = `${maxPercent - minPercent}%`;
        
        // Update labels with proper formatting
        if (filter.type === 'sol') {
            if (actualMin === null || actualMin === undefined) {
                minLabel.textContent = '-20';
            } else if (actualMin < -20) {
                minLabel.textContent = '-20<';
            } else {
                minLabel.textContent = actualMin.toFixed(2);
            }
            if (actualMax > 20) {
                maxLabel.textContent = '20+';
            } else if (actualMax === null || actualMax === undefined) {
                maxLabel.textContent = '20+';
            } else {
                maxLabel.textContent = actualMax.toFixed(2);
            }
        } else if (filter.type === 'token') {
            minLabel.textContent = actualMin >= 0 ? actualMin.toLocaleString() : '0';
            if (actualMax > 1000000000) {
                maxLabel.textContent = '10^9+';
            } else if (actualMax === null || actualMax === undefined) {
                maxLabel.textContent = '10^9+';
            } else {
                maxLabel.textContent = actualMax.toLocaleString();
            }
        } else if (filter.type === 'marketcap') {
            minLabel.textContent = actualMin >= 0 ? actualMin.toLocaleString() : '0';
            if (actualMax > 10000) {
                maxLabel.textContent = '10,000+';
            } else if (actualMax === null || actualMax === undefined) {
                maxLabel.textContent = '10,000+';
            } else {
                maxLabel.textContent = actualMax.toLocaleString();
            }
        } else if (filter.type === 'percent') {
            if (actualMin === null || actualMin === undefined) {
                minLabel.textContent = '-100%';
            } else if (actualMin < -100) {
                minLabel.textContent = `-(${Math.abs(actualMin).toFixed(0)}+)%`;
            } else {
                minLabel.textContent = `${actualMin.toFixed(2)}%`;
            }
            if (actualMax === null || actualMax === undefined) {
                maxLabel.textContent = '100%';
            } else if (actualMax > 100) {
                maxLabel.textContent = `+(100+)%`;
            } else {
                maxLabel.textContent = `${actualMax.toFixed(2)}%`;
            }
        }
    }
    
    // Sync slider with input
    function syncSliderToInput(slider, input, isMin) {
        let val = parseFloat(input.value);
        if (isNaN(val) || input.value === '') {
            // Allow empty input for "not set" case (for percent and SOL filters)
            if (isMin && (filter.type === 'percent' || filter.type === 'sol')) {
                filter.min = null;
            } else if (!isMin) {
                filter.max = null;
            }
            updateProgress();
            // Don't auto-apply, wait for user to click "Apply Filters" button
            return;
        }
        
        // For Token, min must be >= 0 (SOL can be negative)
        if (isMin && filter.type === 'token') {
            val = Math.max(0, val);
        }
        
        // Clamp slider value to its range, but allow input to go beyond
        const sliderVal = isMin 
            ? Math.max(config.min, Math.min(config.max, val))
            : Math.max(config.min, Math.min(config.max, val));
        slider.value = sliderVal;
        
        // But keep the actual value in the filter (can be beyond max)
        if (isMin) {
            filter.min = val;
            if (val > parseFloat(maxInput.value || maxSlider.value)) {
                const maxVal = val;
                maxSlider.value = Math.min(config.max, maxVal);
                maxInput.value = maxVal;
                filter.max = maxVal;
            }
        } else {
            filter.max = val;
            if (val < parseFloat(minInput.value || minSlider.value)) {
                const minVal = val;
                minSlider.value = Math.max(config.min, minVal);
                minInput.value = minVal;
                filter.min = minVal;
            }
        }
        
        updateProgress();
        // Don't auto-apply, wait for user to click "Apply Filters" button
    }
    
    // Sync input with slider
    function syncInputToSlider(input, slider, isMin) {
        let val = parseFloat(slider.value);
        
        // For max, allow values beyond the slider max
        if (!isMin) {
            // If slider is at max, allow input to go beyond
            if (val >= config.max) {
                // Keep the current filter max if it's already beyond, otherwise use slider value
                val = filter.max !== null && filter.max > config.max ? filter.max : val;
            }
        }
        
        input.value = val;
        
        if (isMin) {
            filter.min = val;
            if (val > parseFloat(maxInput.value || maxSlider.value)) {
                const maxVal = val;
                maxSlider.value = Math.min(config.max, maxVal);
                maxInput.value = maxVal;
                filter.max = maxVal;
            }
        } else {
            filter.max = val;
            if (val < parseFloat(minInput.value || minSlider.value)) {
                const minVal = val;
                minSlider.value = Math.max(config.min, minVal);
                minInput.value = minVal;
                filter.min = minVal;
            }
        }
        
        updateProgress();
        // Don't auto-apply, wait for user to click "Apply Filters" button
    }
    
    // Make sliders interactive
    let activeSlider = null;
    
    minSlider.addEventListener('mousedown', () => {
        minSlider.style.zIndex = '4';
        maxSlider.style.zIndex = '3';
        activeSlider = 'min';
    });
    
    maxSlider.addEventListener('mousedown', () => {
        maxSlider.style.zIndex = '4';
        minSlider.style.zIndex = '2';
        activeSlider = 'max';
    });
    
    document.addEventListener('mouseup', () => {
        if (activeSlider === 'min') {
            minSlider.style.zIndex = '3';
            maxSlider.style.zIndex = '3';
        } else if (activeSlider === 'max') {
            minSlider.style.zIndex = '2';
            maxSlider.style.zIndex = '3';
        }
        activeSlider = null;
    });
    
    // Event listeners
    minInput.addEventListener('input', () => syncSliderToInput(minSlider, minInput, true));
    maxInput.addEventListener('input', () => syncSliderToInput(maxSlider, maxInput, false));
    minSlider.addEventListener('input', () => syncInputToSlider(minInput, minSlider, true));
    maxSlider.addEventListener('input', () => syncInputToSlider(maxInput, maxSlider, false));
    
    // Initialize
    updateProgress();
}

/**
 * Setup dual-range slider for a filter
 */
function setupDualRangeSlider(prefix, min, max, defaultMin, defaultMax) {
    const minInput = document.getElementById(`${prefix}Min`);
    const maxInput = document.getElementById(`${prefix}Max`);
    const minSlider = document.getElementById(`${prefix}SliderMin`);
    const maxSlider = document.getElementById(`${prefix}SliderMax`);
    const progress = document.getElementById(`${prefix}Progress`);
    
    if (!minInput || !maxInput || !minSlider || !maxSlider || !progress) return;
    
    // Update progress bar
    function updateProgress() {
        const minVal = parseFloat(minSlider.value);
        const maxVal = parseFloat(maxSlider.value);
        const minPercent = ((minVal - min) / (max - min)) * 100;
        const maxPercent = ((maxVal - min) / (max - min)) * 100;
        
        progress.style.left = `${minPercent}%`;
        progress.style.width = `${maxPercent - minPercent}%`;
    }
    
    // Sync slider with input
    function syncSliderToInput(slider, input, isMin) {
        const val = parseFloat(input.value);
        if (isNaN(val)) return;
        
        const clampedVal = Math.max(min, Math.min(max, val));
        slider.value = clampedVal;
        input.value = clampedVal;
        
        if (isMin) {
            currentFilters[`${prefix}Min`] = clampedVal;
            if (clampedVal > parseFloat(maxSlider.value)) {
                maxSlider.value = clampedVal;
                maxInput.value = clampedVal;
                currentFilters[`${prefix}Max`] = clampedVal;
            }
        } else {
            currentFilters[`${prefix}Max`] = clampedVal;
            if (clampedVal < parseFloat(minSlider.value)) {
                minSlider.value = clampedVal;
                minInput.value = clampedVal;
                currentFilters[`${prefix}Min`] = clampedVal;
            }
        }
        
        updateProgress();
        // Don't auto-apply, wait for user to click "Apply Filters" button
    }
    
    // Sync input with slider
    function syncInputToSlider(input, slider, isMin) {
        const val = parseFloat(slider.value);
        input.value = val;
        
        if (isMin) {
            currentFilters[`${prefix}Min`] = val;
            if (val > parseFloat(maxSlider.value)) {
                maxSlider.value = val;
                maxInput.value = val;
                currentFilters[`${prefix}Max`] = val;
            }
        } else {
            currentFilters[`${prefix}Max`] = val;
            if (val < parseFloat(minSlider.value)) {
                minSlider.value = val;
                minInput.value = val;
                currentFilters[`${prefix}Min`] = val;
            }
        }
        
        updateProgress();
        // Don't auto-apply, wait for user to click "Apply Filters" button
    }
    
    // Make sliders interactive - handle z-index based on which is closer to mouse
    let activeSlider = null;
    
    minSlider.addEventListener('mousedown', () => {
        minSlider.style.zIndex = '4';
        maxSlider.style.zIndex = '3';
        activeSlider = 'min';
    });
    
    maxSlider.addEventListener('mousedown', () => {
        maxSlider.style.zIndex = '4';
        minSlider.style.zIndex = '2';
        activeSlider = 'max';
    });
    
    document.addEventListener('mouseup', () => {
        if (activeSlider === 'min') {
            minSlider.style.zIndex = '3';
            maxSlider.style.zIndex = '3';
        } else if (activeSlider === 'max') {
            minSlider.style.zIndex = '2';
            maxSlider.style.zIndex = '3';
        }
        activeSlider = null;
    });
    
    // Event listeners for inputs
    minInput.addEventListener('input', () => syncSliderToInput(minSlider, minInput, true));
    maxInput.addEventListener('input', () => syncSliderToInput(maxSlider, maxInput, false));
    
    // Event listeners for sliders
    minSlider.addEventListener('input', () => syncInputToSlider(minInput, minSlider, true));
    maxSlider.addEventListener('input', () => syncInputToSlider(maxInput, maxSlider, false));
    
    // Initialize progress bar
    updateProgress();
}

/**
 * Apply filters to dashboard data
 */
/**
 * Apply filters - sends filters to backend and reloads data
 */
async function applyFilters() {
    // Reset to first page when filters change
    currentPage = 1;
    
    // Reload dashboard data with filters
    await loadDashboardData();
}

/**
 * Update statistics from backend (from ALL data, not filtered)
 */
async function updateStatisticsFromBackend() {
    const select = document.getElementById('dashboardWalletSelect');
    if (!select || !select.value) return;
    
    try {
        const result = await api.fetchDashboardStatistics(select.value);
        if (result.success && result.statistics) {
            const stats = result.statistics;
            
            // Update wallet statistics
            updateStatisticsDisplay(stats);
            
            // Update sell statistics
            updateSellStatisticsFromBackend(stats.sellStatistics || [], stats);
        }
    } catch (error) {
        console.error('Error loading statistics:', error);
    }
}

/**
 * Update statistics display from backend data
 */
function updateStatisticsDisplay(stats) {
    // Wallet SOL Balance
    const walletSolBalanceEl = document.getElementById('walletSolBalance');
    if (walletSolBalanceEl) {
        if (stats.solBalance !== null && stats.solBalance !== undefined) {
            walletSolBalanceEl.textContent = `${stats.solBalance.toFixed(4)} SOL`;
            walletSolBalanceEl.style.color = '#10b981';
        } else {
            walletSolBalanceEl.textContent = '-';
            walletSolBalanceEl.style.color = '#94a3b8';
        }
    }
    
    // Total Wallet PNL
    const totalPNLEl = document.getElementById('totalWalletPNL');
    if (totalPNLEl) {
        totalPNLEl.textContent = stats.totalWalletPNL >= 0 
            ? `+${stats.totalWalletPNL.toFixed(4)} SOL` 
            : `${stats.totalWalletPNL.toFixed(4)} SOL`;
        totalPNLEl.style.color = stats.totalWalletPNL >= 0 ? '#10b981' : '#ef4444';
    }
    
    // Cumulative PNL
    const cumulativePNLEl = document.getElementById('cumulativePNL');
    if (cumulativePNLEl) {
        cumulativePNLEl.textContent = stats.cumulativePNL >= 0 
            ? `+${stats.cumulativePNL.toFixed(2)}%` 
            : `${stats.cumulativePNL.toFixed(2)}%`;
        cumulativePNLEl.style.color = stats.cumulativePNL >= 0 ? '#10b981' : '#ef4444';
    }
    
    // Net Invested
    const netInvestedEl = document.getElementById('netInvested');
    if (netInvestedEl) {
        netInvestedEl.textContent = `${stats.netInvested.toFixed(4)} SOL`;
        netInvestedEl.style.color = '#e0e7ff';
    }
    
    // Risk/Reward Profit
    const riskRewardProfitEl = document.getElementById('riskRewardProfit');
    if (riskRewardProfitEl) {
        riskRewardProfitEl.textContent = stats.riskRewardProfit >= 0 
            ? `+${stats.riskRewardProfit.toFixed(2)}%` 
            : `${stats.riskRewardProfit.toFixed(2)}%`;
        riskRewardProfitEl.style.color = stats.riskRewardProfit >= 0 ? '#10b981' : '#ef4444';
    }
    
    // Wallet Average Buy Size
    const walletAvgBuySizeEl = document.getElementById('walletAvgBuySize');
    if (walletAvgBuySizeEl) {
        walletAvgBuySizeEl.textContent = stats.walletAvgBuySize > 0 
            ? `${stats.walletAvgBuySize.toFixed(4)} SOL` 
            : '-';
        walletAvgBuySizeEl.style.color = '#e0e7ff';
    }
    
    // Dev Average Buy Size
    const devAvgBuySizeEl = document.getElementById('devAvgBuySize');
    if (devAvgBuySizeEl) {
        devAvgBuySizeEl.textContent = stats.devAvgBuySize > 0 
            ? `${stats.devAvgBuySize.toFixed(4)} SOL` 
            : '-';
        devAvgBuySizeEl.style.color = '#e0e7ff';
    }
    
    // Average PNL per Token
    const avgPNLPerTokenEl = document.getElementById('avgPNLPerToken');
    if (avgPNLPerTokenEl) {
        avgPNLPerTokenEl.textContent = stats.avgPNLPerToken >= 0 
            ? `+${stats.avgPNLPerToken.toFixed(2)}%` 
            : `${stats.avgPNLPerToken.toFixed(2)}%`;
        avgPNLPerTokenEl.style.color = stats.avgPNLPerToken >= 0 ? '#10b981' : '#ef4444';
    }
}

/**
 * Update sell statistics from backend data
 */
function updateSellStatisticsFromBackend(sellStatistics, stats) {
    const container = document.getElementById('sellStatisticsContainer');
    if (!container) return;
    
    // Get total sells PNL from backend (includes unsold tokens)
    // This should match totalWalletPNL
    const totalSellsPNL = stats && stats.totalSellsPNL !== undefined ? stats.totalSellsPNL : 0;
    
    // Update total sells PNL display
    const totalSolSoldEl = document.getElementById('totalSolSoldValue');
    if (totalSolSoldEl) {
        if (totalSellsPNL !== 0) {
            const sign = totalSellsPNL >= 0 ? '+' : '';
            totalSolSoldEl.textContent = `${sign}${totalSellsPNL.toFixed(4)} SOL`;
            totalSolSoldEl.style.color = totalSellsPNL >= 0 ? '#10b981' : '#ef4444';
        } else {
            totalSolSoldEl.textContent = '-';
            totalSolSoldEl.style.color = '#94a3b8';
        }
    }
    
    if (!sellStatistics || sellStatistics.length === 0) {
        container.innerHTML = '<div style="color: #94a3b8; text-align: center; padding: 20px;">No sells found</div>';
        return;
    }
    
    container.innerHTML = '';
    
    // Format sell number (1st, 2nd, 3rd, 4th, 5th, etc.)
    const getOrdinal = (n) => {
        const s = ['th', 'st', 'nd', 'rd'];
        const v = n % 100;
        return n + (s[(v - 20) % 10] || s[v] || s[0]);
    };
    
    // Display all sells individually
    sellStatistics.forEach(stat => {
        const card = document.createElement('div');
        card.style.cssText = 'padding: 15px; background: #1a1f2e; border-radius: 6px; border: 1px solid #334155;';
        
        const sellNumber = getOrdinal(stat.sellNumber);
        const title = document.createElement('div');
        title.style.cssText = 'font-size: 0.85rem; color: #94a3b8; margin-bottom: 10px; font-weight: 600;';
        title.textContent = `${sellNumber} Sell`;
        card.appendChild(title);
        
        // Total SOL - prominently displayed
        if (stat.totalSol !== null && stat.totalSol !== undefined && stat.totalSol > 0) {
            const totalSolEl = document.createElement('div');
            totalSolEl.style.cssText = 'font-size: 1rem; font-weight: 600; margin-bottom: 8px; display: flex; align-items: center; gap: 6px;';
            totalSolEl.innerHTML = `<img src="/img/wsol.svg" alt="SOL" style="width: 18px; height: 18px;"> <span style="color: #10b981;">Total SOL: ${stat.totalSol.toFixed(4)} SOL</span>`;
            card.appendChild(totalSolEl);
        }
        
        // Total SOL PNL - prominently displayed
        if (stat.totalSolPNL !== null && stat.totalSolPNL !== undefined) {
            const totalSolPNLEl = document.createElement('div');
            totalSolPNLEl.style.cssText = 'font-size: 1rem; font-weight: 600; margin-bottom: 8px; display: flex; align-items: center; gap: 6px;';
            const pnlColor = stat.totalSolPNL >= 0 ? '#10b981' : '#ef4444';
            const pnlSign = stat.totalSolPNL >= 0 ? '+' : '';
            totalSolPNLEl.innerHTML = `<img src="/img/wsol.svg" alt="SOL" style="width: 18px; height: 18px;"> <span style="color: ${pnlColor};">Total SOL PNL: ${pnlSign}${stat.totalSolPNL.toFixed(4)} SOL</span>`;
            card.appendChild(totalSolPNLEl);
        }
        
        if (stat.avgProfit !== null && stat.avgProfit !== undefined) {
            const profitEl = document.createElement('div');
            profitEl.style.cssText = 'font-size: 0.75rem; color: #94a3b8; margin-bottom: 5px;';
            profitEl.textContent = `Avg Profit: ${stat.avgProfit >= 0 ? '+' : ''}${stat.avgProfit.toFixed(2)}%`;
            profitEl.style.color = stat.avgProfit >= 0 ? '#10b981' : '#ef4444';
            card.appendChild(profitEl);
        }
        
        if (stat.avgSellPercentOfBuy !== null && stat.avgSellPercentOfBuy !== undefined) {
            const percentEl = document.createElement('div');
            percentEl.style.cssText = 'font-size: 0.75rem; color: #94a3b8; margin-bottom: 5px;';
            percentEl.textContent = `Avg Sell % of Buy: ${stat.avgSellPercentOfBuy.toFixed(2)}%`;
            card.appendChild(percentEl);
        }
        
        if (stat.avgHoldingTime !== null && stat.avgHoldingTime !== undefined) {
            const timeEl = document.createElement('div');
            timeEl.style.cssText = 'font-size: 0.75rem; color: #94a3b8;';
            timeEl.textContent = `Avg Holding Time: ${formatDuration(stat.avgHoldingTime)}`;
            card.appendChild(timeEl);
        }
        
        container.appendChild(card);
    });
}

/**
 * Sort filtered data based on current sort column and direction
 */
function sortFilteredData() {
    if (!filteredData || filteredData.length === 0) {
        return;
    }
    
    // If no sort column, restore original order from dashboardData
    if (!sortColumn) {
        // Restore filteredData to original order from dashboardData
        filteredData = [...dashboardData];
        sortSellIndex = null; // Clear sell index when no sort
        return;
    }
    
    // Check if it's a base column or sell column
    const isBaseColumn = COLUMN_DEFINITIONS.some(col => col.key === sortColumn);
    const isSellColumn = SELL_COLUMN_DEFINITIONS.some(col => col.key === sortColumn);
    
    if (!isBaseColumn && !isSellColumn) {
        return;
    }
    
    filteredData.sort((a, b) => {
        let aValue, bValue;
        
        if (isBaseColumn) {
            // Get raw value for base column
            aValue = getRawValue(a, sortColumn);
            bValue = getRawValue(b, sortColumn);
        } else {
            // For sell columns, use the specific sell index that was clicked
            const sellIndex = sortSellIndex !== null ? sortSellIndex : 0; // Default to first sell if not set
            const aSell = a.sells && a.sells[sellIndex];
            const bSell = b.sells && b.sells[sellIndex];
            aValue = aSell ? getRawSellValue(aSell, sortColumn) : null;
            bValue = bSell ? getRawSellValue(bSell, sortColumn) : null;
        }
        
        // Handle null/undefined values - bring them to bottom (asc) or top (desc)
        // Special handling for sellNumber: group all non-null values together
        if (sortColumn === 'sellNumber') {
            // If both are null, keep order
            if (aValue === null && bValue === null) return 0;
            // If one is null, it goes to bottom (asc) or top (desc)
            if (aValue === null) return sortDirection === 'asc' ? 1 : -1;
            if (bValue === null) return sortDirection === 'asc' ? -1 : 1;
        } else {
            // For other columns, handle nulls normally
            if (aValue === null || aValue === undefined) {
                return sortDirection === 'asc' ? 1 : -1;
            }
            if (bValue === null || bValue === undefined) {
                return sortDirection === 'asc' ? -1 : 1;
            }
        }
        
        // Compare values
        let comparison = 0;
        if (typeof aValue === 'number' && typeof bValue === 'number') {
            comparison = aValue - bValue;
        } else if (typeof aValue === 'string' && typeof bValue === 'string') {
            comparison = aValue.localeCompare(bValue);
        } else {
            // Convert to string for comparison
            comparison = String(aValue).localeCompare(String(bValue));
        }
        
        return sortDirection === 'asc' ? comparison : -comparison;
    });
}

/**
 * Get raw value for a base column key
 */
function getRawValue(token, key) {
    switch(key) {
        case 'pnlSOL': return token.pnlSOL;
        case 'pnlPercent': return token.pnlPercent;
        case 'tokenName': return token.tokenName || '';
        case 'tokenSymbol': return token.tokenSymbol || '';
        case 'tokenAddress': return token.tokenAddress || '';
        case 'creatorAddress': return token.creatorAddress || '';
        case 'numberOfSocials': return token.numberOfSocials || 0;
        case 'devBuyAmountSOL': return token.devBuyAmountSOL;
        case 'walletBuyAmountSOL': return token.walletBuyAmountSOL;
        case 'walletBuySOLPercentOfDev': return token.walletBuySOLPercentOfDev;
        case 'devBuyAmountTokens': return token.devBuyAmountTokens;
        case 'walletBuyAmountTokens': return token.walletBuyAmountTokens;
        case 'walletBuyTokensPercentOfDev': return token.walletBuyTokensPercentOfDev;
        case 'devBuyTokensPercentOfTotalSupply': return token.devBuyTokensPercentOfTotalSupply;
        case 'walletBuyPercentOfTotalSupply': return token.walletBuyPercentOfTotalSupply;
        case 'walletBuyPercentOfRemainingSupply': return token.walletBuyPercentOfRemainingSupply;
        case 'tokenPeakPriceBeforeFirstSell': return token.tokenPeakPriceBeforeFirstSell;
        case 'tokenPeakPrice10sAfterFirstSell': return token.tokenPeakPrice10sAfterFirstSell;
        case 'tokenPeakMarketCapBeforeFirstSell': return token.tokenPeakMarketCapBeforeFirstSell;
        case 'tokenPeakMarketCap10sAfterFirstSell': return token.tokenPeakMarketCap10sAfterFirstSell;
        case 'walletBuyPositionAfterDev': return token.walletBuyPositionAfterDev;
        case 'walletBuyBlockNumber': return token.walletBuyBlockNumber;
        case 'walletBuyBlockNumberAfterDev': return token.walletBuyBlockNumberAfterDev;
        case 'walletBuyTimestamp': return token.walletBuyTimestamp || '';
        case 'walletBuyMarketCap': return token.walletBuyMarketCap;
        case 'walletGasAndFeesAmount': return token.walletGasAndFeesAmount;
        case 'transactionSignature': return token.transactionSignature || '';
        case 'buysBeforeFirstSell': return token.buysBeforeFirstSell;
        case 'buysAfterFirstSell': return token.buysAfterFirstSell;
        default: return null;
    }
}

/**
 * Get raw value for a sell column key
 */
function getRawSellValue(sell, key) {
    switch(key) {
        case 'sellNumber': return sell.sellNumber;
        case 'sellMarketCap': return sell.marketCap;
        case 'sellPNL': return sell.firstSellPNL;
        case 'sellPercentOfBuy': return sell.sellPercentOfBuy;
        case 'sellAmountSOL': return sell.sellAmountSOL;
        case 'sellAmountTokens': return sell.sellAmountTokens;
        case 'sellTransactionSignature': return sell.transactionSignature || '';
        case 'sellTimestamp': return sell.timestamp || '';
        case 'devStillHolding': 
            if (sell.devStillHolding === null || sell.devStillHolding === undefined) return null;
            return sell.devStillHolding;
        default: return null;
    }
}

/**
 * Create a sortable table header
 */
function createSortableHeader(label, columnKey, isSellColumn, sellIndex = null) {
    const th = document.createElement('th');
    th.style.cssText = 'padding: 12px; border: 1px solid #334155; background: #1a1f2e; color: #e0e7ff; font-weight: 600; text-align: center; white-space: nowrap; cursor: pointer; user-select: none; position: sticky; top: 0; z-index: 10;';
    
    // Create container for label and sort indicator
    const container = document.createElement('div');
    container.style.cssText = 'display: flex; align-items: center; justify-content: center; gap: 6px;';
    
    // Label
    const labelSpan = document.createElement('span');
    labelSpan.textContent = label;
    container.appendChild(labelSpan);
    
    // Sort indicator
    const sortIndicator = document.createElement('span');
    sortIndicator.style.cssText = 'font-size: 0.75rem; color: #94a3b8;';
    
    // Check if this column is currently sorted
    // For sell columns, also check if the sell index matches
    const isCurrentSort = isSellColumn 
        ? (sortColumn === columnKey && sortSellIndex === sellIndex)
        : (sortColumn === columnKey);
    if (isCurrentSort) {
        sortIndicator.textContent = sortDirection === 'asc' ? '▲' : '▼';
        sortIndicator.style.color = '#3b82f6';
        sortIndicator.style.opacity = '1';
    } else {
        sortIndicator.textContent = '⇅';
        sortIndicator.style.opacity = '0.3';
    }
    
    container.appendChild(sortIndicator);
    th.appendChild(container);
    
    // Add hover effect
    th.addEventListener('mouseenter', () => {
        th.style.background = '#253548';
        if (!isCurrentSort) {
            sortIndicator.style.opacity = '0.6';
        }
    });
    
    th.addEventListener('mouseleave', () => {
        th.style.background = '#1a1f2e';
        if (!isCurrentSort) {
            sortIndicator.style.opacity = '0.3';
        }
    });
    
    // Add click handler
    th.addEventListener('click', () => {
        // For sell columns, check if this is the same column and sell index
        const isSameSellColumn = isSellColumn && sortColumn === columnKey && sortSellIndex === sellIndex;
        
        // Cycle through: asc -> desc -> no sort -> asc...
        if (isSameSellColumn || (!isSellColumn && sortColumn === columnKey)) {
            // Same column: cycle through states
            if (sortDirection === 'asc') {
                sortDirection = 'desc';
            } else if (sortDirection === 'desc') {
                // Reset to no sort
                sortColumn = null;
                sortDirection = 'asc';
                sortSellIndex = null;
            }
        } else {
            // Different column: set to ascending
            sortColumn = columnKey;
            sortDirection = 'asc';
            // For sell columns, store the sell index
            if (isSellColumn && sellIndex !== null) {
                sortSellIndex = sellIndex;
            } else {
                sortSellIndex = null;
            }
        }
        
        // Reset to first page when sorting changes
        currentPage = 1;
        
        // Re-render table
        renderDashboardTable();
    });
    
    return th;
}

/**
 * Clear all dashboard data and UI elements
 */
/**
 * Toggle what-if mode
 */
window.toggleWhatIfMode = function() {
    const toggle = document.getElementById('whatIfModeToggle');
    const controls = document.getElementById('whatIfControls');
    if (!toggle || !controls) return;
    
    whatIfModeEnabled = toggle.checked;
    controls.style.display = whatIfModeEnabled ? 'block' : 'none';
    
    if (!whatIfModeEnabled) {
        // Reset what-if data when disabling
        whatIfData = [];
        whatIfParams = { firstSellTimeAdjustment: null, setAllSellsTo: null };
        // Re-render table without what-if columns
        renderDashboardTable();
    }
};

/**
 * Calculate what-if PNL
 */
window.calculateWhatIf = async function() {
    const select = document.getElementById('dashboardWalletSelect');
    if (!select || !select.value) {
        alert('Please select a wallet first');
        return;
    }
    
    const walletAddress = select.value;
    const firstSellAdjustmentInput = document.getElementById('firstSellTimeAdjustment');
    const setAllSellsInput = document.getElementById('setAllSellsTo');
    
    let firstSellTimeAdjustment = null;
    let setAllSellsTo = null;
    
    if (firstSellAdjustmentInput && firstSellAdjustmentInput.value !== '') {
        firstSellTimeAdjustment = parseFloat(firstSellAdjustmentInput.value);
        if (isNaN(firstSellTimeAdjustment)) {
            alert('Invalid first sell time adjustment value');
            return;
        }
    }
    
    if (setAllSellsInput && setAllSellsInput.value !== '') {
        setAllSellsTo = parseFloat(setAllSellsInput.value);
        if (isNaN(setAllSellsTo)) {
            alert('Invalid set all sells to value');
            return;
        }
    }
    
    if (firstSellTimeAdjustment === null && setAllSellsTo === null) {
        alert('Please provide at least one adjustment value');
        return;
    }
    
    // Store params
    whatIfParams = { firstSellTimeAdjustment, setAllSellsTo };
    
    // Show loading
    const calculateBtn = event?.target || document.querySelector('button[onclick*="calculateWhatIf"]');
    if (calculateBtn) {
        calculateBtn.disabled = true;
        calculateBtn.textContent = '⏳ Calculating...';
    }
    
    try {
        const result = await api.calculateWhatIf(walletAddress, firstSellTimeAdjustment, setAllSellsTo);
        if (result.success) {
            whatIfData = result.whatIfData || [];
            // Re-render table with what-if columns
            renderDashboardTable();
        } else {
            alert(`Error: ${result.error || 'Failed to calculate what-if PNL'}`);
        }
    } catch (error) {
        console.error('Error calculating what-if:', error);
        alert(`Error: ${error.message || 'Failed to calculate what-if PNL'}`);
    } finally {
        if (calculateBtn) {
            calculateBtn.disabled = false;
            calculateBtn.innerHTML = '<span>🔮</span> Calculate What-If';
        }
    }
};

/**
 * Reset what-if mode
 */
window.resetWhatIf = function() {
    const toggle = document.getElementById('whatIfModeToggle');
    const firstSellAdjustmentInput = document.getElementById('firstSellTimeAdjustment');
    const setAllSellsInput = document.getElementById('setAllSellsTo');
    
    if (toggle) toggle.checked = false;
    if (firstSellAdjustmentInput) firstSellAdjustmentInput.value = '';
    if (setAllSellsInput) setAllSellsInput.value = '';
    
    whatIfModeEnabled = false;
    whatIfData = [];
    whatIfParams = { firstSellTimeAdjustment: null, setAllSellsTo: null };
    
    const controls = document.getElementById('whatIfControls');
    if (controls) controls.style.display = 'none';
    
    // Re-render table without what-if columns
    renderDashboardTable();
};

/**
 * Get what-if data for a token
 */
function getWhatIfDataForToken(tokenAddress) {
    if (!whatIfModeEnabled || !whatIfData || whatIfData.length === 0) {
        return null;
    }
    return whatIfData.find(item => item.tokenAddress === tokenAddress) || null;
}

export function clearDashboardData() {
    // Clear table content
    const thead = document.getElementById('dashboardTableHead');
    const tbody = document.getElementById('dashboardTableBody');
    if (thead) thead.innerHTML = '';
    if (tbody) tbody.innerHTML = '';
    
    // Clear data variables
    dashboardData = [];
    filteredData = [];
    
    // Clear average data points
    const statIds = ['walletSolBalance', 'totalWalletPNL', 'cumulativePNL', 'riskRewardProfit', 'netInvested', 
                    'walletAvgBuySize', 'devAvgBuySize', 'avgPNLPerToken'];
    statIds.forEach(id => {
        const el = document.getElementById(id);
        if (el) {
            el.textContent = '-';
        }
    });
    
    // Clear total buys, total sells
    const totalBuysEl = document.getElementById('totalBuys');
    if (totalBuysEl) {
        totalBuysEl.textContent = '-';
    }
    const totalSellsEl = document.getElementById('totalSells');
    if (totalSellsEl) {
        totalSellsEl.textContent = '-';
    }
    const averageOpenPositionEl = document.getElementById('averageOpenPosition');
    if (averageOpenPositionEl) {
        averageOpenPositionEl.textContent = '-';
    }
    
    // Clear sell statistics container
    const sellStatsContainer = document.getElementById('sellStatisticsContainer');
    if (sellStatsContainer) {
        sellStatsContainer.innerHTML = '';
    }
    
    // Clear total SOL sold display
    const totalSolSoldEl = document.getElementById('totalSolSoldValue');
    if (totalSolSoldEl) {
        totalSolSoldEl.textContent = '-';
        totalSolSoldEl.style.color = '#94a3b8';
    }
    
    // Clear pagination container
    const paginationContainer = document.getElementById('dashboardPaginationContainer');
    if (paginationContainer) {
        paginationContainer.innerHTML = '';
    }
    
    // Reset variables
    totalBuys = 0;
    totalSells = 0;
    averageOpenPosition = 0;
    maxSells = 0;
    currentPage = 1;
}

// Track if a refresh is in progress to prevent multiple simultaneous refreshes
let isRefreshing = false;

/**
 * Load dashboard data for selected wallet
 */
export async function loadDashboardData() {
    const select = document.getElementById('dashboardWalletSelect');
    if (!select) return;
    
    const walletAddress = select.value;
    
    // Save selection to state
    const { state } = await import('./state.js');
    state.selectedWalletForDashboard = walletAddress || null;
    if (!walletAddress) {
        clearDashboardData();
        const loadingEl = document.getElementById('dashboardTableLoading');
        const tableEl = document.getElementById('dashboardTable');
        if (loadingEl) {
            loadingEl.textContent = 'Select a wallet to load dashboard data';
            loadingEl.style.display = 'block';
        }
        if (tableEl) {
            tableEl.style.display = 'none';
        }
        // Clear pagination
        const paginationContainer = document.getElementById('dashboardPaginationContainer');
        if (paginationContainer) {
            paginationContainer.innerHTML = '';
        }
        return;
    }
    
    // Prevent multiple simultaneous refreshes
    if (isRefreshing) {
        return;
    }
    
    isRefreshing = true;
    
    // Show subtle loading indicator without clearing the table
    const loadingEl = document.getElementById('dashboardTableLoading');
    const tableEl = document.getElementById('dashboardTable');
    
    // // Keep table visible but add a subtle overlay or indicator
    // if (loadingEl) {
    //     loadingEl.textContent = 'Refreshing...';
    //     loadingEl.style.display = 'block';
    // }
    
    // Add a subtle opacity to indicate loading without hiding the table
    if (tableEl && tableEl.style.display !== 'none') {
        tableEl.style.opacity = '0.7';
        tableEl.style.transition = 'opacity 0.3s ease';
    }
    
    try {
        // Load statistics from ALL data (not filtered/paginated)
        await updateStatisticsFromBackend();
        
        // Load dashboard data with current filters
        const result = await api.fetchDashboardData(walletAddress, currentPage, itemsPerPage, activeFilters);
        if (result.success && result.data) {
            // Update data smoothly
            dashboardData = result.data;
            filteredData = [...result.data]; // Create a copy to preserve original order when sorting is reset
            
            // Store pagination info from backend
            totalCount = result.totalCount || 0;
            totalPages = result.totalPages || 1;
            currentPage = result.page || currentPage;
            
            // Store total buys/sells counts (from ALL data, not paginated)
            totalBuys = result.totalBuys || 0;
            totalSells = result.totalSells || 0;
            
            // Store average open position (from ALL data, not paginated)
            averageOpenPosition = result.averageOpenPosition || 0;
            
            // Update total buys display smoothly
            const totalBuysEl = document.getElementById('totalBuys');
            if (totalBuysEl) {
                totalBuysEl.style.transition = 'opacity 0.3s ease';
                totalBuysEl.style.opacity = '0.5';
                setTimeout(() => {
                    totalBuysEl.textContent = totalBuys.toString();
                    totalBuysEl.style.color = '#e0e7ff';
                    totalBuysEl.style.opacity = '1';
                }, 150);
            }
            
            // Update total sells display smoothly
            const totalSellsEl = document.getElementById('totalSells');
            if (totalSellsEl) {
                totalSellsEl.style.transition = 'opacity 0.3s ease';
                totalSellsEl.style.opacity = '0.5';
                setTimeout(() => {
                    totalSellsEl.textContent = totalSells.toString();
                    totalSellsEl.style.color = '#e0e7ff';
                    totalSellsEl.style.opacity = '1';
                }, 150);
            }
            
            // Update average open position display smoothly
            const averageOpenPositionEl = document.getElementById('averageOpenPosition');
            if (averageOpenPositionEl) {
                averageOpenPositionEl.style.transition = 'opacity 0.3s ease';
                averageOpenPositionEl.style.opacity = '0.5';
                setTimeout(() => {
                    const formattedValue = averageOpenPosition > 0 ? averageOpenPosition.toFixed(2) : '0';
                    averageOpenPositionEl.textContent = formattedValue;
                    averageOpenPositionEl.style.color = '#e0e7ff';
                    averageOpenPositionEl.style.opacity = '1';
                }, 150);
            }
            
            // Calculate max sells across current page tokens
            maxSells = Math.max(...dashboardData.map(token => (token.sells || []).length), 0);
            
            // Sort and render table (filters already applied from backend)
            sortFilteredData();
            renderDashboardTable();
            
            // Smoothly restore table opacity
            if (tableEl) {
                setTimeout(() => {
                    tableEl.style.opacity = '1';
                    tableEl.style.transition = 'opacity 0.3s ease';
                }, 100);
            }
            
            // Hide loading indicator
            if (loadingEl) {
                loadingEl.style.display = 'none';
            }
            
            // Ensure table is visible
            if (tableEl) {
                tableEl.style.display = 'table';
            }
        } else {
            // On error, restore table opacity
            if (tableEl) {
                tableEl.style.opacity = '1';
            }
            if (loadingEl) {
                loadingEl.textContent = result.error || 'Failed to load dashboard data';
                loadingEl.style.display = 'block';
            }
        }
    } catch (error) {
        console.error('Error loading dashboard data:', error);
        // On error, restore table opacity
        if (tableEl) {
            tableEl.style.opacity = '1';
        }
        if (loadingEl) {
            loadingEl.textContent = 'Error loading dashboard data: ' + error.message;
            loadingEl.style.display = 'block';
        }
    } finally {
        isRefreshing = false;
    }
}

/**
 * Update wallet statistics - now uses backend data from ALL tokens (not filtered/paginated)
 * This function is kept for backward compatibility but statistics come from backend
 */
function updateAverageDataPoints() {
    // Statistics are now loaded from backend via updateStatisticsFromBackend()
    // This function is kept for compatibility but does nothing
}

/**
 * Format duration in seconds to human-readable format
 */
function formatDuration(seconds) {
    if (!seconds || seconds < 0) return '-';
    
    const days = Math.floor(seconds / 86400);
    const hours = Math.floor((seconds % 86400) / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    const secs = seconds % 60;
    
    if (days > 0) {
        return `${days}d ${hours}h ${minutes}m`;
    } else if (hours > 0) {
        return `${hours}h ${minutes}m ${secs}s`;
    } else if (minutes > 0) {
        return `${minutes}m ${secs}s`;
    } else {
        return `${secs}s`;
    }
}

/**
 * Update sell statistics - now uses backend data from ALL tokens (not filtered/paginated)
 * This function is kept for backward compatibility but statistics come from backend
 */
function updateSellStatistics() {
    // Statistics are now loaded from backend via updateSellStatisticsFromBackend()
    // This function is kept for compatibility but does nothing
}

/**
 * Render dashboard table
 */
function renderDashboardTable() {
    const thead = document.getElementById('dashboardTableHead');
    const tbody = document.getElementById('dashboardTableBody');
    
    if (!thead || !tbody) return;
    
    // Ensure currentPage is valid (based on backend pagination)
    if (currentPage > totalPages) {
        currentPage = totalPages;
    }
    if (currentPage < 1) {
        currentPage = 1;
    }
    
    // Sort filtered data (client-side sorting on current page)
    sortFilteredData();
    
    // Use filtered data directly (already paginated from backend)
    // Note: Filters are applied client-side on the current page
    const dataToRender = filteredData;
    
    // Get visible columns based on visibility settings
    const visibleColumns = COLUMN_DEFINITIONS.filter(col => columnVisibility[col.key] !== false);
    
    // Build header row with only visible columns
    const baseHeaders = visibleColumns.map(col => col.label);
    
    // Add sell columns for each sell (up to maxSells) - only visible ones
    const sellHeaders = [];
    const visibleSellColumns = SELL_COLUMN_DEFINITIONS.filter(col => sellColumnVisibility[col.key] !== false);
    
    for (let i = 1; i <= maxSells; i++) {
        visibleSellColumns.forEach(col => {
            let headerLabel = '';
            switch(col.key) {
                case 'sellNumber':
                    headerLabel = `Wallet Sell Number ${i}`;
                    break;
                case 'sellMarketCap':
                    headerLabel = `Wallet Sell Market Cap ${i}`;
                    break;
                case 'sellPNL':
                    headerLabel = `${i === 1 ? 'First' : i === 2 ? '2nd' : i === 3 ? '3rd' : `${i}th`} Sell PNL`;
                    break;
                case 'sellPercentOfBuy':
                    headerLabel = `Sell % of Buy ${i}`;
                    break;
                case 'sellAmountSOL':
                    headerLabel = `Wallet Sell Amount in SOL ${i}`;
                    break;
                case 'sellAmountTokens':
                    headerLabel = `Wallet Sell Amount in Tokens ${i}`;
                    break;
                case 'sellTransactionSignature':
                    headerLabel = `Transaction Signature ${i}`;
                    break;
                case 'sellTimestamp':
                    headerLabel = `Wallet Sell Timestamp ${i}`;
                    break;
                case 'devStillHolding':
                    headerLabel = `Dev Still Holding at ${i === 1 ? '1st' : i === 2 ? '2nd' : i === 3 ? '3rd' : `${i}th`} Sell`;
                    break;
            }
            if (headerLabel) {
                sellHeaders.push(headerLabel);
            }
        });
    }
    
    const headers = [...baseHeaders, ...sellHeaders];
    
    // Clear existing content
    thead.innerHTML = '';
    tbody.innerHTML = '';
    
    // Create header row with sortable headers
    const headerRow = document.createElement('tr');
    
    // Create base column headers
    let pnlColIndex = -1;
    visibleColumns.forEach((col, index) => {
        const th = createSortableHeader(col.label, col.key, false);
        headerRow.appendChild(th);
        if (col.key === 'pnlPercent') {
            pnlColIndex = index;
        }
    });
    
    // Add what-if headers after PNL columns if enabled
    if (whatIfModeEnabled && whatIfData.length > 0 && pnlColIndex >= 0) {
        const whatIfSolTh = document.createElement('th');
        whatIfSolTh.textContent = '🔮 What-If PNL (SOL)';
        whatIfSolTh.style.cssText = 'padding: 12px; text-align: left; background: #1a1f2e; color: #3b82f6; font-weight: 600; border-bottom: 2px solid #3b82f6; position: sticky; top: 0; z-index: 10;';
        headerRow.appendChild(whatIfSolTh);
        
        const whatIfPercentTh = document.createElement('th');
        whatIfPercentTh.textContent = '🔮 What-If PNL (%)';
        whatIfPercentTh.style.cssText = 'padding: 12px; text-align: left; background: #1a1f2e; color: #3b82f6; font-weight: 600; border-bottom: 2px solid #3b82f6; position: sticky; top: 0; z-index: 10;';
        headerRow.appendChild(whatIfPercentTh);
    }
    
    // Create sell column headers
    for (let i = 1; i <= maxSells; i++) {
        visibleSellColumns.forEach(col => {
            let headerLabel = '';
            switch(col.key) {
                case 'sellNumber':
                    headerLabel = `Wallet Sell Number ${i}`;
                    break;
                case 'sellMarketCap':
                    headerLabel = `Wallet Sell Market Cap ${i}`;
                    break;
                case 'sellPNL':
                    headerLabel = `${i === 1 ? 'First' : i === 2 ? '2nd' : i === 3 ? '3rd' : `${i}th`} Sell PNL`;
                    break;
                case 'sellPercentOfBuy':
                    headerLabel = `Sell % of Buy ${i}`;
                    break;
                case 'sellAmountSOL':
                    headerLabel = `Wallet Sell Amount in SOL ${i}`;
                    break;
                case 'sellAmountTokens':
                    headerLabel = `Wallet Sell Amount in Tokens ${i}`;
                    break;
                case 'sellTransactionSignature':
                    headerLabel = `Transaction Signature ${i}`;
                    break;
                case 'sellTimestamp':
                    headerLabel = `Wallet Sell Timestamp ${i}`;
                    break;
                case 'devStillHolding':
                    headerLabel = `Dev Still Holding at ${i === 1 ? '1st' : i === 2 ? '2nd' : i === 3 ? '3rd' : `${i}th`} Sell`;
                    break;
            }
            if (headerLabel) {
                // For sell columns, we'll sort by the first sell's value
                // Store sell index and column key in data attributes
                const th = createSortableHeader(headerLabel, col.key, true, i - 1);
                headerRow.appendChild(th);
            }
            
            // Add what-if sell headers if enabled
            if (whatIfModeEnabled && whatIfData.length > 0) {
                if (col.key === 'sellPNL') {
                    const whatIfTh = document.createElement('th');
                    whatIfTh.textContent = `🔮 What-If ${i === 1 ? 'First' : i === 2 ? '2nd' : i === 3 ? '3rd' : `${i}th`} Sell PNL`;
                    whatIfTh.style.cssText = 'padding: 12px; text-align: left; background: #1a1f2e; color: #3b82f6; font-weight: 600; border-bottom: 2px solid #3b82f6; position: sticky; top: 0; z-index: 10;';
                    headerRow.appendChild(whatIfTh);
                } else if (col.key === 'sellMarketCap') {
                    const whatIfTh = document.createElement('th');
                    whatIfTh.textContent = `🔮 What-If Sell Market Cap ${i}`;
                    whatIfTh.style.cssText = 'padding: 12px; text-align: left; background: #1a1f2e; color: #3b82f6; font-weight: 600; border-bottom: 2px solid #3b82f6; position: sticky; top: 0; z-index: 10;';
                    headerRow.appendChild(whatIfTh);
                }
            }
        });
    }
    
    thead.appendChild(headerRow);
    
    // Helper function to get cell value for a column key
    const getCellValue = (token, key) => {
        switch(key) {
            case 'pnlSOL': return formatNumber(token.pnlSOL, 4);
            case 'pnlPercent': return formatPercent(token.pnlPercent);
            case 'tokenName': return token.tokenName || 'Unknown';
            case 'tokenSymbol': return token.tokenSymbol || '???';
            case 'tokenAddress': return createLink(token.tokenAddress, `https://solscan.io/token/${token.tokenAddress}`, token.tokenAddress ? token.tokenAddress.substring(0, 8) + '...' : '');
            case 'creatorAddress': return createLink(token.creatorAddress, `https://solscan.io/account/${token.creatorAddress}`, token.creatorAddress || '');
            case 'numberOfSocials': return token.numberOfSocials || 0;
            case 'devBuyAmountSOL': return formatNumber(token.devBuyAmountSOL, 4);
            case 'walletBuyAmountSOL': return formatNumber(token.walletBuyAmountSOL, 4);
            case 'walletBuySOLPercentOfDev': return formatPercent(token.walletBuySOLPercentOfDev);
            case 'devBuyAmountTokens': return formatNumber(token.devBuyAmountTokens, 4);
            case 'walletBuyAmountTokens': return formatNumber(token.walletBuyAmountTokens, 4);
            case 'walletBuyTokensPercentOfDev': return formatPercent(token.walletBuyTokensPercentOfDev);
            case 'devBuyTokensPercentOfTotalSupply': return formatPercent(token.devBuyTokensPercentOfTotalSupply);
            case 'walletBuyPercentOfTotalSupply': return formatPercent(token.walletBuyPercentOfTotalSupply);
            case 'walletBuyPercentOfRemainingSupply': return formatPercent(token.walletBuyPercentOfRemainingSupply);
            case 'tokenPeakPriceBeforeFirstSell': {
                const price = formatNumber(token.tokenPeakPriceBeforeFirstSell, 10);
                const mcap = token.tokenPeakMarketCapBeforeFirstSell ? ` (MCap: $${formatNumber(token.tokenPeakMarketCapBeforeFirstSell, 2)})` : '';
                return price + mcap;
            }
            case 'tokenPeakPrice10sAfterFirstSell': {
                const price = formatNumber(token.tokenPeakPrice10sAfterFirstSell, 10);
                const mcap = token.tokenPeakMarketCap10sAfterFirstSell ? ` (MCap: $${formatNumber(token.tokenPeakMarketCap10sAfterFirstSell, 2)})` : '';
                return price + mcap;
            }
            case 'walletBuyPositionAfterDev': return token.walletBuyPositionAfterDev !== null ? `${token.walletBuyPositionAfterDev}ms` : '';
            case 'walletBuyBlockNumber': return token.walletBuyBlockNumber || '';
            case 'walletBuyBlockNumberAfterDev': return token.walletBuyBlockNumberAfterDev !== null ? token.walletBuyBlockNumberAfterDev : '';
            case 'walletBuyTimestamp': return token.walletBuyTimestamp || '';
            case 'walletBuyMarketCap': return formatNumber(token.walletBuyMarketCap, 2);
            case 'walletGasAndFeesAmount': return formatNumber(token.walletGasAndFeesAmount, 4);
            case 'transactionSignature': return createLink(token.transactionSignature, `https://solscan.io/tx/${token.transactionSignature}`, token.transactionSignature ? token.transactionSignature.substring(0, 8) + '...' : '');
            case 'buysBeforeFirstSell': {
                const value = token.buysBeforeFirstSell;
                return (value !== null && value !== undefined) ? value.toString() : '0';
            }
            case 'buysAfterFirstSell': {
                const value = token.buysAfterFirstSell;
                return (value !== null && value !== undefined) ? value.toString() : '0';
            }
            default: return '';
        }
    };
    
    // Create data rows
    dataToRender.forEach(token => {
        const row = document.createElement('tr');
        
        // Add default row styling
        row.style.cssText = 'cursor: pointer; transition: background-color 0.2s ease;';
        
        // Add hover effect
        row.addEventListener('mouseenter', () => {
            if (row !== selectedRowElement) {
                row.style.backgroundColor = '#253548';
            }
        });
        
        row.addEventListener('mouseleave', () => {
            if (row !== selectedRowElement) {
                row.style.backgroundColor = '';
            }
        });
        
        // Add click handler to highlight row
        row.addEventListener('click', () => {
            // If clicking the same row that's already selected, deselect it
            if (selectedRowElement === row) {
                row.style.backgroundColor = '';
                // Reset link colors
                const links = row.querySelectorAll('a');
                links.forEach(link => {
                    link.style.color = '#3b82f6';
                    link.style.textDecoration = 'none';
                });
                selectedRowElement = null;
                return;
            }
            
            // Remove highlight from previously selected row
            if (selectedRowElement) {
                selectedRowElement.style.backgroundColor = '';
                // Reset link colors in previously selected row
                const prevLinks = selectedRowElement.querySelectorAll('a');
                prevLinks.forEach(link => {
                    link.style.color = '#3b82f6';
                    link.style.textDecoration = 'none';
                });
            }
            
            // Highlight clicked row
            row.style.backgroundColor = '#3b82f6';
            // Change link colors in selected row to be more visible (white or light color)
            const links = row.querySelectorAll('a');
            links.forEach(link => {
                link.style.color = '#ffffff';
                link.style.textDecoration = 'underline';
            });
            selectedRowElement = row;
        });
        
        // Base columns - only visible ones
        let pnlColIndex = -1;
        visibleColumns.forEach((col, index) => {
            const cellContent = getCellValue(token, col.key);
            const td = document.createElement('td');
            if (typeof cellContent === 'string' && cellContent.includes('<a')) {
                td.innerHTML = cellContent;
            } else {
                td.textContent = cellContent;
            }
            td.style.cssText = 'padding: 10px; border: 1px solid #334155; color: #cbd5e1; text-align: center; white-space: nowrap;';
            row.appendChild(td);
            if (col.key === 'pnlPercent') {
                pnlColIndex = index;
            }
        });
        
        // Add what-if cells after PNL columns if enabled
        if (whatIfModeEnabled && whatIfData.length > 0 && pnlColIndex >= 0) {
            const whatIfTokenData = getWhatIfDataForToken(token.tokenAddress);
            if (whatIfTokenData) {
                // What-If PNL SOL
                const whatIfSolTd = document.createElement('td');
                whatIfSolTd.textContent = formatNumber(whatIfTokenData.whatIfPnlSOL, 4);
                whatIfSolTd.style.cssText = 'padding: 10px; border: 1px solid #3b82f6; color: #3b82f6; text-align: center; white-space: nowrap; font-weight: 600; background: rgba(59, 130, 246, 0.1);';
                row.appendChild(whatIfSolTd);
                
                // What-If PNL %
                const whatIfPercentTd = document.createElement('td');
                whatIfPercentTd.textContent = formatPercent(whatIfTokenData.whatIfPnlPercent);
                whatIfPercentTd.style.cssText = 'padding: 10px; border: 1px solid #3b82f6; color: #3b82f6; text-align: center; white-space: nowrap; font-weight: 600; background: rgba(59, 130, 246, 0.1);';
                row.appendChild(whatIfPercentTd);
            } else {
                // Empty cells if no what-if data for this token
                const emptyTd1 = document.createElement('td');
                emptyTd1.style.cssText = 'padding: 10px; border: 1px solid #334155; color: #64748b; text-align: center;';
                row.appendChild(emptyTd1);
                const emptyTd2 = document.createElement('td');
                emptyTd2.style.cssText = 'padding: 10px; border: 1px solid #334155; color: #64748b; text-align: center;';
                row.appendChild(emptyTd2);
            }
        }
        
        // Add sell columns - only visible ones
        const visibleSellColumns = SELL_COLUMN_DEFINITIONS.filter(col => sellColumnVisibility[col.key] !== false);
        
        for (let i = 0; i < maxSells; i++) {
            const sell = token.sells && token.sells[i];
            if (sell) {
                visibleSellColumns.forEach(col => {
                    let cellContent = '';
                    switch(col.key) {
                        case 'sellNumber':
                            cellContent = sell.sellNumber || '';
                            break;
                        case 'sellMarketCap':
                            cellContent = formatNumber(sell.marketCap, 2);
                            break;
                        case 'sellPNL':
                            cellContent = formatPercent(sell.firstSellPNL);
                            break;
                        case 'sellPercentOfBuy':
                            cellContent = formatPercent(sell.sellPercentOfBuy);
                            break;
                        case 'sellAmountSOL':
                            cellContent = formatNumber(sell.sellAmountSOL, 4);
                            break;
                        case 'sellAmountTokens':
                            cellContent = formatNumber(sell.sellAmountTokens, 4);
                            break;
                        case 'sellTransactionSignature':
                            cellContent = createLink(sell.transactionSignature, `https://solscan.io/tx/${sell.transactionSignature}`, sell.transactionSignature ? sell.transactionSignature.substring(0, 8) + '...' : '');
                            break;
                        case 'sellTimestamp':
                            cellContent = sell.timestamp || '';
                            break;
                        case 'devStillHolding':
                            if (sell.devStillHolding === null || sell.devStillHolding === undefined) {
                                cellContent = 'N/A';
                            } else {
                                cellContent = sell.devStillHolding ? 'Yes' : 'No';
                            }
                            break;
                    }
                    
                    const td = document.createElement('td');
                    // Add styling for devStillHolding
                    if (col.key === 'devStillHolding' && sell && sell.devStillHolding !== null && sell.devStillHolding !== undefined) {
                        if (sell.devStillHolding) {
                            td.style.color = '#10b981'; // Green for Yes
                        } else {
                            td.style.color = '#ef4444'; // Red for No
                        }
                    }
                    if (typeof cellContent === 'string' && cellContent.includes('<a')) {
                        td.innerHTML = cellContent;
                    } else {
                        td.textContent = cellContent;
                    }
                    td.style.cssText = 'padding: 10px; border: 1px solid #334155; color: #cbd5e1; text-align: center; white-space: nowrap;';
                    row.appendChild(td);
                    
                    // Add what-if sell cells if enabled
                    if (whatIfModeEnabled && whatIfData.length > 0) {
                        const whatIfTokenData = getWhatIfDataForToken(token.tokenAddress);
                        if (whatIfTokenData && whatIfTokenData.sells && whatIfTokenData.sells[i]) {
                            const whatIfSell = whatIfTokenData.sells[i];
                            if (col.key === 'sellPNL') {
                                const whatIfTd = document.createElement('td');
                                whatIfTd.textContent = formatPercent(whatIfSell.firstSellPNL);
                                whatIfTd.style.cssText = 'padding: 10px; border: 1px solid #3b82f6; color: #3b82f6; text-align: center; white-space: nowrap; font-weight: 600; background: rgba(59, 130, 246, 0.1);';
                                row.appendChild(whatIfTd);
                            } else if (col.key === 'sellMarketCap') {
                                const whatIfTd = document.createElement('td');
                                whatIfTd.textContent = formatNumber(whatIfSell.adjustedMarketCap, 2);
                                whatIfTd.style.cssText = 'padding: 10px; border: 1px solid #3b82f6; color: #3b82f6; text-align: center; white-space: nowrap; font-weight: 600; background: rgba(59, 130, 246, 0.1);';
                                row.appendChild(whatIfTd);
                            }
                        } else if (col.key === 'sellPNL' || col.key === 'sellMarketCap') {
                            // Empty what-if cell
                            const emptyTd = document.createElement('td');
                            emptyTd.style.cssText = 'padding: 10px; border: 1px solid #334155; color: #64748b; text-align: center;';
                            row.appendChild(emptyTd);
                        }
                    }
                });
            } else {
                // Empty cells for missing sells
                visibleSellColumns.forEach((col) => {
                    const td = document.createElement('td');
                    td.style.cssText = 'padding: 10px; border: 1px solid #334155; color: #64748b; text-align: center;';
                    row.appendChild(td);
                    
                    // Add empty what-if cells if enabled
                    if (whatIfModeEnabled && whatIfData.length > 0 && (col.key === 'sellPNL' || col.key === 'sellMarketCap')) {
                        const emptyTd = document.createElement('td');
                        emptyTd.style.cssText = 'padding: 10px; border: 1px solid #334155; color: #64748b; text-align: center;';
                        row.appendChild(emptyTd);
                    }
                });
            }
        }
        
        tbody.appendChild(row);
    });
    
    // Clear selected row when table is re-rendered (since rows are recreated)
    selectedRowElement = null;
    
    // Render pagination controls (using backend pagination info)
    const paginationStartIndex = (currentPage - 1) * itemsPerPage;
    const paginationEndIndex = Math.min(paginationStartIndex + dataToRender.length, totalCount);
    renderPagination(totalPages, totalCount, paginationStartIndex, paginationEndIndex);
}

/**
 * Render pagination controls
 */
function renderPagination(totalPages, totalItems, startIndex, endIndex) {
    const container = document.getElementById('dashboardPaginationContainer');
    if (!container) return;
    
    if (totalItems === 0) {
        container.innerHTML = '';
        return;
    }
    
    container.innerHTML = '';
    
    // Pagination info
    const info = document.createElement('div');
    info.style.cssText = 'display: flex; align-items: center; gap: 15px; flex-wrap: wrap; justify-content: space-between; padding: 15px; background: #1a1f2e; border-radius: 6px 0px; border: 1px solid #334155; border-bottom: 0px';
    
    // Left side - info
    const infoLeft = document.createElement('div');
    infoLeft.style.cssText = 'color: #94a3b8; font-size: 0.9rem;';
    infoLeft.textContent = `Showing ${startIndex + 1} to ${Math.min(endIndex, totalItems)} of ${totalItems} entries`;
    info.appendChild(infoLeft);
    
    // Right side - controls
    const controls = document.createElement('div');
    controls.style.cssText = 'display: flex; align-items: center; gap: 10px; flex-wrap: nowrap;';
    
    // Items per page selector - keep on one line
    const itemsPerPageContainer = document.createElement('div');
    itemsPerPageContainer.style.cssText = 'display: flex; align-items: center; gap: 8px; white-space: nowrap;';
    
    const itemsPerPageLabel = document.createElement('label');
    itemsPerPageLabel.style.cssText = 'color: #cbd5e1; font-size: 0.85rem; white-space: nowrap;';
    itemsPerPageLabel.textContent = 'Items per page:';
    itemsPerPageContainer.appendChild(itemsPerPageLabel);
    
    const itemsPerPageSelect = document.createElement('select');
    itemsPerPageSelect.style.cssText = 'padding: 6px 10px; border: 1px solid #334155; background: #0f1419; color: #e0e7ff; border-radius: 4px; font-size: 0.85rem; cursor: pointer;';
    [10, 25, 50, 100, 500, 1000].forEach(val => {
        const option = document.createElement('option');
        option.value = String(val);
        option.textContent = String(val);
        itemsPerPageSelect.appendChild(option);
    });
    // Set the value after options are added, as a string
    itemsPerPageSelect.value = String(itemsPerPage);
    itemsPerPageSelect.addEventListener('change', async (e) => {
        itemsPerPage = parseInt(e.target.value, 10);
        currentPage = 1;
        // Reload data from backend with new page size
        await loadDashboardData();
    });
    itemsPerPageContainer.appendChild(itemsPerPageSelect);
    controls.appendChild(itemsPerPageContainer);
    
    // Page navigation
    const nav = document.createElement('div');
    nav.style.cssText = 'display: flex; align-items: center; gap: 5px;';
    
    // First button
    const firstBtn = createPaginationButton('', currentPage === 1, async () => {
        currentPage = 1;
        await loadDashboardData();
    }, 'first');
    nav.appendChild(firstBtn);
    
    // Previous button
    const prevBtn = createPaginationButton('', currentPage === 1, async () => {
        if (currentPage > 1) {
            currentPage--;
            await loadDashboardData();
        }
    }, 'prev');
    nav.appendChild(prevBtn);
    
    // Page numbers
    const maxVisiblePages = 5;
    let startPage = Math.max(1, currentPage - Math.floor(maxVisiblePages / 2));
    let endPage = Math.min(totalPages, startPage + maxVisiblePages - 1);
    
    if (endPage - startPage < maxVisiblePages - 1) {
        startPage = Math.max(1, endPage - maxVisiblePages + 1);
    }
    
    if (startPage > 1) {
        const firstPageBtn = createPaginationButton('1', false, async () => {
            currentPage = 1;
            await loadDashboardData();
        });
        nav.appendChild(firstPageBtn);
        
        if (startPage > 2) {
            const ellipsis = document.createElement('span');
            ellipsis.textContent = '...';
            ellipsis.style.cssText = 'color: #94a3b8; padding: 0 5px;';
            nav.appendChild(ellipsis);
        }
    }
    
    for (let i = startPage; i <= endPage; i++) {
        const pageBtn = createPaginationButton(i.toString(), i === currentPage, async () => {
            currentPage = i;
            await loadDashboardData();
        });
        if (i === currentPage) {
            pageBtn.style.background = 'linear-gradient(135deg, #3b82f6 0%, #2563eb 100%)';
            pageBtn.style.color = 'white';
        }
        nav.appendChild(pageBtn);
    }
    
    if (endPage < totalPages) {
        if (endPage < totalPages - 1) {
            const ellipsis = document.createElement('span');
            ellipsis.textContent = '...';
            ellipsis.style.cssText = 'color: #94a3b8; padding: 0 5px;';
            nav.appendChild(ellipsis);
        }
        
        const lastPageBtn = createPaginationButton(totalPages.toString(), false, async () => {
            currentPage = totalPages;
            await loadDashboardData();
        });
        nav.appendChild(lastPageBtn);
    }
    
    // Next button
    const nextBtn = createPaginationButton('', currentPage === totalPages, async () => {
        if (currentPage < totalPages) {
            currentPage++;
            await loadDashboardData();
        }
    }, 'next');
    nav.appendChild(nextBtn);
    
    // Last button
    const lastBtn = createPaginationButton('', currentPage === totalPages, async () => {
        currentPage = totalPages;
        await loadDashboardData();
    }, 'last');
    nav.appendChild(lastBtn);
    
    controls.appendChild(nav);
    info.appendChild(controls);
    container.appendChild(info);
}

/**
 * Create SVG icon for pagination
 */
function createPaginationIcon(type) {
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('width', '14');
    svg.setAttribute('height', '14');
    svg.setAttribute('viewBox', '0 0 14 14');
    svg.setAttribute('fill', 'none');
    svg.setAttribute('stroke', 'currentColor');
    svg.setAttribute('stroke-width', '2');
    svg.setAttribute('stroke-linecap', 'round');
    svg.setAttribute('stroke-linejoin', 'round');
    svg.style.cssText = 'display: block;';
    
    switch(type) {
        case 'first':
            // << (double left chevron)
            const first1 = document.createElementNS('http://www.w3.org/2000/svg', 'path');
            first1.setAttribute('d', 'M9 2 L5 7 L9 12');
            svg.appendChild(first1);
            const first2 = document.createElementNS('http://www.w3.org/2000/svg', 'path');
            first2.setAttribute('d', 'M7 2 L3 7 L7 12');
            svg.appendChild(first2);
            break;
        case 'prev':
            // < (single left chevron)
            const prev = document.createElementNS('http://www.w3.org/2000/svg', 'path');
            prev.setAttribute('d', 'M9 2 L5 7 L9 12');
            svg.appendChild(prev);
            break;
        case 'next':
            // > (single right chevron)
            const next = document.createElementNS('http://www.w3.org/2000/svg', 'path');
            next.setAttribute('d', 'M5 2 L9 7 L5 12');
            svg.appendChild(next);
            break;
        case 'last':
            // >> (double right chevron)
            const last1 = document.createElementNS('http://www.w3.org/2000/svg', 'path');
            last1.setAttribute('d', 'M5 2 L9 7 L5 12');
            svg.appendChild(last1);
            const last2 = document.createElementNS('http://www.w3.org/2000/svg', 'path');
            last2.setAttribute('d', 'M7 2 L11 7 L7 12');
            svg.appendChild(last2);
            break;
    }
    
    return svg;
}

/**
 * Create a pagination button
 */
function createPaginationButton(text, disabled, onClick, iconType = null) {
    const btn = document.createElement('button');
    btn.style.cssText = 'padding: 6px 12px; border: 1px solid #334155; background: #1a1f2e; color: #e0e7ff; border-radius: 4px; cursor: pointer; font-size: 0.85rem; min-width: 36px; transition: all 0.2s; display: flex; align-items: center; justify-content: center;';
    
    if (iconType) {
        // Use SVG icon
        const icon = createPaginationIcon(iconType);
        btn.appendChild(icon);
    } else {
        // Use text for page numbers
        btn.textContent = text;
    }
    
    if (disabled) {
        btn.disabled = true;
        btn.style.opacity = '0.5';
        btn.style.cursor = 'not-allowed';
    } else {
        btn.addEventListener('mouseenter', () => {
            btn.style.background = '#334155';
        });
        btn.addEventListener('mouseleave', () => {
            btn.style.background = '#1a1f2e';
        });
        btn.addEventListener('click', onClick);
    }
    
    return btn;
}

/**
 * Format number with decimal places
 */
function formatNumber(value, decimals = 2) {
    if (value === null || value === undefined || value === '') return '';
    const num = parseFloat(value);
    if (isNaN(num)) return '';
    return num.toFixed(decimals);
}

/**
 * Format percentage
 */
function formatPercent(value) {
    if (value === null || value === undefined || value === '') return '';
    const num = parseFloat(value);
    if (isNaN(num)) return '';
    return `${num.toFixed(2)}%`;
}

/**
 * Create link element
 */
function createLink(href, url, text) {
    if (!href || !url) return text || '';
    return `<a href="${url}" target="_blank" rel="noopener noreferrer" style="color: #3b82f6; text-decoration: none;">${text || href}</a>`;
}

/**
 * Load filter presets into dropdown
 */
async function loadFilterPresets() {
    try {
        const result = await api.fetchDashboardFilterPresets();
        const select = document.getElementById('filterPresetSelect');
        if (select && result.success) {
            select.innerHTML = '<option value="">-- Select a preset --</option>';
            result.presets.forEach(preset => {
                const option = document.createElement('option');
                option.value = preset.name;
                option.textContent = preset.name;
                select.appendChild(option);
            });
        }
    } catch (error) {
        console.error('Failed to load filter presets:', error);
    }
}

/**
 * Load filter preset
 */
window.loadFilterPreset = async function() {
    const select = document.getElementById('filterPresetSelect');
    if (!select || !select.value) {
        const { showNotification } = await import('./utils.js');
        showNotification('Please select a preset first', 'error');
        return;
    }
    
    try {
        const result = await api.fetchDashboardFilterPreset(select.value);
        if (result.success && result.preset) {
            const preset = result.preset;
            
            // Clear existing filters
            activeFilters = [];
            
            // Load filters from preset
            // Support both old format (for backward compatibility) and new format
            if (preset.filters && Array.isArray(preset.filters)) {
                // New format: array of filter objects
                activeFilters = preset.filters.map(filter => {
                    const filterObj = {
                        id: Date.now() + Math.random(), // Generate new unique ID
                        key: filter.key,
                        label: filter.label || DATA_POINTS.find(dp => dp.key === filter.key)?.label || filter.key,
                        type: filter.type || DATA_POINTS.find(dp => dp.key === filter.key)?.type || 'sol',
                        min: filter.min !== null && filter.min !== undefined ? parseFloat(filter.min) : null,
                        max: filter.max !== null && filter.max !== undefined ? parseFloat(filter.max) : null,
                        minEnabled: filter.minEnabled !== false,
                        maxEnabled: filter.maxEnabled !== false
                    };
                    // Include sellNumber if present (for sell filters)
                    if (filter.sellNumber !== null && filter.sellNumber !== undefined) {
                        filterObj.sellNumber = parseInt(filter.sellNumber);
                    }
                    return filterObj;
                });
            } else {
                // Old format: individual filter properties (backward compatibility)
                // Convert old format to new format
                if (preset.devBuySizeMin !== null && preset.devBuySizeMin !== undefined) {
                    activeFilters.push({
                        key: 'devBuyAmountSOL',
                        label: 'Dev Buy Amount in SOL',
                        type: 'sol',
                        min: parseFloat(preset.devBuySizeMin),
                        max: parseFloat(preset.devBuySizeMax || 20),
                        minEnabled: true,
                        maxEnabled: true
                    });
                }
                if (preset.buySizeMin !== null && preset.buySizeMin !== undefined) {
                    activeFilters.push({
                        key: 'walletBuyAmountSOL',
                        label: 'Wallet Buy Amount in SOL',
                        type: 'sol',
                        min: parseFloat(preset.buySizeMin),
                        max: parseFloat(preset.buySizeMax || 20),
                        minEnabled: true,
                        maxEnabled: true
                    });
                }
                if (preset.pnlMin !== null && preset.pnlMin !== undefined) {
                    activeFilters.push({
                        key: 'pnlPercent',
                        label: '% PNL per token',
                        type: 'percent',
                        min: parseFloat(preset.pnlMin),
                        max: parseFloat(preset.pnlMax || 100),
                        minEnabled: true,
                        maxEnabled: true
                    });
                }
            }
            
            // Render filters
            renderFilters();
            
            // Restore column visibility if present in preset
            if (preset.columnVisibility) {
                columnVisibility = { ...preset.columnVisibility };
                // Ensure all columns have a visibility setting (default to true if missing)
                COLUMN_DEFINITIONS.forEach(col => {
                    if (columnVisibility[col.key] === undefined) {
                        columnVisibility[col.key] = true;
                    }
                });
            }
            if (preset.sellColumnVisibility) {
                sellColumnVisibility = { ...preset.sellColumnVisibility };
                // Ensure all sell columns have a visibility setting (default to true if missing)
                SELL_COLUMN_DEFINITIONS.forEach(col => {
                    if (sellColumnVisibility[col.key] === undefined) {
                        sellColumnVisibility[col.key] = true;
                    }
                });
            }
            
            // Save column visibility to localStorage
            saveColumnVisibility();
            
            // Apply column visibility to the table
            renderDashboardTable();
            
            // Don't auto-apply, wait for user to click "Apply Filters" button
            
            const { showNotification } = await import('./utils.js');
            showNotification('Filter preset loaded successfully. Click "Apply Filters" to apply.', 'success');
        } else {
            const { showNotification } = await import('./utils.js');
            showNotification(result.error || 'Failed to load preset', 'error');
        }
    } catch (error) {
        console.error('Error loading filter preset:', error);
        const { showNotification } = await import('./utils.js');
        showNotification('Error loading filter preset: ' + error.message, 'error');
    }
};

/**
 * Open save preset modal
 */
window.openSavePresetModal = function() {
    const modal = document.getElementById('savePresetModal');
    const nameInput = document.getElementById('savePresetNameInput');
    if (modal) {
        modal.classList.add('active');
        // Clear input and focus it
        if (nameInput) {
            nameInput.value = '';
            setTimeout(() => {
                nameInput.focus();
                // Add keyboard event listeners
                const handleKeyDown = (e) => {
                    if (e.key === 'Enter') {
                        e.preventDefault();
                        window.confirmSavePreset();
                    } else if (e.key === 'Escape') {
                        e.preventDefault();
                        window.closeSavePresetModal();
                    }
                };
                nameInput.addEventListener('keydown', handleKeyDown);
                // Store handler for cleanup
                nameInput._savePresetKeyHandler = handleKeyDown;
            }, 100);
        }
        // Add click-outside-to-close functionality
        const handleOverlayClick = (e) => {
            if (e.target === modal) {
                window.closeSavePresetModal();
            }
        };
        modal.addEventListener('click', handleOverlayClick);
        modal._savePresetOverlayHandler = handleOverlayClick;
    }
};

/**
 * Close save preset modal
 */
window.closeSavePresetModal = function() {
    const modal = document.getElementById('savePresetModal');
    const nameInput = document.getElementById('savePresetNameInput');
    if (modal) {
        modal.classList.remove('active');
        // Clear input and remove event listeners when closing
        if (nameInput) {
            nameInput.value = '';
            if (nameInput._savePresetKeyHandler) {
                nameInput.removeEventListener('keydown', nameInput._savePresetKeyHandler);
                delete nameInput._savePresetKeyHandler;
            }
        }
        // Remove overlay click handler
        if (modal._savePresetOverlayHandler) {
            modal.removeEventListener('click', modal._savePresetOverlayHandler);
            delete modal._savePresetOverlayHandler;
        }
    }
};

/**
 * Confirm and save filter preset
 */
window.confirmSavePreset = async function() {
    const nameInput = document.getElementById('savePresetNameInput');
    if (!nameInput || !nameInput.value.trim()) {
        const { showNotification } = await import('./utils.js');
        showNotification('Please enter a preset name', 'error');
        return;
    }
    
    await window.saveFilterPreset();
};

/**
 * Save filter preset
 */
window.saveFilterPreset = async function() {
    const nameInput = document.getElementById('savePresetNameInput');
    if (!nameInput || !nameInput.value.trim()) {
        const { showNotification } = await import('./utils.js');
        showNotification('Please enter a preset name', 'error');
        return;
    }
    
    // Save filters in new format (array of filter objects)
    const filters = {
        filters: activeFilters.map(filter => {
            const filterObj = {
                key: filter.key,
                label: filter.label,
                type: filter.type,
                min: filter.min,
                max: filter.max,
                minEnabled: filter.minEnabled,
                maxEnabled: filter.maxEnabled
            };
            // Include sellNumber if present (for sell filters)
            if (filter.sellNumber !== null && filter.sellNumber !== undefined) {
                filterObj.sellNumber = filter.sellNumber;
            }
            return filterObj;
        })
    };
    
    // Also include old format for backward compatibility
    const oldFormatFilters = {};
    activeFilters.forEach(filter => {
        if (filter.key === 'devBuyAmountSOL') {
            oldFormatFilters.devBuySizeMin = filter.min;
            oldFormatFilters.devBuySizeMax = filter.max;
        } else if (filter.key === 'walletBuyAmountSOL') {
            oldFormatFilters.buySizeMin = filter.min;
            oldFormatFilters.buySizeMax = filter.max;
        } else if (filter.key === 'pnlPercent') {
            oldFormatFilters.pnlMin = filter.min;
            oldFormatFilters.pnlMax = filter.max;
        }
    });
    
    // Merge both formats
    const filtersToSave = { ...filters, ...oldFormatFilters };
    
    // Include column visibility in the preset
    filtersToSave.columnVisibility = { ...columnVisibility };
    filtersToSave.sellColumnVisibility = { ...sellColumnVisibility };
    
    try {
        const result = await api.saveDashboardFilterPreset(nameInput.value.trim(), filtersToSave);
        if (result.success) {
            // Reload presets dropdown
            await loadFilterPresets();
            
            // Close modal and clear input
            window.closeSavePresetModal();
            
            const { showNotification } = await import('./utils.js');
            showNotification('Filter preset saved successfully', 'success');
        } else {
            const { showNotification } = await import('./utils.js');
            showNotification(result.error || 'Failed to save preset', 'error');
        }
    } catch (error) {
        console.error('Error saving filter preset:', error);
        const { showNotification } = await import('./utils.js');
        showNotification('Error saving filter preset: ' + error.message, 'error');
    }
};

/**
 * Delete filter preset
 */
window.deleteFilterPreset = async function() {
    const select = document.getElementById('filterPresetSelect');
    if (!select || !select.value) {
        const { showNotification } = await import('./utils.js');
        showNotification('Please select a preset to delete', 'error');
        return;
    }
    
    if (!confirm(`Are you sure you want to delete the preset "${select.value}"?`)) {
        return;
    }
    
    try {
        const result = await api.deleteDashboardFilterPreset(select.value);
        if (result.success) {
            // Reload presets dropdown
            await loadFilterPresets();
            
            const { showNotification } = await import('./utils.js');
            showNotification('Filter preset deleted successfully', 'success');
        } else {
            const { showNotification } = await import('./utils.js');
            showNotification(result.error || 'Failed to delete preset', 'error');
        }
    } catch (error) {
        console.error('Error deleting filter preset:', error);
        const { showNotification } = await import('./utils.js');
        showNotification('Error deleting filter preset: ' + error.message, 'error');
    }
};

/**
 * Export dashboard table data to Excel
 */
/**
 * Get cell value for export (returns raw value, not formatted)
 */
function getCellValueForExport(token, key) {
    switch(key) {
        case 'pnlSOL': return token.pnlSOL !== null && token.pnlSOL !== undefined ? token.pnlSOL : '';
        case 'pnlPercent': return token.pnlPercent !== null && token.pnlPercent !== undefined ? token.pnlPercent : '';
        case 'tokenName': return token.tokenName || '';
        case 'tokenSymbol': return token.tokenSymbol || '';
        case 'tokenAddress': return token.tokenAddress || '';
        case 'creatorAddress': return token.creatorAddress || '';
        case 'numberOfSocials': return token.numberOfSocials || 0;
        case 'devBuyAmountSOL': return token.devBuyAmountSOL !== null && token.devBuyAmountSOL !== undefined ? token.devBuyAmountSOL : '';
        case 'walletBuyAmountSOL': return token.walletBuyAmountSOL !== null && token.walletBuyAmountSOL !== undefined ? token.walletBuyAmountSOL : '';
        case 'walletBuySOLPercentOfDev': return token.walletBuySOLPercentOfDev !== null && token.walletBuySOLPercentOfDev !== undefined ? token.walletBuySOLPercentOfDev : '';
        case 'devBuyAmountTokens': return token.devBuyAmountTokens !== null && token.devBuyAmountTokens !== undefined ? token.devBuyAmountTokens : '';
        case 'walletBuyAmountTokens': return token.walletBuyAmountTokens !== null && token.walletBuyAmountTokens !== undefined ? token.walletBuyAmountTokens : '';
        case 'walletBuyTokensPercentOfDev': return token.walletBuyTokensPercentOfDev !== null && token.walletBuyTokensPercentOfDev !== undefined ? token.walletBuyTokensPercentOfDev : '';
        case 'devBuyTokensPercentOfTotalSupply': return token.devBuyTokensPercentOfTotalSupply !== null && token.devBuyTokensPercentOfTotalSupply !== undefined ? token.devBuyTokensPercentOfTotalSupply : '';
        case 'walletBuyPercentOfTotalSupply': return token.walletBuyPercentOfTotalSupply !== null && token.walletBuyPercentOfTotalSupply !== undefined ? token.walletBuyPercentOfTotalSupply : '';
        case 'walletBuyPercentOfRemainingSupply': return token.walletBuyPercentOfRemainingSupply !== null && token.walletBuyPercentOfRemainingSupply !== undefined ? token.walletBuyPercentOfRemainingSupply : '';
        case 'tokenPeakPriceBeforeFirstSell': return token.tokenPeakPriceBeforeFirstSell !== null && token.tokenPeakPriceBeforeFirstSell !== undefined ? token.tokenPeakPriceBeforeFirstSell : '';
        case 'tokenPeakPrice10sAfterFirstSell': return token.tokenPeakPrice10sAfterFirstSell !== null && token.tokenPeakPrice10sAfterFirstSell !== undefined ? token.tokenPeakPrice10sAfterFirstSell : '';
        case 'tokenPeakMarketCapBeforeFirstSell': return token.tokenPeakMarketCapBeforeFirstSell !== null && token.tokenPeakMarketCapBeforeFirstSell !== undefined ? token.tokenPeakMarketCapBeforeFirstSell : '';
        case 'tokenPeakMarketCap10sAfterFirstSell': return token.tokenPeakMarketCap10sAfterFirstSell !== null && token.tokenPeakMarketCap10sAfterFirstSell !== undefined ? token.tokenPeakMarketCap10sAfterFirstSell : '';
        case 'walletBuyPositionAfterDev': return token.walletBuyPositionAfterDev !== null ? token.walletBuyPositionAfterDev : '';
        case 'walletBuyBlockNumber': return token.walletBuyBlockNumber || '';
        case 'walletBuyBlockNumberAfterDev': return token.walletBuyBlockNumberAfterDev !== null ? token.walletBuyBlockNumberAfterDev : '';
        case 'walletBuyTimestamp': return token.walletBuyTimestamp || '';
        case 'walletBuyMarketCap': return token.walletBuyMarketCap !== null && token.walletBuyMarketCap !== undefined ? token.walletBuyMarketCap : '';
        case 'walletGasAndFeesAmount': return token.walletGasAndFeesAmount !== null && token.walletGasAndFeesAmount !== undefined ? token.walletGasAndFeesAmount : '';
        case 'transactionSignature': return token.transactionSignature || '';
        case 'buysBeforeFirstSell': return token.buysBeforeFirstSell !== null && token.buysBeforeFirstSell !== undefined ? token.buysBeforeFirstSell : '';
        case 'buysAfterFirstSell': return token.buysAfterFirstSell !== null && token.buysAfterFirstSell !== undefined ? token.buysAfterFirstSell : '';
        default: return '';
    }
}

/**
 * Open column visibility dialog
 */
window.openColumnVisibilityDialog = function() {
    const modal = document.getElementById('columnVisibilityModal');
    const list = document.getElementById('columnVisibilityList');
    
    if (!modal || !list) return;
    
    // Clear existing list
    list.innerHTML = '';
    
    // Group columns by group
    const groupedColumns = {};
    COLUMN_DEFINITIONS.forEach(col => {
        const group = col.group || 'Other';
        if (!groupedColumns[group]) {
            groupedColumns[group] = [];
        }
        groupedColumns[group].push(col);
    });
    
    // Add sell columns group
    groupedColumns['Sell Columns'] = SELL_COLUMN_DEFINITIONS;
    
    // Create groups
    Object.keys(groupedColumns).sort().forEach(groupName => {
        const groupDiv = document.createElement('div');
        groupDiv.style.cssText = 'margin-bottom: 20px;';
        
        // Group header
        const groupHeader = document.createElement('div');
        groupHeader.style.cssText = 'display: flex; align-items: center; gap: 10px; padding: 10px; background: #0f1419; border-radius: 6px; border: 1px solid #334155; margin-bottom: 10px; cursor: pointer;';
        
        const handleGroupToggle = () => {
            // Toggle all columns in this group
            const allChecked = groupedColumns[groupName].every(col => {
                const isSellCol = groupName === 'Sell Columns';
                const visibility = isSellCol ? sellColumnVisibility : columnVisibility;
                return visibility[col.key] !== false;
            });
            
            groupedColumns[groupName].forEach(col => {
                const isSellCol = groupName === 'Sell Columns';
                const visibility = isSellCol ? sellColumnVisibility : columnVisibility;
                visibility[col.key] = !allChecked;
                
                const checkbox = document.getElementById(`col_${col.key}`);
                if (checkbox) {
                    checkbox.checked = !allChecked;
                    // Trigger change event to ensure consistency
                    checkbox.dispatchEvent(new Event('change', { bubbles: false }));
                }
            });
            
            saveColumnVisibility();
            renderDashboardTable();
        };
        
        groupHeader.onclick = handleGroupToggle;
        
        const groupTitle = document.createElement('div');
        groupTitle.textContent = groupName;
        groupTitle.style.cssText = 'color: #e0e7ff; font-size: 1rem; font-weight: 600; flex: 1;';
        groupTitle.onclick = (e) => {
            e.stopPropagation();
            handleGroupToggle();
        };
        
        const groupToggle = document.createElement('div');
        groupToggle.textContent = 'Toggle All';
        groupToggle.style.cssText = 'color: #3b82f6; font-size: 0.85rem; cursor: pointer;';
        groupToggle.onclick = (e) => {
            e.stopPropagation();
            handleGroupToggle();
        };
        
        groupHeader.appendChild(groupTitle);
        groupHeader.appendChild(groupToggle);
        groupDiv.appendChild(groupHeader);
        
        // Group columns
        const columnsContainer = document.createElement('div');
        columnsContainer.style.cssText = 'display: flex; flex-direction: column; gap: 8px; padding-left: 10px;';
        
        groupedColumns[groupName].forEach(col => {
            const isSellCol = groupName === 'Sell Columns';
            const visibility = isSellCol ? sellColumnVisibility : columnVisibility;
            
            const item = document.createElement('div');
            item.style.cssText = 'display: flex; align-items: center; gap: 10px; padding: 10px; background: #1a1f2e; border-radius: 6px; border: 1px solid #334155; cursor: pointer; transition: all 0.2s;';
            item.onmouseover = () => {
                item.style.background = '#1e293b';
                item.style.borderColor = '#475569';
            };
            item.onmouseout = () => {
                item.style.background = '#1a1f2e';
                item.style.borderColor = '#334155';
            };
            
            const checkbox = document.createElement('input');
            checkbox.type = 'checkbox';
            checkbox.id = `col_${col.key}`;
            checkbox.checked = visibility[col.key] !== false;
            checkbox.style.cssText = 'width: 18px; height: 18px; cursor: pointer; flex-shrink: 0;';
            
            // Handle checkbox change
            checkbox.onchange = () => {
                visibility[col.key] = checkbox.checked;
                saveColumnVisibility();
                renderDashboardTable();
            };
            
            // Stop propagation when clicking checkbox directly - let native behavior handle it
            checkbox.onclick = (e) => {
                e.stopPropagation();
                // Native checkbox behavior will handle the toggle and trigger onchange
            };
            
            const label = document.createElement('div');
            label.textContent = col.label;
            label.style.cssText = 'color: #e0e7ff; font-size: 0.9rem; cursor: pointer; flex: 1; user-select: none;';
            
            // Handle clicks on label - stop propagation so item.onclick doesn't also fire
            label.onclick = (e) => {
                e.preventDefault();
                e.stopPropagation();
                
                // Manually toggle the checkbox
                checkbox.checked = !checkbox.checked;
                // Trigger change event to update state
                checkbox.dispatchEvent(new Event('change', { bubbles: false }));
            };
            
            // Handle clicks on item area (but not checkbox or label)
            item.onclick = (e) => {
                // Don't toggle if clicking directly on checkbox (it handles itself)
                if (e.target === checkbox) {
                    return;
                }
                // Don't toggle if clicking on label (label handles itself)
                if (e.target === label) {
                    return;
                }
                
                e.preventDefault();
                e.stopPropagation();
                
                // Manually toggle the checkbox
                checkbox.checked = !checkbox.checked;
                // Trigger change event to update state
                checkbox.dispatchEvent(new Event('change', { bubbles: false }));
            };
            
            item.appendChild(checkbox);
            item.appendChild(label);
            columnsContainer.appendChild(item);
        });
        
        groupDiv.appendChild(columnsContainer);
        list.appendChild(groupDiv);
    });
    
    modal.style.display = 'flex';
    modal.style.alignItems = 'center';
    modal.style.justifyContent = 'center';
    
    // Close modal when clicking outside
    modal.onclick = (e) => {
        if (e.target === modal) {
            window.closeColumnVisibilityDialog();
        }
    };
};

/**
 * Close column visibility dialog
 */
window.closeColumnVisibilityDialog = function() {
    const modal = document.getElementById('columnVisibilityModal');
    if (modal) {
        modal.style.display = 'none';
    }
};

/**
 * Select all columns
 */
window.selectAllColumns = function() {
    COLUMN_DEFINITIONS.forEach(col => {
        columnVisibility[col.key] = true;
        const checkbox = document.getElementById(`col_${col.key}`);
        if (checkbox) {
            checkbox.checked = true;
        }
    });
    SELL_COLUMN_DEFINITIONS.forEach(col => {
        sellColumnVisibility[col.key] = true;
        const checkbox = document.getElementById(`col_${col.key}`);
        if (checkbox) {
            checkbox.checked = true;
        }
    });
    saveColumnVisibility();
    renderDashboardTable();
};

/**
 * Deselect all columns
 */
window.deselectAllColumns = function() {
    COLUMN_DEFINITIONS.forEach(col => {
        columnVisibility[col.key] = false;
        const checkbox = document.getElementById(`col_${col.key}`);
        if (checkbox) {
            checkbox.checked = false;
        }
    });
    SELL_COLUMN_DEFINITIONS.forEach(col => {
        sellColumnVisibility[col.key] = false;
        const checkbox = document.getElementById(`col_${col.key}`);
        if (checkbox) {
            checkbox.checked = false;
        }
    });
    saveColumnVisibility();
    renderDashboardTable();
};

window.exportDashboardToExcel = async function() {
    if (!filteredData || filteredData.length === 0) {
        const { showNotification } = await import('./utils.js');
        showNotification('No data to export', 'error');
        return;
    }
    
    // Get wallet address for filename
    const select = document.getElementById('dashboardWalletSelect');
    const walletAddress = select ? select.value : 'dashboard';
    
    // Get visible columns
    const visibleColumns = COLUMN_DEFINITIONS.filter(col => columnVisibility[col.key] !== false);
    
    // Build header row with only visible columns
    const baseHeaders = visibleColumns.map(col => col.label);
    
    // Add sell columns for each sell (up to maxSells) - only visible ones
    const sellHeaders = [];
    const visibleSellColumns = SELL_COLUMN_DEFINITIONS.filter(col => sellColumnVisibility[col.key] !== false);
    
    for (let i = 1; i <= maxSells; i++) {
        visibleSellColumns.forEach(col => {
            let headerLabel = '';
            switch(col.key) {
                case 'sellNumber':
                    headerLabel = `Wallet Sell Number ${i}`;
                    break;
                case 'sellMarketCap':
                    headerLabel = `Wallet Sell Market Cap ${i}`;
                    break;
                case 'sellPNL':
                    headerLabel = `${i === 1 ? 'First' : i === 2 ? '2nd' : i === 3 ? '3rd' : `${i}th`} Sell PNL`;
                    break;
                case 'sellPercentOfBuy':
                    headerLabel = `Sell % of Buy ${i}`;
                    break;
                case 'sellAmountSOL':
                    headerLabel = `Wallet Sell Amount in SOL ${i}`;
                    break;
                case 'sellAmountTokens':
                    headerLabel = `Wallet Sell Amount in Tokens ${i}`;
                    break;
                case 'sellTransactionSignature':
                    headerLabel = `Transaction Signature ${i}`;
                    break;
                case 'sellTimestamp':
                    headerLabel = `Wallet Sell Timestamp ${i}`;
                    break;
                case 'devStillHolding':
                    headerLabel = `Dev Still Holding at ${i === 1 ? '1st' : i === 2 ? '2nd' : i === 3 ? '3rd' : `${i}th`} Sell`;
                    break;
            }
            if (headerLabel) {
                sellHeaders.push(headerLabel);
            }
        });
    }
    
    const headers = [...baseHeaders, ...sellHeaders];
    
    // Helper function to get sell cell value for export
    const getSellCellValueForExport = (sell, key) => {
        switch(key) {
            case 'sellNumber': return sell.sellNumber || '';
            case 'sellMarketCap': return sell.marketCap !== null && sell.marketCap !== undefined ? sell.marketCap : '';
            case 'sellPNL': return sell.firstSellPNL !== null && sell.firstSellPNL !== undefined ? sell.firstSellPNL : '';
            case 'sellPercentOfBuy': return sell.sellPercentOfBuy !== null && sell.sellPercentOfBuy !== undefined ? sell.sellPercentOfBuy : '';
            case 'sellAmountSOL': return sell.sellAmountSOL !== null && sell.sellAmountSOL !== undefined ? sell.sellAmountSOL : '';
            case 'sellAmountTokens': return sell.sellAmountTokens !== null && sell.sellAmountTokens !== undefined ? sell.sellAmountTokens : '';
            case 'sellTransactionSignature': return sell.transactionSignature || '';
            case 'sellTimestamp': return sell.timestamp || '';
            case 'devStillHolding': 
                if (sell.devStillHolding === null || sell.devStillHolding === undefined) return 'N/A';
                return sell.devStillHolding ? 'Yes' : 'No';
            default: return '';
        }
    };
    
    // Build data rows
    const rows = filteredData.map(token => {
        const row = [];
        
        // Base columns - only visible ones
        visibleColumns.forEach(col => {
            const value = getCellValueForExport(token, col.key);
            row.push(value);
        });
        
        // Add sell columns - only visible ones
        for (let i = 0; i < maxSells; i++) {
            const sell = token.sells && token.sells[i];
            if (sell) {
                visibleSellColumns.forEach(col => {
                    const value = getSellCellValueForExport(sell, col.key);
                    row.push(value);
                });
            } else {
                // Empty cells for missing sells
                visibleSellColumns.forEach(() => {
                    row.push('');
                });
            }
        }
        
        return row;
    });
    
    // Create workbook
    const wb = XLSX.utils.book_new();
    const ws = XLSX.utils.aoa_to_sheet([headers, ...rows]);
    
    // Set column widths
    const colWidths = headers.map(() => ({ wch: 15 }));
    ws['!cols'] = colWidths;
    
    // Add worksheet to workbook
    XLSX.utils.book_append_sheet(wb, ws, 'Dashboard Data');
    
    // Generate filename
    const walletPrefix = walletAddress && walletAddress.length > 8 ? walletAddress.substring(0, 8) : 'dashboard';
    const filename = `Dashboard_${walletPrefix}_${Date.now()}.xlsx`;
    
    // Download file
    XLSX.writeFile(wb, filename);
};

/**
 * Export all wallets data to Excel
 */
window.exportAllWalletsToExcel = async function() {
    const { showNotification } = await import('./utils.js');
    const { fetchAllWallets } = await import('./api.js');
    const { fetchDashboardData } = await import('./api.js');
    
    try {
        // Show loading notification
        showNotification('Fetching all wallets data... This may take a while.', 'info');
        
        // Fetch all wallets
        const walletsResult = await fetchAllWallets();
        if (!walletsResult.success || !walletsResult.wallets || walletsResult.wallets.length === 0) {
            showNotification('No wallets found to export', 'error');
            return;
        }
        
        const wallets = walletsResult.wallets;
        let allData = [];
        let processedCount = 0;
        
        // Fetch data for each wallet
        for (const wallet of wallets) {
            try {
                // Fetch all data for this wallet (use large limit to get all data)
                const result = await fetchDashboardData(wallet, 1, 10000, []);
                if (result.success && result.data && result.data.length > 0) {
                    // Add wallet address to each token record
                    const walletData = result.data.map(token => ({
                        ...token,
                        walletAddress: wallet
                    }));
                    allData = allData.concat(walletData);
                }
                processedCount++;
                
                // Update progress (every 10 wallets)
                if (processedCount % 10 === 0) {
                    showNotification(`Processing... ${processedCount}/${wallets.length} wallets`, 'info');
                }
            } catch (error) {
                console.error(`Error fetching data for wallet ${wallet}:`, error);
                // Continue with other wallets
            }
        }
        
        if (allData.length === 0) {
            showNotification('No data found to export', 'error');
            return;
        }
        
        // Get visible columns
        const visibleColumns = COLUMN_DEFINITIONS.filter(col => columnVisibility[col.key] !== false);
        
        // Build header row - add wallet address as first column
        const baseHeaders = ['Wallet Address', ...visibleColumns.map(col => col.label)];
        
        // Find max sells across all data
        const maxSells = Math.max(...allData.map(token => (token.sells || []).length), 0);
        
        // Add sell columns for each sell (up to maxSells) - only visible ones
        const sellHeaders = [];
        const visibleSellColumns = SELL_COLUMN_DEFINITIONS.filter(col => sellColumnVisibility[col.key] !== false);
        
        for (let i = 1; i <= maxSells; i++) {
            visibleSellColumns.forEach(col => {
                let headerLabel = '';
                switch(col.key) {
                    case 'sellNumber':
                        headerLabel = `Wallet Sell Number ${i}`;
                        break;
                    case 'sellMarketCap':
                        headerLabel = `Wallet Sell Market Cap ${i}`;
                        break;
                    case 'sellPNL':
                        headerLabel = `${i === 1 ? 'First' : i === 2 ? '2nd' : i === 3 ? '3rd' : `${i}th`} Sell PNL`;
                        break;
                    case 'sellPercentOfBuy':
                        headerLabel = `Sell % of Buy ${i}`;
                        break;
                    case 'sellAmountSOL':
                        headerLabel = `Wallet Sell Amount in SOL ${i}`;
                        break;
                    case 'sellAmountTokens':
                        headerLabel = `Wallet Sell Amount in Tokens ${i}`;
                        break;
                case 'sellTransactionSignature':
                    headerLabel = `Transaction Signature ${i}`;
                    break;
                case 'sellTimestamp':
                    headerLabel = `Wallet Sell Timestamp ${i}`;
                    break;
                case 'devStillHolding':
                    headerLabel = `Dev Still Holding at ${i === 1 ? '1st' : i === 2 ? '2nd' : i === 3 ? '3rd' : `${i}th`} Sell`;
                    break;
            }
            if (headerLabel) {
                sellHeaders.push(headerLabel);
            }
        });
    }
    
    const headers = [...baseHeaders, ...sellHeaders];
        
        // Helper function to get cell value for export (same as in exportDashboardToExcel)
        const getCellValueForExport = (token, key) => {
            switch(key) {
                case 'tokenAddress': return token.tokenAddress || '';
                case 'tokenName': return token.tokenName || '';
                case 'tokenSymbol': return token.tokenSymbol || '';
                case 'walletBuyAmountSOL': return token.walletBuyAmountSOL !== null && token.walletBuyAmountSOL !== undefined ? token.walletBuyAmountSOL : '';
                case 'walletBuyAmountTokens': return token.walletBuyAmountTokens !== null && token.walletBuyAmountTokens !== undefined ? token.walletBuyAmountTokens : '';
                case 'devBuyAmountSOL': return token.devBuyAmountSOL !== null && token.devBuyAmountSOL !== undefined ? token.devBuyAmountSOL : '';
                case 'walletBuyPercentOfTotalSupply': return token.walletBuyPercentOfTotalSupply !== null && token.walletBuyPercentOfTotalSupply !== undefined ? token.walletBuyPercentOfTotalSupply : '';
                case 'walletBuyPercentOfRemainingSupply': return token.walletBuyPercentOfRemainingSupply !== null && token.walletBuyPercentOfRemainingSupply !== undefined ? token.walletBuyPercentOfRemainingSupply : '';
        case 'walletBuyMarketCap': return token.walletBuyMarketCap !== null && token.walletBuyMarketCap !== undefined ? token.walletBuyMarketCap : '';
        case 'walletBuyTimestamp': return token.walletBuyTimestamp || '';
        case 'pnlSOL': return token.pnlSOL !== null && token.pnlSOL !== undefined ? token.pnlSOL : '';
        case 'pnlPercent': return token.pnlPercent !== null && token.pnlPercent !== undefined ? token.pnlPercent : '';
        case 'openPositionCount': return token.openPositionCount !== null && token.openPositionCount !== undefined ? token.openPositionCount : '';
        case 'walletGasAndFeesAmount': return token.walletGasAndFeesAmount !== null && token.walletGasAndFeesAmount !== undefined ? token.walletGasAndFeesAmount : '';
        case 'buysBeforeFirstSell': return token.buysBeforeFirstSell !== null && token.buysBeforeFirstSell !== undefined ? token.buysBeforeFirstSell : '';
        case 'buysAfterFirstSell': return token.buysAfterFirstSell !== null && token.buysAfterFirstSell !== undefined ? token.buysAfterFirstSell : '';
        default: return token[key] !== null && token[key] !== undefined ? token[key] : '';
    }
};
        
        // Helper function to get sell cell value for export (same as in exportDashboardToExcel)
        const getSellCellValueForExport = (sell, key) => {
            switch(key) {
                case 'sellNumber': return sell.sellNumber || '';
                case 'sellMarketCap': return sell.marketCap !== null && sell.marketCap !== undefined ? sell.marketCap : '';
                case 'sellPNL': return sell.firstSellPNL !== null && sell.firstSellPNL !== undefined ? sell.firstSellPNL : '';
                case 'sellPercentOfBuy': return sell.sellPercentOfBuy !== null && sell.sellPercentOfBuy !== undefined ? sell.sellPercentOfBuy : '';
                case 'sellAmountSOL': return sell.sellAmountSOL !== null && sell.sellAmountSOL !== undefined ? sell.sellAmountSOL : '';
                case 'sellAmountTokens': return sell.sellAmountTokens !== null && sell.sellAmountTokens !== undefined ? sell.sellAmountTokens : '';
            case 'sellTransactionSignature': return sell.transactionSignature || '';
            case 'sellTimestamp': return sell.timestamp || '';
            case 'devStillHolding':
                if (sell.devStillHolding === null || sell.devStillHolding === undefined) return 'N/A';
                return sell.devStillHolding ? 'Yes' : 'No';
            default: return '';
        }
    };
        
        // Build data rows
        const rows = allData.map(token => {
            const row = [];
            
            // Add wallet address as first column
            row.push(token.walletAddress || '');
            
            // Base columns - only visible ones
            visibleColumns.forEach(col => {
                const value = getCellValueForExport(token, col.key);
                row.push(value);
            });
            
            // Add sell columns - only visible ones
            for (let i = 0; i < maxSells; i++) {
                const sell = token.sells && token.sells[i];
                if (sell) {
                    visibleSellColumns.forEach(col => {
                        const value = getSellCellValueForExport(sell, col.key);
                        row.push(value);
                    });
                } else {
                    // Empty cells for missing sells
                    visibleSellColumns.forEach(() => {
                        row.push('');
                    });
                }
            }
            
            return row;
        });
        
        // Create workbook
        const wb = XLSX.utils.book_new();
        const ws = XLSX.utils.aoa_to_sheet([headers, ...rows]);
        
        // Set column widths
        const colWidths = headers.map(() => ({ wch: 15 }));
        ws['!cols'] = colWidths;
        
        // Add worksheet to workbook
        XLSX.utils.book_append_sheet(wb, ws, 'All Wallets Data');
        
        // Generate filename
        const filename = `All_Wallets_Dashboard_${Date.now()}.xlsx`;
        
        // Download file
        XLSX.writeFile(wb, filename);
        
        showNotification(`✅ Exported ${allData.length} tokens from ${wallets.length} wallets`, 'success');
    } catch (error) {
        console.error('Error exporting all wallets:', error);
        showNotification('❌ Error exporting all wallets: ' + error.message, 'error');
    }
};

// Make functions available globally
window.loadDashboardData = loadDashboardData;
window.applyFilters = applyFilters;
