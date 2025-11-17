/**
 * Active Time Chart Manager
 * Handles trading activity chart display
 */

import * as api from './api.js';

let activityChart = null;
let currentWallet = null;

/**
 * Open the active time chart modal
 */
export function openActiveTimeChart() {
    const select = document.getElementById('dashboardWalletSelect');
    if (!select || !select.value) {
        alert('Please select a wallet first');
        return;
    }
    
    currentWallet = select.value;
    const modal = document.getElementById('activeTimeChartModal');
    if (modal) {
        modal.style.display = 'flex';
        modal.style.alignItems = 'center';
        modal.style.justifyContent = 'center';
        // Close modal when clicking outside
        modal.onclick = (e) => {
            if (e.target === modal) {
                closeActiveTimeChart();
            }
        };
        // Load chart data
        updateActivityChart();
    }
}

/**
 * Close the active time chart modal
 */
export function closeActiveTimeChart() {
    const modal = document.getElementById('activeTimeChartModal');
    if (modal) {
        modal.style.display = 'none';
    }
    // Destroy chart if it exists
    if (activityChart) {
        activityChart.destroy();
        activityChart = null;
    }
}

/**
 * Update the activity chart based on selected interval and chart type
 */
export async function updateActivityChart() {
    if (!currentWallet) {
        return;
    }
    
    const intervalSelect = document.getElementById('activityIntervalSelect');
    const chartTypeSelect = document.getElementById('activityChartTypeSelect');
    const loadingEl = document.getElementById('activityChartLoading');
    const errorEl = document.getElementById('activityChartError');
    const canvas = document.getElementById('activityChartCanvas');
    
    if (!intervalSelect || !chartTypeSelect || !loadingEl || !errorEl || !canvas) {
        return;
    }
    
    const interval = intervalSelect.value;
    const chartType = chartTypeSelect.value;
    
    // Show loading, hide error
    loadingEl.style.display = 'block';
    errorEl.style.display = 'none';
    canvas.style.display = 'none';
    
    // Destroy existing chart
    if (activityChart) {
        activityChart.destroy();
        activityChart = null;
    }
    
    try {
        const result = await api.fetchWalletActivity(currentWallet, interval);
        
        if (!result.success || !result.data || result.data.length === 0) {
            errorEl.textContent = 'No trading activity data available for this wallet';
            errorEl.style.display = 'block';
            loadingEl.style.display = 'none';
            return;
        }
        
        // Hide loading, show canvas
        loadingEl.style.display = 'none';
        canvas.style.display = 'block';
        
        // Prepare chart data
        const labels = result.data.map(item => item.period);
        const buysData = result.data.map(item => item.buys);
        const sellsData = result.data.map(item => item.sells);
        const totalData = result.data.map(item => item.total);
        
        // Chart.js configuration
        const ctx = canvas.getContext('2d');
        
        const chartConfig = {
            type: chartType,
            data: {
                labels: labels,
                datasets: [
                    {
                        label: 'Buys',
                        data: buysData,
                        borderColor: 'rgb(34, 197, 94)',
                        backgroundColor: chartType === 'bar' ? 'rgba(34, 197, 94, 0.5)' : 'rgba(34, 197, 94, 0.1)',
                        tension: 0.1,
                        fill: chartType === 'line'
                    },
                    {
                        label: 'Sells',
                        data: sellsData,
                        borderColor: 'rgb(239, 68, 68)',
                        backgroundColor: chartType === 'bar' ? 'rgba(239, 68, 68, 0.5)' : 'rgba(239, 68, 68, 0.1)',
                        tension: 0.1,
                        fill: chartType === 'line'
                    },
                    {
                        label: 'Total',
                        data: totalData,
                        borderColor: 'rgb(59, 130, 246)',
                        backgroundColor: chartType === 'bar' ? 'rgba(59, 130, 246, 0.5)' : 'rgba(59, 130, 246, 0.1)',
                        tension: 0.1,
                        fill: chartType === 'line'
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
                        mode: 'index',
                        intersect: false,
                        backgroundColor: 'rgba(15, 20, 25, 0.9)',
                        titleColor: '#e0e7ff',
                        bodyColor: '#e0e7ff',
                        borderColor: '#334155',
                        borderWidth: 1
                    }
                },
                scales: {
                    x: {
                        ticks: {
                            color: '#94a3b8',
                            maxRotation: 45,
                            minRotation: 0
                        },
                        grid: {
                            color: '#334155'
                        }
                    },
                    y: {
                        beginAtZero: true,
                        ticks: {
                            color: '#94a3b8',
                            stepSize: 1
                        },
                        grid: {
                            color: '#334155'
                        }
                    }
                },
                interaction: {
                    mode: 'nearest',
                    axis: 'x',
                    intersect: false
                }
            }
        };
        
        activityChart = new Chart(ctx, chartConfig);
        
    } catch (error) {
        console.error('Error loading activity chart:', error);
        errorEl.textContent = 'Error loading chart data: ' + (error.message || 'Unknown error');
        errorEl.style.display = 'block';
        loadingEl.style.display = 'none';
    }
}

// Make functions available globally
window.openActiveTimeChart = openActiveTimeChart;
window.closeActiveTimeChart = closeActiveTimeChart;
window.updateActivityChart = updateActivityChart;

