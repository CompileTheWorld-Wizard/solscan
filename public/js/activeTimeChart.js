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
        
        // Format labels based on interval
        const formatLabel = (period, interval) => {
            if (!period) return '';
            
            // Convert period to string and clean it up
            let periodStr = String(period);
            
            // If it's a Date object string, extract the date part
            if (periodStr.includes('GMT') || periodStr.includes('UTC') || periodStr.includes('T')) {
                // Try to parse as Date and format
                try {
                    const date = new Date(periodStr);
                    if (!isNaN(date.getTime())) {
                        switch (interval) {
                            case 'hour':
                                const hour = String(date.getUTCHours()).padStart(2, '0');
                                const minute = String(date.getUTCMinutes()).padStart(2, '0');
                                const year = date.getUTCFullYear();
                                const month = String(date.getUTCMonth() + 1).padStart(2, '0');
                                const day = String(date.getUTCDate()).padStart(2, '0');
                                periodStr = `${year}-${month}-${day} ${hour}:${minute}`;
                                break;
                            case 'day':
                                const dYear = date.getUTCFullYear();
                                const dMonth = String(date.getUTCMonth() + 1).padStart(2, '0');
                                const dDay = String(date.getUTCDate()).padStart(2, '0');
                                periodStr = `${dYear}-${dMonth}-${dDay}`;
                                break;
                            case 'month':
                                const mYear = date.getUTCFullYear();
                                const mMonth = String(date.getUTCMonth() + 1).padStart(2, '0');
                                periodStr = `${mYear}-${mMonth}`;
                                break;
                        }
                    }
                } catch (e) {
                    // If parsing fails, use the string as is
                }
            }
            
            switch (interval) {
                case 'hour':
                    // Format: "2024-01-15 14:00" -> "01/15 14:00"
                    if (periodStr.includes(' ')) {
                        const [date, time] = periodStr.split(' ');
                        const dateParts = date.split('-');
                        if (dateParts.length >= 3) {
                            return `${dateParts[1]}/${dateParts[2]} ${time}`;
                        }
                    }
                    return periodStr;
                    
                case 'quarter_day':
                    // Format: "2024-01-15 Morning" -> "01/15 Morning"
                    if (periodStr.includes(' ')) {
                        const parts = periodStr.split(' ');
                        if (parts.length >= 2) {
                            const dateParts = parts[0].split('-');
                            if (dateParts.length >= 3) {
                                const timeOfDay = parts.slice(1).join(' ');
                                return `${dateParts[1]}/${dateParts[2]} ${timeOfDay}`;
                            }
                        }
                    }
                    return periodStr;
                    
                case 'day':
                    // Format: "2024-01-15" -> "01/15"
                    if (periodStr.includes('-')) {
                        const dateParts = periodStr.split('-');
                        if (dateParts.length >= 3 && dateParts[0] && dateParts[1] && dateParts[2]) {
                            return `${dateParts[1]}/${dateParts[2]}`;
                        }
                    }
                    return periodStr;
                    
                case 'week':
                    // Format: "2024-W01" -> "W01 2024"
                    if (periodStr.includes('-W')) {
                        const [year, week] = periodStr.split('-W');
                        if (year && week) {
                            return `W${week} ${year}`;
                        }
                    }
                    return periodStr;
                    
                case 'month':
                    // Format: "2024-01" -> "Jan 2024"
                    if (periodStr.includes('-')) {
                        const parts = periodStr.split('-');
                        if (parts.length >= 2 && parts[0] && parts[1]) {
                            const year = parts[0];
                            const month = parts[1];
                            const monthNames = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 
                                              'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
                            const monthIndex = parseInt(month) - 1;
                            if (monthIndex >= 0 && monthIndex < 12) {
                                return `${monthNames[monthIndex]} ${year}`;
                            }
                        }
                    }
                    return periodStr;
                    
                default:
                    return periodStr;
            }
        };
        
        // Prepare chart data with formatted labels
        const labels = result.data.map(item => formatLabel(item.period, interval));
        const buysData = result.data.map(item => item.buys);
        const sellsData = result.data.map(item => item.sells);
        const totalData = result.data.map(item => item.total);
        const pnlPercentData = result.data.map(item => item.pnlPercent || 0);
        
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
                        fill: chartType === 'line',
                        yAxisID: 'y'
                    },
                    {
                        label: 'Sells',
                        data: sellsData,
                        borderColor: 'rgb(239, 68, 68)',
                        backgroundColor: chartType === 'bar' ? 'rgba(239, 68, 68, 0.5)' : 'rgba(239, 68, 68, 0.1)',
                        tension: 0.1,
                        fill: chartType === 'line',
                        yAxisID: 'y'
                    },
                    {
                        label: 'Total',
                        data: totalData,
                        borderColor: 'rgb(59, 130, 246)',
                        backgroundColor: chartType === 'bar' ? 'rgba(59, 130, 246, 0.5)' : 'rgba(59, 130, 246, 0.1)',
                        tension: 0.1,
                        fill: chartType === 'line',
                        yAxisID: 'y'
                    },
                    {
                        label: 'PNL %',
                        data: pnlPercentData,
                        borderColor: 'rgb(168, 85, 247)',
                        backgroundColor: chartType === 'bar' ? 'rgba(168, 85, 247, 0.5)' : 'rgba(168, 85, 247, 0.1)',
                        tension: 0.1,
                        fill: chartType === 'line',
                        yAxisID: 'y1',
                        borderDash: [5, 5]
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
                            maxRotation: interval === 'hour' || interval === 'quarter_day' ? 45 : 0,
                            minRotation: 0,
                            maxTicksLimit: interval === 'hour' ? 24 : interval === 'day' ? 14 : interval === 'week' ? 12 : interval === 'month' ? 12 : 20
                        },
                        grid: {
                            color: '#334155'
                        }
                    },
                    y: {
                        beginAtZero: true,
                        position: 'left',
                        ticks: {
                            color: '#94a3b8',
                            stepSize: 1
                        },
                        grid: {
                            color: '#334155'
                        },
                        title: {
                            display: true,
                            text: 'Transaction Count',
                            color: '#94a3b8'
                        }
                    },
                    y1: {
                        beginAtZero: false,
                        position: 'right',
                        ticks: {
                            color: '#a855f7',
                            callback: function(value) {
                                return value.toFixed(2) + '%';
                            }
                        },
                        grid: {
                            drawOnChartArea: false,
                            color: '#334155'
                        },
                        title: {
                            display: true,
                            text: 'PNL %',
                            color: '#a855f7'
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

