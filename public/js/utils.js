/**
 * Utility functions for notifications, formatting, and UI helpers
 */

// Show notification
export function showNotification(message, type = 'info') {
    const notification = document.createElement('div');
    notification.className = `notification ${type}`;
    notification.textContent = message;
    document.body.appendChild(notification);

    setTimeout(() => {
        notification.remove();
    }, 3000);
}

// Get platform badge class
export function getPlatformClass(platform) {
    const platformLower = platform.toLowerCase();
    if (platformLower.includes('raydium')) return 'platform-raydium';
    if (platformLower.includes('orca')) return 'platform-orca';
    if (platformLower.includes('meteora')) return 'platform-meteora';
    if (platformLower.includes('pumpfun')) return 'platform-pumpfun';
    if (platformLower.includes('pump')) return 'platform-pump';
    return 'platform-unknown';
}

// Format large numbers
export function formatNumber(num) {
    if (!num || num === '0') return '0';
    const number = parseFloat(num);
    // Display full number with up to 6 decimal places, removing trailing zeros
    return number.toLocaleString('en-US', {
        minimumFractionDigits: 0,
        maximumFractionDigits: 6
    });
}

// Format currency (market cap)
export function formatCurrency(value) {
    if (value === null || value === undefined || isNaN(value)) return 'N/A';
    const num = parseFloat(value);
    if (num === 0) return '$0';
    
    // For very large numbers, use abbreviated format
    if (num >= 1e9) {
        return `$${(num / 1e9).toFixed(2)}B`;
    } else if (num >= 1e6) {
        return `$${(num / 1e6).toFixed(2)}M`;
    } else if (num >= 1e3) {
        return `$${(num / 1e3).toFixed(2)}K`;
    } else {
        return `$${num.toLocaleString('en-US', {
            minimumFractionDigits: 2,
            maximumFractionDigits: 2
        })}`;
    }
}

// Format timestamp
export function formatTime(timestamp) {
    const date = new Date(timestamp);
    return date.toLocaleString();
}

// Format timestamp for analysis (detailed)
export function formatTimestamp(timestamp) {
    if (!timestamp) return '-';
    const date = new Date(timestamp);
    return date.toLocaleString('en-US', {
        year: 'numeric',
        month: 'short',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit'
    });
}

// Format number for analysis
export function formatNum(val) {
    if (!val && val !== 0) return '-';
    if (typeof val === 'string') {
        val = parseFloat(val);
    }
    if (isNaN(val)) return '-';
    return val.toLocaleString('en-US', { maximumFractionDigits: 2 });
}

