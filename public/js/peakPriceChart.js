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
        
        // Prepare chart data - group all dots by type into three vertical columns
        // Column 0: Peak Before 1st Sell
        // Column 1: 1st Sell
        // Column 2: Peak After 1st Sell
        // Add small random jitter to x position to prevent perfect overlap
        const peakBeforeData = [];
        const firstSellData = [];
        const peakAfterData = [];
        
        // Helper function to add jitter (random offset between -0.15 and 0.15)
        const addJitter = () => (Math.random() - 0.5) * 0.3;
        
        // Calculate sums for averages
        let peakBeforeSum = 0;
        let peakBeforeCount = 0;
        let firstSellSum = 0;
        let firstSellCount = 0;
        let peakAfterSum = 0;
        let peakAfterCount = 0;
        
        dataPoints.forEach((dp) => {
            if (dp.peakMarketCapBeforeSell !== null && dp.peakMarketCapBeforeSell !== undefined) {
                peakBeforeData.push({ 
                    x: 0 + addJitter(), 
                    y: dp.peakMarketCapBeforeSell,
                    token: dp.token,
                    tokenAddress: dp.tokenAddress
                });
                peakBeforeSum += dp.peakMarketCapBeforeSell;
                peakBeforeCount++;
            }
            if (dp.firstSellMarketCap !== null && dp.firstSellMarketCap !== undefined) {
                firstSellData.push({ 
                    x: 1 + addJitter(), 
                    y: dp.firstSellMarketCap,
                    token: dp.token,
                    tokenAddress: dp.tokenAddress
                });
                firstSellSum += dp.firstSellMarketCap;
                firstSellCount++;
            }
            if (dp.peakMarketCapAfterSell !== null && dp.peakMarketCapAfterSell !== undefined) {
                peakAfterData.push({ 
                    x: 2 + addJitter(), 
                    y: dp.peakMarketCapAfterSell,
                    token: dp.token,
                    tokenAddress: dp.tokenAddress
                });
                peakAfterSum += dp.peakMarketCapAfterSell;
                peakAfterCount++;
            }
        });
        
        // Calculate averages
        const avgPeakBefore = peakBeforeCount > 0 ? peakBeforeSum / peakBeforeCount : null;
        const avgFirstSell = firstSellCount > 0 ? firstSellSum / firstSellCount : null;
        const avgPeakAfter = peakAfterCount > 0 ? peakAfterSum / peakAfterCount : null;
        
        // Format average value for display
        const formatMarketCap = (value) => {
            if (value === null || value === undefined) return 'N/A';
            if (value >= 1000000) {
                return `$${(value / 1000000).toFixed(2)}M`;
            } else if (value >= 1000) {
                return `$${(value / 1000).toFixed(2)}K`;
            } else {
                return `$${value.toFixed(2)}`;
            }
        };
        
        // Chart.js configuration for scatter plot
        const ctx = canvas.getContext('2d');
        
        const chartConfig = {
            type: 'scatter',
            data: {
                datasets: [
                    {
                        label: `Peak before 1st Sell (Avg: ${formatMarketCap(avgPeakBefore)})`,
                        data: peakBeforeData,
                        backgroundColor: 'rgba(59, 130, 246, 0.6)',
                        borderColor: 'rgb(59, 130, 246)',
                        pointRadius: 5,
                        pointHoverRadius: 7
                    },
                    {
                        label: `1st Sell (Avg: ${formatMarketCap(avgFirstSell)})`,
                        data: firstSellData,
                        backgroundColor: 'rgba(34, 197, 94, 0.6)',
                        borderColor: 'rgb(34, 197, 94)',
                        pointRadius: 5,
                        pointHoverRadius: 7
                    },
                    {
                        label: `Peak after 1st Sell (Avg: ${formatMarketCap(avgPeakAfter)})`,
                        data: peakAfterData,
                        backgroundColor: 'rgba(168, 85, 247, 0.6)',
                        borderColor: 'rgb(168, 85, 247)',
                        pointRadius: 5,
                        pointHoverRadius: 7
                    },
                    // Average lines for Peak Before
                    ...(avgPeakBefore !== null ? [{
                        label: 'Avg Peak Before',
                        data: [{ x: -0.5, y: avgPeakBefore }, { x: 0.5, y: avgPeakBefore }],
                        type: 'line',
                        borderColor: 'rgba(59, 130, 246, 0.8)',
                        borderWidth: 2,
                        borderDash: [5, 5],
                        pointRadius: 0,
                        fill: false,
                        showLine: true
                    }] : []),
                    // Average lines for 1st Sell
                    ...(avgFirstSell !== null ? [{
                        label: 'Avg 1st Sell',
                        data: [{ x: 0.5, y: avgFirstSell }, { x: 1.5, y: avgFirstSell }],
                        type: 'line',
                        borderColor: 'rgba(34, 197, 94, 0.8)',
                        borderWidth: 2,
                        borderDash: [5, 5],
                        pointRadius: 0,
                        fill: false,
                        showLine: true
                    }] : []),
                    // Average lines for Peak After
                    ...(avgPeakAfter !== null ? [{
                        label: 'Avg Peak After',
                        data: [{ x: 1.5, y: avgPeakAfter }, { x: 2.5, y: avgPeakAfter }],
                        type: 'line',
                        borderColor: 'rgba(168, 85, 247, 0.8)',
                        borderWidth: 2,
                        borderDash: [5, 5],
                        pointRadius: 0,
                        fill: false,
                        showLine: true
                    }] : [])
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
                            },
                            filter: function(item, chart) {
                                // Hide the average line datasets from legend (they're shown in main labels)
                                return !item.text.includes('Avg Peak Before') && 
                                       !item.text.includes('Avg 1st Sell') && 
                                       !item.text.includes('Avg Peak After');
                            }
                        }
                    },
                    tooltip: {
                        callbacks: {
                            title: function(context) {
                                // Get token info from the data point
                                const dataPoint = context[0].raw;
                                if (dataPoint && dataPoint.token) {
                                    return dataPoint.token;
                                }
                                return context.dataset.label;
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
                                return `Market Cap: ${formattedValue}`;
                            },
                            afterBody: function(context) {
                                const dataPoint = context[0].raw;
                                if (dataPoint && dataPoint.tokenAddress) {
                                    return [
                                        `Address: ${dataPoint.tokenAddress.substring(0, 8)}...`
                                    ];
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
                                const labels = ['Peak before 1st Sell', '1st Sell', 'Peak after 1st Sell'];
                                if (index >= 0 && index < labels.length) {
                                    return labels[index];
                                }
                                return '';
                            },
                            color: '#94a3b8',
                            maxRotation: 0,
                            minRotation: 0,
                            font: {
                                size: 12
                            }
                        },
                        grid: {
                            color: '#334155',
                            display: true
                        },
                        title: {
                            display: false
                        },
                        min: -0.5,
                        max: 2.5
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

