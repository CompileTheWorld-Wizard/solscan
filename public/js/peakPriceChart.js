/**
 * Peak Price Chart Manager
 * Handles token peak price chart display (dot chart)
 */

import * as api from './api.js';

let peakPriceChart = null;
let currentWallet = null;

/**
 * Open the peak price chart modal
 */
export function openPeakPriceChart() {
    const select = document.getElementById('dashboardWalletSelect');
    if (!select || !select.value) {
        alert('Please select a wallet first');
        return;
    }
    
    currentWallet = select.value;
    const modal = document.getElementById('peakPriceChartModal');
    if (modal) {
        modal.style.display = 'flex';
        modal.style.alignItems = 'center';
        modal.style.justifyContent = 'center';
        // Close modal when clicking outside
        modal.onclick = (e) => {
            if (e.target === modal) {
                closePeakPriceChart();
            }
        };
        // Load chart data
        updatePeakPriceChart();
    }
}

/**
 * Close the peak price chart modal
 */
export function closePeakPriceChart() {
    const modal = document.getElementById('peakPriceChartModal');
    if (modal) {
        modal.style.display = 'none';
    }
    // Destroy chart if it exists
    if (peakPriceChart) {
        peakPriceChart.destroy();
        peakPriceChart = null;
    }
}

/**
 * Calculate price from market cap and total supply
 */
function calculatePriceFromMarketCap(marketCap, totalSupply) {
    if (!marketCap || !totalSupply || totalSupply === 0) {
        return null;
    }
    return marketCap / totalSupply;
}

/**
 * Update the peak price chart
 */
export async function updatePeakPriceChart() {
    if (!currentWallet) {
        return;
    }
    
    const loadingEl = document.getElementById('peakPriceChartLoading');
    const errorEl = document.getElementById('peakPriceChartError');
    const canvas = document.getElementById('peakPriceChartCanvas');
    
    if (!loadingEl || !errorEl || !canvas) {
        return;
    }
    
    // Show loading, hide error
    loadingEl.style.display = 'block';
    errorEl.style.display = 'none';
    canvas.style.display = 'none';
    
    // Destroy existing chart
    if (peakPriceChart) {
        peakPriceChart.destroy();
        peakPriceChart = null;
    }
    
    try {
        // Fetch dashboard data to get peak price information
        const result = await api.fetchDashboardData(currentWallet);
        
        if (!result.success || !result.data || result.data.length === 0) {
            errorEl.textContent = 'No token data available for this wallet';
            errorEl.style.display = 'block';
            loadingEl.style.display = 'none';
            return;
        }
        
        // Prepare data points for the chart
        const dataPoints = [];
        const labels = [];
        
        result.data.forEach((token, index) => {
            // Skip tokens without first sell
            if (!token.sells || token.sells.length === 0) {
                return;
            }
            
            const firstSell = token.sells[0];
            const tokenLabel = token.tokenSymbol || token.tokenName || `Token ${index + 1}`;
            
            // Get peak market cap before first sell
            const peakMarketCapBeforeSell = token.tokenPeakMarketCapBeforeFirstSell;
            
            // Get first sell market cap from dashboard data
            const firstSellMarketCap = firstSell.marketCap;
            
            // Get peak market cap 10s after first sell
            const peakMarketCapAfterSell = token.tokenPeakMarketCap10sAfterFirstSell;
            
            // Only add data points if we have at least one valid market cap
            if (peakMarketCapBeforeSell !== null || firstSellMarketCap !== null || peakMarketCapAfterSell !== null) {
                
                labels.push(tokenLabel);
                dataPoints.push({
                    token: tokenLabel,
                    tokenAddress: token.tokenAddress,
                    peakMarketCapBeforeSell: peakMarketCapBeforeSell,
                    firstSellMarketCap: firstSellMarketCap,
                    peakMarketCapAfterSell: peakMarketCapAfterSell
                });
            }
        });
        
        if (dataPoints.length === 0) {
            errorEl.textContent = 'No peak market cap data available for tokens with first sell';
            errorEl.style.display = 'block';
            loadingEl.style.display = 'none';
            return;
        }
        
        // Hide loading, show canvas
        loadingEl.style.display = 'none';
        canvas.style.display = 'block';
        
        // Prepare chart data - we'll create a scatter plot with three series
        // Group dots by type by adding small offsets to x-axis
        // Peak Before: x - 0.2, 1st Sell: x, Peak After: x + 0.2
        const peakBeforeData = [];
        const firstSellData = [];
        const peakAfterData = [];
        
        dataPoints.forEach((dp, idx) => {
            if (dp.peakMarketCapBeforeSell !== null && dp.peakMarketCapBeforeSell !== undefined) {
                peakBeforeData.push({ x: idx - 0.2, y: dp.peakMarketCapBeforeSell });
            }
            if (dp.firstSellMarketCap !== null && dp.firstSellMarketCap !== undefined) {
                firstSellData.push({ x: idx, y: dp.firstSellMarketCap });
            }
            if (dp.peakMarketCapAfterSell !== null && dp.peakMarketCapAfterSell !== undefined) {
                peakAfterData.push({ x: idx + 0.2, y: dp.peakMarketCapAfterSell });
            }
        });
        
        // Chart.js configuration for scatter plot
        const ctx = canvas.getContext('2d');
        
        const chartConfig = {
            type: 'scatter',
            data: {
                datasets: [
                    {
                        label: 'Peak Market Cap Before 1st Sell',
                        data: peakBeforeData,
                        backgroundColor: 'rgba(34, 197, 94, 0.6)',
                        borderColor: 'rgb(34, 197, 94)',
                        pointRadius: 6,
                        pointHoverRadius: 8
                    },
                    {
                        label: '1st Sell Market Cap',
                        data: firstSellData,
                        backgroundColor: 'rgba(239, 68, 68, 0.6)',
                        borderColor: 'rgb(239, 68, 68)',
                        pointRadius: 6,
                        pointHoverRadius: 8
                    },
                    {
                        label: 'Peak Market Cap 10s After 1st Sell',
                        data: peakAfterData,
                        backgroundColor: 'rgba(59, 130, 246, 0.6)',
                        borderColor: 'rgb(59, 130, 246)',
                        pointRadius: 6,
                        pointHoverRadius: 8
                    }
                ]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                plugins: {
                    legend: {
                        display: true,
                        position: 'top',
                        labels: {
                            color: '#e0e7ff',
                            font: {
                                size: 12
                            }
                        }
                    },
                    tooltip: {
                        callbacks: {
                            title: function(context) {
                                const xValue = context[0].parsed.x;
                                const index = Math.round(xValue);
                                if (index >= 0 && index < labels.length) {
                                    return labels[index] || 'Token';
                                }
                                return 'Token';
                            },
                            label: function(context) {
                                const value = context.parsed.y;
                                if (value === null || value === undefined) return '';
                                // Format market cap with appropriate units
                                let formattedValue;
                                if (value >= 1000000) {
                                    formattedValue = `$${(value / 1000000).toFixed(2)}M`;
                                } else if (value >= 1000) {
                                    formattedValue = `$${(value / 1000).toFixed(2)}K`;
                                } else {
                                    formattedValue = `$${value.toFixed(2)}`;
                                }
                                return `${context.dataset.label}: ${formattedValue}`;
                            },
                            afterBody: function(context) {
                                const xValue = context[0].parsed.x;
                                const index = Math.round(xValue);
                                if (index >= 0 && index < dataPoints.length) {
                                    const dp = dataPoints[index];
                                    if (dp) {
                                        return [
                                            `Token: ${dp.token}`,
                                            `Address: ${dp.tokenAddress.substring(0, 8)}...`
                                        ];
                                    }
                                }
                                return [];
                            }
                        },
                        backgroundColor: 'rgba(15, 20, 25, 0.9)',
                        titleColor: '#e0e7ff',
                        bodyColor: '#e0e7ff',
                        borderColor: '#334155',
                        borderWidth: 1
                    }
                },
                scales: {
                    x: {
                        type: 'linear',
                        position: 'bottom',
                        ticks: {
                            stepSize: 1,
                            callback: function(value) {
                                const index = Math.round(value);
                                if (index >= 0 && index < labels.length) {
                                    const label = labels[index];
                                    return label.length > 12 ? label.substring(0, 12) + '...' : label;
                                }
                                return '';
                            },
                            color: '#94a3b8',
                            maxRotation: 45,
                            minRotation: 45,
                            font: {
                                size: 10
                            }
                        },
                        grid: {
                            color: '#334155',
                            display: true
                        },
                        title: {
                            display: true,
                            text: 'Token',
                            color: '#94a3b8'
                        },
                        min: -0.5,
                        max: labels.length > 0 ? labels.length - 0.5 : 0
                    },
                    y: {
                        beginAtZero: false,
                        ticks: {
                            color: '#94a3b8',
                            callback: function(value) {
                                // Format market cap with appropriate units
                                if (value >= 1000000) {
                                    return '$' + (value / 1000000).toFixed(2) + 'M';
                                } else if (value >= 1000) {
                                    return '$' + (value / 1000).toFixed(2) + 'K';
                                } else {
                                    return '$' + value.toFixed(2);
                                }
                            }
                        },
                        grid: {
                            color: '#334155'
                        },
                        title: {
                            display: true,
                            text: 'Market Cap (USD)',
                            color: '#94a3b8'
                        }
                    }
                },
                interaction: {
                    mode: 'nearest',
                    axis: 'xy',
                    intersect: false
                }
            }
        };
        
        peakPriceChart = new Chart(ctx, chartConfig);
        
    } catch (error) {
        console.error('Error loading peak price chart:', error);
        errorEl.textContent = 'Error loading chart data: ' + (error.message || 'Unknown error');
        errorEl.style.display = 'block';
        loadingEl.style.display = 'none';
    }
}

// Make functions available globally
window.openPeakPriceChart = openPeakPriceChart;
window.closePeakPriceChart = closePeakPriceChart;
window.updatePeakPriceChart = updatePeakPriceChart;

