/**
 * Dashboard Manager
 * Handles dashboard data loading and table rendering
 */

import * as api from './api.js';

let dashboardData = [];
let filteredData = [];
let maxSells = 0;
let openPositions = 0;
let totalBuys = 0;
let totalSells = 0;

// Pagination state
let currentPage = 1;
let itemsPerPage = 50;

// Dynamic filters - array of filter objects
let activeFilters = [];

// Data point definitions with filter types
const DATA_POINTS = [
    // SOL Amount filters
    { key: 'pnlSOL', label: 'PNL per token in SOL', type: 'sol', field: 'pnlSOL' },
    { key: 'devBuyAmountSOL', label: 'Dev Buy Amount in SOL', type: 'sol', field: 'devBuyAmountSOL' },
    { key: 'walletBuyAmountSOL', label: 'Wallet Buy Amount in SOL', type: 'sol', field: 'walletBuyAmountSOL' },
    { key: 'walletGasAndFeesAmount', label: 'Wallet Gas & Fees Amount', type: 'sol', field: 'walletGasAndFeesAmount' },
    { key: 'walletBuyMarketCap', label: 'Wallet Buy Market Cap', type: 'sol', field: 'walletBuyMarketCap' },
    
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
    { key: 'sellAmountSOL', label: 'Wallet Sell Amount in SOL (any sell)', type: 'sol', field: 'sells', isArray: true, arrayField: 'sellAmountSOL' },
    { key: 'sellAmountTokens', label: 'Wallet Sell Amount in Tokens (any sell)', type: 'token', field: 'sells', isArray: true, arrayField: 'sellAmountTokens' },
    { key: 'sellMarketCap', label: 'Wallet Sell Market Cap (any sell)', type: 'sol', field: 'sells', isArray: true, arrayField: 'marketCap' },
    { key: 'sellPercentOfBuy', label: 'Sell % of Buy (any sell)', type: 'percent', field: 'sells', isArray: true, arrayField: 'sellPercentOfBuy' },
    { key: 'firstSellPNL', label: 'First Sell PNL (any sell)', type: 'percent', field: 'sells', isArray: true, arrayField: 'firstSellPNL' }
];

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
    
    // Filter out already added data points
    const availableDataPoints = DATA_POINTS.filter(dp => !activeKeys.includes(dp.key));
    
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
            const typeLabels = { sol: 'SOL Amount', token: 'Token Amount', percent: 'Percentage' };
            type.textContent = `Type: ${typeLabels[dataPoint.type] || 'Unknown'}`;
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
    
    // Check if already added
    if (activeFilters.find(f => f.key === dataPointKey)) {
        return;
    }
    
    const config = getFilterConfig(dataPoint.type);
    
    // Create filter object
    const filter = {
        key: dataPointKey,
        label: dataPoint.label,
        type: dataPoint.type,
        min: config.defaultMin,
        max: config.defaultMax,
        minEnabled: true,
        maxEnabled: true
    };
    
    activeFilters.push(filter);
    renderFilters();
    applyFilters();
}

/**
 * Remove a filter
 */
function removeFilter(dataPointKey) {
    activeFilters = activeFilters.filter(f => f.key !== dataPointKey);
    renderFilters();
    applyFilters();
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
        filterDiv.id = `filter-${filter.key}`;
        
        // Header with label and remove button
        const header = document.createElement('div');
        header.style.cssText = 'display: flex; justify-content: space-between; align-items: center; margin-bottom: 12px;';
        
        const label = document.createElement('label');
        label.style.cssText = 'font-weight: 600; color: #cbd5e1; font-size: 0.9rem;';
        label.textContent = filter.label;
        header.appendChild(label);
        
        const removeBtn = document.createElement('button');
        removeBtn.style.cssText = 'padding: 4px 12px; background: #ef4444; color: white; border: none; border-radius: 4px; cursor: pointer; font-size: 0.85rem; transition: all 0.2s;';
        removeBtn.textContent = 'Remove';
        removeBtn.onclick = () => removeFilter(filter.key);
        removeBtn.onmouseover = () => { removeBtn.style.background = '#dc2626'; };
        removeBtn.onmouseout = () => { removeBtn.style.background = '#ef4444'; };
        header.appendChild(removeBtn);
        
        filterDiv.appendChild(header);
        
        // Filter controls
        const config = getFilterConfig(filter.type);
        const controlsDiv = document.createElement('div');
        controlsDiv.style.cssText = 'display: flex; gap: 15px; align-items: center; flex-wrap: wrap;';
        
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
        maxInput.min = filter.type === 'sol' || filter.type === 'token' ? config.min : undefined; // SOL/Token min is 0, percent can be unset
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
        maxLabel.textContent = filter.type === 'percent' ? config.maxLabel : config.max;
        sliderDiv.appendChild(maxLabel);
        
        controlsDiv.appendChild(sliderDiv);
        filterDiv.appendChild(controlsDiv);
        container.appendChild(filterDiv);
        
        // Setup slider
        setupDynamicDualRangeSlider(filter.key, config);
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
            applyFilters();
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
        applyFilters();
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
        applyFilters();
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
        // Check each active filter
        for (const filter of activeFilters) {
            const dataPoint = DATA_POINTS.find(dp => dp.key === filter.key);
            if (!dataPoint) continue;
            
            let value = null;
            
            // Handle array fields (sells)
            if (dataPoint.isArray && dataPoint.field === 'sells') {
                const sells = token[dataPoint.field] || [];
                if (sells.length === 0) {
                    // If no sells, check if we should filter this out
                    // For now, we'll skip filtering if there are no sells
                    continue;
                }
                // Get the value from the first sell or check all sells
                const firstSell = sells[0];
                value = firstSell ? firstSell[dataPoint.arrayField] : null;
            } else {
                value = token[dataPoint.field];
            }
            
            // Skip if value is null/undefined
            if (value === null || value === undefined) {
                continue;
            }
            
            // Apply min/max filters (null/undefined means "not set")
            if (filter.min !== null && filter.min !== undefined) {
                if (value < filter.min) {
                    return false;
                }
            }
            if (filter.max !== null && filter.max !== undefined) {
                if (value > filter.max) {
                    return false;
                }
            }
        }
        
        return true;
    });
    
    // Reset to first page when filters change
    currentPage = 1;
    
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
        // Reset open positions and buy/sell counts when no wallet selected
        const openPositionsEl = document.getElementById('openPositions');
        if (openPositionsEl) {
            openPositionsEl.textContent = '-';
        }
        const totalBuysEl = document.getElementById('totalBuys');
        if (totalBuysEl) {
            totalBuysEl.textContent = '-';
        }
        const totalSellsEl = document.getElementById('totalSells');
        if (totalSellsEl) {
            totalSellsEl.textContent = '-';
        }
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
            
            // Store open positions count
            openPositions = result.openPositions || 0;
            
            // Store total buys/sells counts
            totalBuys = result.totalBuys || 0;
            totalSells = result.totalSells || 0;
            
            // Update open positions display
            const openPositionsEl = document.getElementById('openPositions');
            if (openPositionsEl) {
                openPositionsEl.textContent = openPositions.toString();
                openPositionsEl.style.color = '#e0e7ff';
            }
            
            // Update total buys display
            const totalBuysEl = document.getElementById('totalBuys');
            if (totalBuysEl) {
                totalBuysEl.textContent = totalBuys.toString();
                totalBuysEl.style.color = '#e0e7ff';
            }
            
            // Update total sells display
            const totalSellsEl = document.getElementById('totalSells');
            if (totalSellsEl) {
                totalSellsEl.textContent = totalSells.toString();
                totalSellsEl.style.color = '#e0e7ff';
            }
            
            // Calculate max sells across all tokens
            maxSells = Math.max(...dashboardData.map(token => (token.sells || []).length), 0);
            
            // Reset to first page when loading new data
            currentPage = 1;
            
            // Apply current filters
            applyFilters();
            
            loadingEl.style.display = 'none';
            tableEl.style.display = 'table';
        } else {
            loadingEl.textContent = result.error || 'Failed to load dashboard data';
            // Reset open positions and buy/sell counts on error
            const openPositionsEl = document.getElementById('openPositions');
            if (openPositionsEl) {
                openPositionsEl.textContent = '-';
            }
            const totalBuysEl = document.getElementById('totalBuys');
            if (totalBuysEl) {
                totalBuysEl.textContent = '-';
            }
            const totalSellsEl = document.getElementById('totalSells');
            if (totalSellsEl) {
                totalSellsEl.textContent = '-';
            }
        }
    } catch (error) {
        console.error('Error loading dashboard data:', error);
        loadingEl.textContent = 'Error loading dashboard data: ' + error.message;
        // Reset open positions and buy/sell counts on error
        const openPositionsEl = document.getElementById('openPositions');
        if (openPositionsEl) {
            openPositionsEl.textContent = '-';
        }
        const totalBuysEl = document.getElementById('totalBuys');
        if (totalBuysEl) {
            totalBuysEl.textContent = '-';
        }
        const totalSellsEl = document.getElementById('totalSells');
        if (totalSellsEl) {
            totalSellsEl.textContent = '-';
        }
    }
}

/**
 * Update wallet statistics
 */
function updateAverageDataPoints() {
    if (!filteredData || filteredData.length === 0) {
        // Reset all stats to '-' if no data (but keep open positions as it's independent)
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
    
    // 6. Dev Average Buy Size in SOL - Average of Dev Buy Amount in SOL
    const devBuySizes = filteredData
        .map(token => token.devBuyAmountSOL)
        .filter(size => size !== null && size !== undefined && size > 0);
    const devAvgBuySize = devBuySizes.length > 0 
        ? devBuySizes.reduce((sum, size) => sum + size, 0) / devBuySizes.length 
        : 0;
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
                
                // Collect nth Sell PNL (Wallet Buy Market Cap / nth Sell Market Cap)
                if (sell.firstSellPNL !== null && sell.firstSellPNL !== undefined) {
                    profitsAtSell.push(sell.firstSellPNL);
                }
                
                // Collect holding time
                if (sell.holdingTimeSeconds !== null && sell.holdingTimeSeconds !== undefined) {
                    holdingTimes.push(sell.holdingTimeSeconds);
                }
            }
        });
        
        // Calculate averages
        // Average profit of nth sell = Average of nth sell PNL
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
            // Display as ratio (Wallet Buy Market Cap / nth Sell Market Cap)
            profitValue.textContent = avgProfit.toFixed(4);
            profitValue.style.color = '#e0e7ff';
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
    
    // Calculate pagination
    const totalItems = filteredData.length;
    const totalPages = Math.max(1, Math.ceil(totalItems / itemsPerPage));
    
    // Ensure currentPage is valid
    if (currentPage > totalPages) {
        currentPage = totalPages;
    }
    if (currentPage < 1) {
        currentPage = 1;
    }
    
    // Get data for current page
    const startIndex = (currentPage - 1) * itemsPerPage;
    const endIndex = startIndex + itemsPerPage;
    const dataToRender = filteredData.slice(startIndex, endIndex);
    
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
    
    // Render pagination controls
    renderPagination(totalPages, totalItems, startIndex, endIndex);
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
    controls.style.cssText = 'display: flex; align-items: center; gap: 10px;';
    
    // Items per page selector
    const itemsPerPageLabel = document.createElement('label');
    itemsPerPageLabel.style.cssText = 'color: #cbd5e1; font-size: 0.85rem;';
    itemsPerPageLabel.textContent = 'Items per page:';
    controls.appendChild(itemsPerPageLabel);
    
    const itemsPerPageSelect = document.createElement('select');
    itemsPerPageSelect.style.cssText = 'padding: 6px 10px; border: 1px solid #334155; background: #0f1419; color: #e0e7ff; border-radius: 4px; font-size: 0.85rem; cursor: pointer;';
    itemsPerPageSelect.value = itemsPerPage;
    [10, 25, 50, 100].forEach(val => {
        const option = document.createElement('option');
        option.value = val;
        option.textContent = val;
        itemsPerPageSelect.appendChild(option);
    });
    itemsPerPageSelect.addEventListener('change', (e) => {
        itemsPerPage = parseInt(e.target.value);
        currentPage = 1;
        renderDashboardTable();
    });
    controls.appendChild(itemsPerPageSelect);
    
    // Page navigation
    const nav = document.createElement('div');
    nav.style.cssText = 'display: flex; align-items: center; gap: 5px;';
    
    // First button
    const firstBtn = createPaginationButton('«', currentPage === 1, () => {
        currentPage = 1;
        renderDashboardTable();
    });
    nav.appendChild(firstBtn);
    
    // Previous button
    const prevBtn = createPaginationButton('‹', currentPage === 1, () => {
        if (currentPage > 1) {
            currentPage--;
            renderDashboardTable();
        }
    });
    nav.appendChild(prevBtn);
    
    // Page numbers
    const maxVisiblePages = 5;
    let startPage = Math.max(1, currentPage - Math.floor(maxVisiblePages / 2));
    let endPage = Math.min(totalPages, startPage + maxVisiblePages - 1);
    
    if (endPage - startPage < maxVisiblePages - 1) {
        startPage = Math.max(1, endPage - maxVisiblePages + 1);
    }
    
    if (startPage > 1) {
        const firstPageBtn = createPaginationButton('1', false, () => {
            currentPage = 1;
            renderDashboardTable();
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
        const pageBtn = createPaginationButton(i.toString(), i === currentPage, () => {
            currentPage = i;
            renderDashboardTable();
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
        
        const lastPageBtn = createPaginationButton(totalPages.toString(), false, () => {
            currentPage = totalPages;
            renderDashboardTable();
        });
        nav.appendChild(lastPageBtn);
    }
    
    // Next button
    const nextBtn = createPaginationButton('›', currentPage === totalPages, () => {
        if (currentPage < totalPages) {
            currentPage++;
            renderDashboardTable();
        }
    });
    nav.appendChild(nextBtn);
    
    // Last button
    const lastBtn = createPaginationButton('»', currentPage === totalPages, () => {
        currentPage = totalPages;
        renderDashboardTable();
    });
    nav.appendChild(lastBtn);
    
    controls.appendChild(nav);
    info.appendChild(controls);
    container.appendChild(info);
}

/**
 * Create a pagination button
 */
function createPaginationButton(text, disabled, onClick) {
    const btn = document.createElement('button');
    btn.textContent = text;
    btn.style.cssText = 'padding: 6px 12px; border: 1px solid #334155; background: #1a1f2e; color: #e0e7ff; border-radius: 4px; cursor: pointer; font-size: 0.85rem; min-width: 36px; transition: all 0.2s;';
    
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
                activeFilters = preset.filters.map(filter => ({
                    key: filter.key,
                    label: filter.label || DATA_POINTS.find(dp => dp.key === filter.key)?.label || filter.key,
                    type: filter.type || DATA_POINTS.find(dp => dp.key === filter.key)?.type || 'sol',
                    min: filter.min !== null && filter.min !== undefined ? parseFloat(filter.min) : null,
                    max: filter.max !== null && filter.max !== undefined ? parseFloat(filter.max) : null,
                    minEnabled: filter.minEnabled !== false,
                    maxEnabled: filter.maxEnabled !== false
                }));
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
    
    // Save filters in new format (array of filter objects)
    const filters = {
        filters: activeFilters.map(filter => ({
            key: filter.key,
            label: filter.label,
            type: filter.type,
            min: filter.min,
            max: filter.max,
            minEnabled: filter.minEnabled,
            maxEnabled: filter.maxEnabled
        }))
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
window.exportDashboardToExcel = async function() {
    if (!filteredData || filteredData.length === 0) {
        const { showNotification } = await import('./utils.js');
        showNotification('No data to export', 'error');
        return;
    }
    
    // Get wallet address for filename
    const select = document.getElementById('dashboardWalletSelect');
    const walletAddress = select ? select.value : 'dashboard';
    
    // Build header row (same as table)
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
    
    // Build data rows
    const rows = filteredData.map(token => {
        const row = [];
        
        // Base columns
        row.push(
            token.pnlSOL !== null && token.pnlSOL !== undefined ? token.pnlSOL : '',
            token.pnlPercent !== null && token.pnlPercent !== undefined ? token.pnlPercent : '',
            token.tokenName || '',
            token.tokenSymbol || '',
            token.tokenAddress || '',
            token.creatorAddress || '',
            token.numberOfSocials || 0,
            token.devBuyAmountSOL !== null && token.devBuyAmountSOL !== undefined ? token.devBuyAmountSOL : '',
            token.walletBuyAmountSOL !== null && token.walletBuyAmountSOL !== undefined ? token.walletBuyAmountSOL : '',
            token.walletBuySOLPercentOfDev !== null && token.walletBuySOLPercentOfDev !== undefined ? token.walletBuySOLPercentOfDev : '',
            token.devBuyAmountTokens !== null && token.devBuyAmountTokens !== undefined ? token.devBuyAmountTokens : '',
            token.walletBuyAmountTokens !== null && token.walletBuyAmountTokens !== undefined ? token.walletBuyAmountTokens : '',
            token.walletBuyTokensPercentOfDev !== null && token.walletBuyTokensPercentOfDev !== undefined ? token.walletBuyTokensPercentOfDev : '',
            token.devBuyTokensPercentOfTotalSupply !== null && token.devBuyTokensPercentOfTotalSupply !== undefined ? token.devBuyTokensPercentOfTotalSupply : '',
            token.walletBuyPercentOfTotalSupply !== null && token.walletBuyPercentOfTotalSupply !== undefined ? token.walletBuyPercentOfTotalSupply : '',
            token.walletBuyPercentOfRemainingSupply !== null && token.walletBuyPercentOfRemainingSupply !== undefined ? token.walletBuyPercentOfRemainingSupply : '',
            token.tokenPeakPriceBeforeFirstSell !== null && token.tokenPeakPriceBeforeFirstSell !== undefined ? token.tokenPeakPriceBeforeFirstSell : '',
            token.tokenPeakPrice10sAfterFirstSell !== null && token.tokenPeakPrice10sAfterFirstSell !== undefined ? token.tokenPeakPrice10sAfterFirstSell : '',
            token.walletBuyPositionAfterDev !== null ? token.walletBuyPositionAfterDev : '',
            token.walletBuyBlockNumber || '',
            token.walletBuyBlockNumberAfterDev !== null ? token.walletBuyBlockNumberAfterDev : '',
            token.walletBuyTimestamp || '',
            token.walletBuyMarketCap !== null && token.walletBuyMarketCap !== undefined ? token.walletBuyMarketCap : '',
            token.walletGasAndFeesAmount !== null && token.walletGasAndFeesAmount !== undefined ? token.walletGasAndFeesAmount : '',
            token.transactionSignature || ''
        );
        
        // Add sell columns
        for (let i = 0; i < maxSells; i++) {
            const sell = token.sells && token.sells[i];
            if (sell) {
                row.push(
                    sell.sellNumber || '',
                    sell.marketCap !== null && sell.marketCap !== undefined ? sell.marketCap : '',
                    sell.firstSellPNL !== null && sell.firstSellPNL !== undefined ? sell.firstSellPNL : '',
                    sell.sellPercentOfBuy !== null && sell.sellPercentOfBuy !== undefined ? sell.sellPercentOfBuy : '',
                    sell.sellAmountSOL !== null && sell.sellAmountSOL !== undefined ? sell.sellAmountSOL : '',
                    sell.sellAmountTokens !== null && sell.sellAmountTokens !== undefined ? sell.sellAmountTokens : '',
                    sell.transactionSignature || '',
                    sell.timestamp || ''
                );
            } else {
                // Empty cells for missing sells
                for (let j = 0; j < 8; j++) {
                    row.push('');
                }
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

// Make loadDashboardData available globally
window.loadDashboardData = loadDashboardData;
