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
            
            // Get peak price before first sell
            const peakBeforeSell = token.tokenPeakPriceBeforeFirstSell;
            
            // Get first sell price from dashboard data
            const firstSellPrice = token.firstSellPrice;
            
            // Get peak price 10s after first sell
            const peakAfterSell = token.tokenPeakPrice10sAfterFirstSell;
            
            // Only add data points if we have at least one valid price
            if (peakBeforeSell !== null || firstSellPrice !== null || peakAfterSell !== null) {
                
                labels.push(tokenLabel);
                dataPoints.push({
                    token: tokenLabel,
                    tokenAddress: token.tokenAddress,
                    peakBeforeSell: peakBeforeSell,
                    firstSellPrice: firstSellPrice,
                    peakAfterSell: peakAfterSell
                });
            }
        });
        
        if (dataPoints.length === 0) {
            errorEl.textContent = 'No peak price data available for tokens with first sell';
            errorEl.style.display = 'block';
            loadingEl.style.display = 'none';
            return;
        }
        
        // Hide loading, show canvas
        loadingEl.style.display = 'none';
        canvas.style.display = 'block';
        
        // Prepare chart data - we'll create a scatter plot with three series
        // Use token index as x-axis
        const peakBeforeData = [];
        const firstSellData = [];
        const peakAfterData = [];
        
        dataPoints.forEach((dp, idx) => {
            if (dp.peakBeforeSell !== null && dp.peakBeforeSell !== undefined) {
                peakBeforeData.push({ x: idx, y: dp.peakBeforeSell });
            }
            if (dp.firstSellPrice !== null && dp.firstSellPrice !== undefined) {
                firstSellData.push({ x: idx, y: dp.firstSellPrice });
            }
            if (dp.peakAfterSell !== null && dp.peakAfterSell !== undefined) {
                peakAfterData.push({ x: idx, y: dp.peakAfterSell });
            }
        });
        
        // Chart.js configuration for scatter plot
        const ctx = canvas.getContext('2d');
        
        const chartConfig = {
            type: 'scatter',
            data: {
                datasets: [
                    {
                        label: 'Peak Price Before 1st Sell',
                        data: peakBeforeData,
                        backgroundColor: 'rgba(34, 197, 94, 0.6)',
                        borderColor: 'rgb(34, 197, 94)',
                        pointRadius: 6,
                        pointHoverRadius: 8
                    },
                    {
                        label: '1st Sell Price',
                        data: firstSellData,
                        backgroundColor: 'rgba(239, 68, 68, 0.6)',
                        borderColor: 'rgb(239, 68, 68)',
                        pointRadius: 6,
                        pointHoverRadius: 8
                    },
                    {
                        label: 'Peak Price 10s After 1st Sell',
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
                                return `${context.dataset.label}: $${value.toFixed(6)}`;
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
                                return '$' + value.toFixed(4);
                            }
                        },
                        grid: {
                            color: '#334155'
                        },
                        title: {
                            display: true,
                            text: 'Price (USD)',
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

