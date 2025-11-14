/**
 * Dashboard Manager
 * Handles dashboard data loading and table rendering
 */

import * as api from './api.js';

let dashboardData = [];
let filteredData = [];
let maxSells = 0;

// Current filter values
let currentFilters = {
    devBuySizeMin: 0,
    devBuySizeMax: 99,
    buySizeMin: 0,
    buySizeMax: 99,
    pnlMin: -100,
    pnlMax: 100
};

/**
 * Initialize dashboard - load wallets into select
 */
export async function initializeDashboard() {
    try {
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
                    select.appendChild(option);
                });
            }
        }
        
        // Initialize filter presets
        await loadFilterPresets();
        
        // Setup filter event listeners
        setupFilterListeners();
    } catch (error) {
        console.error('Failed to initialize dashboard:', error);
    }
}

/**
 * Setup filter event listeners with dual-range sliders
 */
function setupFilterListeners() {
    // Dev Buy Size filter
    setupDualRangeSlider('devBuySize', 0, 99, 0, 99);
    
    // Buy Size filter
    setupDualRangeSlider('buySize', 0, 99, 0, 99);
    
    // PNL filter
    setupDualRangeSlider('pnl', -100, 100, -100, 100);
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
        applyFilters();
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
        applyFilters();
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
function applyFilters() {
    filteredData = dashboardData.filter(token => {
        // Dev Buy Size filter
        const devBuySize = token.devBuyAmountSOL;
        if (devBuySize !== null && devBuySize !== undefined) {
            if (devBuySize < currentFilters.devBuySizeMin || devBuySize > currentFilters.devBuySizeMax) {
                return false;
            }
        }
        
        // Buy Size filter
        const buySize = token.walletBuyAmountSOL;
        if (buySize !== null && buySize !== undefined) {
            if (buySize < currentFilters.buySizeMin || buySize > currentFilters.buySizeMax) {
                return false;
            }
        }
        
        // PNL filter
        const pnl = token.pnlPercent;
        if (pnl !== null && pnl !== undefined) {
            if (pnl < currentFilters.pnlMin || pnl > currentFilters.pnlMax) {
                return false;
            }
        }
        
        return true;
    });
    
    // Re-render table with filtered data
    renderDashboardTable();
    updateAverageDataPoints();
}

/**
 * Load dashboard data for selected wallet
 */
export async function loadDashboardData() {
    const select = document.getElementById('dashboardWalletSelect');
    if (!select) return;
    
    const walletAddress = select.value;
    if (!walletAddress) {
        document.getElementById('dashboardTableLoading').textContent = 'Select a wallet to load dashboard data';
        document.getElementById('dashboardTable').style.display = 'none';
        return;
    }
    
    const loadingEl = document.getElementById('dashboardTableLoading');
    const tableEl = document.getElementById('dashboardTable');
    
    loadingEl.textContent = 'Loading dashboard data...';
    tableEl.style.display = 'none';
    
    try {
        const result = await api.fetchDashboardData(walletAddress);
        if (result.success && result.data) {
            dashboardData = result.data;
            
            // Calculate max sells across all tokens
            maxSells = Math.max(...dashboardData.map(token => (token.sells || []).length), 0);
            
            // Apply current filters
            applyFilters();
            
            loadingEl.style.display = 'none';
            tableEl.style.display = 'table';
        } else {
            loadingEl.textContent = result.error || 'Failed to load dashboard data';
        }
    } catch (error) {
        console.error('Error loading dashboard data:', error);
        loadingEl.textContent = 'Error loading dashboard data: ' + error.message;
    }
}

/**
 * Update wallet statistics
 */
function updateAverageDataPoints() {
    if (!filteredData || filteredData.length === 0) {
        // Reset all stats to '-' if no data
        const statIds = ['totalWalletPNL', 'cumulativePNL', 'riskRewardProfit', 'netInvested', 
                        'walletAvgBuySize', 'devAvgBuySize', 'avgPNLPerToken'];
        statIds.forEach(id => {
            const el = document.getElementById(id);
            if (el) {
                el.textContent = '-';
                el.style.color = '#e0e7ff';
            }
        });
        return;
    }
    
    // 1. Total Wallet PNL SOL - Sum of PNL per token in SOL
    const totalPNL = filteredData.reduce((sum, token) => sum + (token.pnlSOL || 0), 0);
    const totalPNLEl = document.getElementById('totalWalletPNL');
    if (totalPNLEl) {
        totalPNLEl.textContent = totalPNL >= 0 
            ? `+${totalPNL.toFixed(4)} SOL` 
            : `${totalPNL.toFixed(4)} SOL`;
        totalPNLEl.style.color = totalPNL >= 0 ? '#10b981' : '#ef4444';
    }
    
    // 2. Cumulative PNL % - Sum of % PNL per token
    const cumulativePNL = filteredData.reduce((sum, token) => sum + (token.pnlPercent || 0), 0);
    const cumulativePNLEl = document.getElementById('cumulativePNL');
    if (cumulativePNLEl) {
        cumulativePNLEl.textContent = cumulativePNL >= 0 
            ? `+${cumulativePNL.toFixed(2)}%` 
            : `${cumulativePNL.toFixed(2)}%`;
        cumulativePNLEl.style.color = cumulativePNL >= 0 ? '#10b981' : '#ef4444';
    }
    
    // 3. Net Invested - Sum of Wallet Buy Amount in SOL
    const netInvested = filteredData.reduce((sum, token) => sum + (token.walletBuyAmountSOL || 0), 0);
    const netInvestedEl = document.getElementById('netInvested');
    if (netInvestedEl) {
        netInvestedEl.textContent = `${netInvested.toFixed(4)} SOL`;
        netInvestedEl.style.color = '#e0e7ff';
    }
    
    // 4. Risk/Reward Profit % - Total Wallet PNL SOL / Net Invested
    const riskRewardProfit = netInvested > 0 ? (totalPNL / netInvested) * 100 : 0;
    const riskRewardProfitEl = document.getElementById('riskRewardProfit');
    if (riskRewardProfitEl) {
        riskRewardProfitEl.textContent = riskRewardProfit >= 0 
            ? `+${riskRewardProfit.toFixed(2)}%` 
            : `${riskRewardProfit.toFixed(2)}%`;
        riskRewardProfitEl.style.color = riskRewardProfit >= 0 ? '#10b981' : '#ef4444';
    }
    
    // 5. Wallet Average Buy Size in SOL - Average of Wallet Buy Amount in SOL
    const walletBuySizes = filteredData.map(token => token.walletBuyAmountSOL || 0).filter(size => size > 0);
    const walletAvgBuySize = walletBuySizes.length > 0 
        ? walletBuySizes.reduce((sum, size) => sum + size, 0) / walletBuySizes.length 
        : 0;
    const walletAvgBuySizeEl = document.getElementById('walletAvgBuySize');
    if (walletAvgBuySizeEl) {
        walletAvgBuySizeEl.textContent = walletAvgBuySize > 0 
            ? `${walletAvgBuySize.toFixed(4)} SOL` 
            : '-';
        walletAvgBuySizeEl.style.color = '#e0e7ff';
    }
    
    // 6. Dev Average Buy Size in SOL - Sum of Dev Buy Amount in SOL (despite name, it's a sum)
    const devAvgBuySize = filteredData.reduce((sum, token) => {
        const devBuySize = token.devBuyAmountSOL;
        return sum + (devBuySize && devBuySize > 0 ? devBuySize : 0);
    }, 0);
    const devAvgBuySizeEl = document.getElementById('devAvgBuySize');
    if (devAvgBuySizeEl) {
        devAvgBuySizeEl.textContent = devAvgBuySize > 0 
            ? `${devAvgBuySize.toFixed(4)} SOL` 
            : '-';
        devAvgBuySizeEl.style.color = '#e0e7ff';
    }
    
    // 7. Average PNL per Token - Average of % PNL per token
    const pnlPercents = filteredData.map(token => token.pnlPercent || 0);
    const avgPNLPerToken = pnlPercents.length > 0 
        ? pnlPercents.reduce((sum, pnl) => sum + pnl, 0) / pnlPercents.length 
        : 0;
    const avgPNLPerTokenEl = document.getElementById('avgPNLPerToken');
    if (avgPNLPerTokenEl) {
        avgPNLPerTokenEl.textContent = avgPNLPerToken >= 0 
            ? `+${avgPNLPerToken.toFixed(2)}%` 
            : `${avgPNLPerToken.toFixed(2)}%`;
        avgPNLPerTokenEl.style.color = avgPNLPerToken >= 0 ? '#10b981' : '#ef4444';
    }
    
    // 8. Calculate average profit and holding time per sell position
    updateSellStatistics();
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
 * Update sell statistics (average profit and holding time per sell position)
 */
function updateSellStatistics() {
    const container = document.getElementById('sellStatisticsContainer');
    if (!container) return;
    
    if (!filteredData || filteredData.length === 0) {
        container.innerHTML = '<div style="color: #94a3b8; text-align: center; padding: 20px;">No data available</div>';
        return;
    }
    
    // Find maximum number of sells across all tokens
    const maxSells = Math.max(...filteredData.map(token => (token.sells || []).length), 0);
    
    if (maxSells === 0) {
        container.innerHTML = '<div style="color: #94a3b8; text-align: center; padding: 20px;">No sells found</div>';
        return;
    }
    
    // Clear container
    container.innerHTML = '';
    
    // Calculate averages for each sell position
    for (let sellPosition = 1; sellPosition <= maxSells; sellPosition++) {
        const profitsAtSell = [];
        const holdingTimes = [];
        
        // Collect data for this sell position across all tokens
        filteredData.forEach(token => {
            if (token.sells && token.sells.length >= sellPosition) {
                const sell = token.sells[sellPosition - 1]; // 0-indexed
                
                // Collect profit at this sell
                if (sell.profitAtSell !== null && sell.profitAtSell !== undefined) {
                    profitsAtSell.push(sell.profitAtSell);
                }
                
                // Collect holding time
                if (sell.holdingTimeSeconds !== null && sell.holdingTimeSeconds !== undefined) {
                    holdingTimes.push(sell.holdingTimeSeconds);
                }
            }
        });
        
        // Calculate averages
        const avgProfit = profitsAtSell.length > 0
            ? profitsAtSell.reduce((sum, p) => sum + p, 0) / profitsAtSell.length
            : null;
        
        const avgHoldingTime = holdingTimes.length > 0
            ? Math.floor(holdingTimes.reduce((sum, t) => sum + t, 0) / holdingTimes.length)
            : null;
        
        // Create card for this sell position
        const sellNumber = sellPosition === 1 ? '1st' : sellPosition === 2 ? '2nd' : sellPosition === 3 ? '3rd' : `${sellPosition}th`;
        
        const card = document.createElement('div');
        card.style.cssText = 'padding: 15px; background: #1a1f2e; border-radius: 6px; border: 1px solid #334155;';
        
        const title = document.createElement('div');
        title.style.cssText = 'font-size: 0.9rem; font-weight: 600; color: #cbd5e1; margin-bottom: 12px; text-align: center;';
        title.textContent = `${sellNumber} Sell`;
        card.appendChild(title);
        
        // Average Profit
        const profitLabel = document.createElement('div');
        profitLabel.style.cssText = 'font-size: 0.75rem; color: #94a3b8; margin-bottom: 5px;';
        profitLabel.textContent = 'Average Profit';
        card.appendChild(profitLabel);
        
        const profitValue = document.createElement('div');
        profitValue.style.cssText = 'font-size: 1.1rem; font-weight: 600; margin-bottom: 12px;';
        if (avgProfit !== null) {
            profitValue.textContent = avgProfit >= 0 
                ? `+${avgProfit.toFixed(2)}%` 
                : `${avgProfit.toFixed(2)}%`;
            profitValue.style.color = avgProfit >= 0 ? '#10b981' : '#ef4444';
        } else {
            profitValue.textContent = '-';
            profitValue.style.color = '#94a3b8';
        }
        card.appendChild(profitValue);
        
        // Average Holding Time (in seconds)
        // Average of holding time on nth sell in seconds for all tokens (except tokens without nth sell)
        const timeLabel = document.createElement('div');
        timeLabel.style.cssText = 'font-size: 0.75rem; color: #94a3b8; margin-bottom: 5px;';
        timeLabel.textContent = 'Average Holding Time';
        card.appendChild(timeLabel);
        
        const timeValue = document.createElement('div');
        timeValue.style.cssText = 'font-size: 1.1rem; font-weight: 600;';
        if (avgHoldingTime !== null) {
            // Display in seconds with formatted version in parentheses
            timeValue.textContent = `${avgHoldingTime.toLocaleString()}s (${formatDuration(avgHoldingTime)})`;
            timeValue.style.color = '#e0e7ff';
        } else {
            timeValue.textContent = '-';
            timeValue.style.color = '#94a3b8';
        }
        card.appendChild(timeValue);
        
        container.appendChild(card);
    }
}

/**
 * Render dashboard table
 */
function renderDashboardTable() {
    const thead = document.getElementById('dashboardTableHead');
    const tbody = document.getElementById('dashboardTableBody');
    
    if (!thead || !tbody) return;
    
    // Use filtered data instead of dashboardData
    const dataToRender = filteredData;
    
    // Build header row
    const baseHeaders = [
        'PNL per token in SOL',
        '% PNL per token',
        'Token Name',
        'Token Symbol',
        'Token Address',
        'Creator Address',
        'Number of Socials',
        'Dev Buy Amount in SOL',
        'Wallet Buy Amount in SOL',
        'Wallet buy SOL % of dev',
        'Dev Buy Amount in Tokens',
        'Wallet Buy Amount in Tokens',
        'Wallet buy Tokens % of dev',
        'Dev buy Tokens % of total supply',
        'Wallet buy % of total supply',
        'Wallet buy % of the remaining supply',
        'Token Peak Price Before 1st Sell',
        'Token Peak Price 10s After 1st Sell',
        'Wallet Buy Position After Dev',
        'Wallet Buy Block #',
        'Wallet Buy Block # After Dev',
        'Wallet Buy Timestamp',
        'Wallet Buy Market Cap',
        'Wallet Gas & Fees Amount',
        'Transaction Signature'
    ];
    
    // Add sell columns for each sell (up to maxSells)
    const sellHeaders = [];
    for (let i = 1; i <= maxSells; i++) {
        sellHeaders.push(
            `Wallet Sell Number ${i}`,
            `Wallet Sell Market Cap ${i}`,
            `${i === 1 ? 'First' : i === 2 ? '2nd' : i === 3 ? '3rd' : `${i}th`} Sell PNL`,
            `Sell % of Buy ${i}`,
            `Wallet Sell Amount in SOL ${i}`,
            `Wallet Sell Amount in Tokens ${i}`,
            `Transaction Signature ${i}`,
            `Wallet Sell Timestamp ${i}`
        );
    }
    
    const headers = [...baseHeaders, ...sellHeaders];
    
    // Clear existing content
    thead.innerHTML = '';
    tbody.innerHTML = '';
    
    // Create header row
    const headerRow = document.createElement('tr');
    headers.forEach(header => {
        const th = document.createElement('th');
        th.textContent = header;
        th.style.cssText = 'padding: 12px; border: 1px solid #334155; background: #1a1f2e; color: #e0e7ff; font-weight: 600; text-align: center; white-space: nowrap;';
        headerRow.appendChild(th);
    });
    thead.appendChild(headerRow);
    
    // Create data rows
    dataToRender.forEach(token => {
        const row = document.createElement('tr');
        
        // Base columns
        const baseCells = [
            formatNumber(token.pnlSOL, 4),
            formatPercent(token.pnlPercent),
            token.tokenName || 'Unknown',
            token.tokenSymbol || '???',
            createLink(token.tokenAddress, `https://solscan.io/token/${token.tokenAddress}`, token.tokenAddress.substring(0, 8) + '...'),
            createLink(token.creatorAddress, `https://solscan.io/account/${token.creatorAddress}`, token.creatorAddress || ''),
            token.numberOfSocials || 0,
            formatNumber(token.devBuyAmountSOL, 4),
            formatNumber(token.walletBuyAmountSOL, 4),
            formatPercent(token.walletBuySOLPercentOfDev),
            formatNumber(token.devBuyAmountTokens, 4),
            formatNumber(token.walletBuyAmountTokens, 4),
            formatPercent(token.walletBuyTokensPercentOfDev),
            formatPercent(token.devBuyTokensPercentOfTotalSupply),
            formatPercent(token.walletBuyPercentOfTotalSupply),
            formatPercent(token.walletBuyPercentOfRemainingSupply),
            formatNumber(token.tokenPeakPriceBeforeFirstSell, 2),
            formatNumber(token.tokenPeakPrice10sAfterFirstSell, 2),
            token.walletBuyPositionAfterDev !== null ? `${token.walletBuyPositionAfterDev}s` : '',
            token.walletBuyBlockNumber || '',
            token.walletBuyBlockNumberAfterDev !== null ? token.walletBuyBlockNumberAfterDev : '',
            token.walletBuyTimestamp || '',
            formatNumber(token.walletBuyMarketCap, 2),
            formatNumber(token.walletGasAndFeesAmount, 4),
            createLink(token.transactionSignature, `https://solscan.io/tx/${token.transactionSignature}`, token.transactionSignature ? token.transactionSignature.substring(0, 8) + '...' : '')
        ];
        
        baseCells.forEach(cellContent => {
            const td = document.createElement('td');
            if (typeof cellContent === 'string' && cellContent.includes('<a')) {
                td.innerHTML = cellContent;
            } else {
                td.textContent = cellContent;
            }
            td.style.cssText = 'padding: 10px; border: 1px solid #334155; color: #cbd5e1; text-align: center; white-space: nowrap;';
            row.appendChild(td);
        });
        
        // Add sell columns
        for (let i = 0; i < maxSells; i++) {
            const sell = token.sells && token.sells[i];
            if (sell) {
                const sellCells = [
                    sell.sellNumber || '',
                    formatNumber(sell.marketCap, 2),
                    formatNumber(sell.firstSellPNL, 4),
                    formatPercent(sell.sellPercentOfBuy),
                    formatNumber(sell.sellAmountSOL, 4),
                    formatNumber(sell.sellAmountTokens, 4),
                    createLink(sell.transactionSignature, `https://solscan.io/tx/${sell.transactionSignature}`, sell.transactionSignature ? sell.transactionSignature.substring(0, 8) + '...' : ''),
                    sell.timestamp || ''
                ];
                
                sellCells.forEach(cellContent => {
                    const td = document.createElement('td');
                    if (typeof cellContent === 'string' && cellContent.includes('<a')) {
                        td.innerHTML = cellContent;
                    } else {
                        td.textContent = cellContent;
                    }
                    td.style.cssText = 'padding: 10px; border: 1px solid #334155; color: #cbd5e1; text-align: center; white-space: nowrap;';
                    row.appendChild(td);
                });
            } else {
                // Empty cells for missing sells
                for (let j = 0; j < 8; j++) {
                    const td = document.createElement('td');
                    td.style.cssText = 'padding: 10px; border: 1px solid #334155; color: #64748b; text-align: center;';
                    row.appendChild(td);
                }
            }
        }
        
        tbody.appendChild(row);
    });
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
            
            // Update filter inputs
            if (preset.devBuySizeMin !== null && preset.devBuySizeMin !== undefined) {
                document.getElementById('devBuySizeMin').value = preset.devBuySizeMin;
                currentFilters.devBuySizeMin = parseFloat(preset.devBuySizeMin);
            }
            if (preset.devBuySizeMax !== null && preset.devBuySizeMax !== undefined) {
                document.getElementById('devBuySizeMax').value = preset.devBuySizeMax;
                document.getElementById('devBuySizeSlider').value = preset.devBuySizeMax;
                currentFilters.devBuySizeMax = parseFloat(preset.devBuySizeMax);
            }
            if (preset.buySizeMin !== null && preset.buySizeMin !== undefined) {
                document.getElementById('buySizeMin').value = preset.buySizeMin;
                currentFilters.buySizeMin = parseFloat(preset.buySizeMin);
            }
            if (preset.buySizeMax !== null && preset.buySizeMax !== undefined) {
                document.getElementById('buySizeMax').value = preset.buySizeMax;
                document.getElementById('buySizeSlider').value = preset.buySizeMax;
                currentFilters.buySizeMax = parseFloat(preset.buySizeMax);
            }
            if (preset.pnlMin !== null && preset.pnlMin !== undefined) {
                document.getElementById('pnlMin').value = preset.pnlMin;
                currentFilters.pnlMin = parseFloat(preset.pnlMin);
            }
            if (preset.pnlMax !== null && preset.pnlMax !== undefined) {
                document.getElementById('pnlMax').value = preset.pnlMax;
                document.getElementById('pnlSlider').value = preset.pnlMax;
                currentFilters.pnlMax = parseFloat(preset.pnlMax);
            }
            
            // Apply filters
            applyFilters();
            
            const { showNotification } = await import('./utils.js');
            showNotification('Filter preset loaded successfully', 'success');
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
    
    const filters = {
        devBuySizeMin: currentFilters.devBuySizeMin,
        devBuySizeMax: currentFilters.devBuySizeMax,
        buySizeMin: currentFilters.buySizeMin,
        buySizeMax: currentFilters.buySizeMax,
        pnlMin: currentFilters.pnlMin,
        pnlMax: currentFilters.pnlMax
    };
    
    try {
        const result = await api.saveDashboardFilterPreset(nameInput.value.trim(), filters);
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

// Make loadDashboardData available globally
window.loadDashboardData = loadDashboardData;
