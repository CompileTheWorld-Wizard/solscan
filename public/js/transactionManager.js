/**
 * Transaction management and rendering
 */

import { state } from './state.js';
import * as api from './api.js';
import { showNotification, formatNumber, formatCurrency, formatTime, getPlatformClass } from './utils.js';

/**
 * Copy text to clipboard
 */
async function copyToClipboard(text) {
    try {
        await navigator.clipboard.writeText(text);
        showNotification('Copied to clipboard!', 'success');
    } catch (err) {
        // Fallback for older browsers
        const textArea = document.createElement('textarea');
        textArea.value = text;
        textArea.style.position = 'fixed';
        textArea.style.left = '-999999px';
        document.body.appendChild(textArea);
        textArea.select();
        try {
            document.execCommand('copy');
            showNotification('Copied to clipboard!', 'success');
        } catch (err) {
            showNotification('Failed to copy', 'error');
        }
        document.body.removeChild(textArea);
    }
}

/**
 * Create a copy icon button
 */
function createCopyIcon(textToCopy) {
    return `
        <button 
            onclick="event.stopPropagation(); event.preventDefault(); window.copyAddressToClipboard('${textToCopy.replace(/'/g, "\\'")}')" 
            class="copy-icon-btn" 
            title="Copy address"
            style="background: transparent; border: none; cursor: pointer; padding: 4px; display: inline-flex; align-items: center; justify-content: center; color: #9ca3af; transition: color 0.2s; margin-left: 6px; flex-shrink: 0;"
            onmouseover="this.style.color='#667eea'"
            onmouseout="this.style.color='#9ca3af'"
        >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect>
                <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path>
            </svg>
        </button>
    `;
}

/**
 * Fetch and render transactions
 */
export async function fetchTransactions() {
    try {
        // Use selectedWalletForTransactions (single wallet or null)
        const walletFilter = state.selectedWalletForTransactions ? [state.selectedWalletForTransactions] : [];
        const result = await api.fetchTransactions(
            state.currentPage,
            state.pageSize,
            walletFilter
        );

        if (!result.success) {
            throw new Error(result.error);
        }

        state.totalTransactions = result.data.total;
        document.getElementById('totalTransactions').textContent = state.totalTransactions;

        // Debug: log first transaction to see structure
        if (result.data.transactions && result.data.transactions.length > 0) {
            console.log('Sample transaction data:', result.data.transactions[0]);
            console.log('Has tipAmount?', 'tipAmount' in result.data.transactions[0]);
            console.log('Has feeAmount?', 'feeAmount' in result.data.transactions[0]);
        }

        renderTransactions(result.data.transactions);
        updatePagination();
    } catch (error) {
        console.error('Failed to fetch transactions:', error);
        showNotification('Failed to fetch transactions', 'error');
    }
}

/**
 * Render transactions in the table
 */
function renderTransactions(transactions) {
    const tbody = document.getElementById('transactionsBody');

    if (transactions.length === 0) {
        tbody.innerHTML = `
            <tr>
                <td colspan="11">
                    <div class="empty-state">
                        <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M20 13V6a2 2 0 00-2-2H6a2 2 0 00-2 2v7m16 0v5a2 2 0 01-2 2H6a2 2 0 01-2-2v-5m16 0h-2.586a1 1 0 00-.707.293l-2.414 2.414a1 1 0 01-.707.293h-3.172a1 1 0 01-.707-.293l-2.414-2.414A1 1 0 006.586 13H4" />
                        </svg>
                        <h3>No transactions yet</h3>
                        <p>Start tracking addresses to see transactions appear here</p>
                    </div>
                </td>
            </tr>
        `;
        return;
    }

    tbody.innerHTML = transactions.map(tx => {
        // Helper function to get token image
        const getTokenImage = (mintAddress, image) => {
            const SOL_MINT = 'So11111111111111111111111111111111111111112';
            if (mintAddress === SOL_MINT) {
                return '/img/wsol.svg';
            }
            if (image) {
                return image;
            }
            return '/img/unknown_coin.png';
        };

        // Helper function to get token name
        const getTokenName = (mintAddress, name) => {
            const SOL_MINT = 'So11111111111111111111111111111111111111112';
            if (mintAddress === SOL_MINT) {
                return 'WSOL';
            }
            if (name) {
                return name;
            }
            return 'Unknown';
        };

        // Helper function to render token cell
        const renderTokenCell = (mintAddress, name, image, symbol) => {
            const SOL_MINT = 'So11111111111111111111111111111111111111112';
            const tokenImage = getTokenImage(mintAddress, image);
            const tokenName = getTokenName(mintAddress, name);
            // For SOL, always show WSOL, otherwise prefer symbol over name
            const displayName = (mintAddress === SOL_MINT) ? 'WSOL' : (symbol || tokenName);

            return `
                <div style="display: flex; align-items: center; gap: 8px;">
                    <img src="${tokenImage}" alt="${tokenName}" style="width: 24px; height: 24px; border-radius: 50%; object-fit: cover; border: 1px solid #e5e7eb;" onerror="this.src='/img/unknown_coin.png'">
                    <a href="https://solscan.io/token/${mintAddress}" target="_blank" rel="noopener noreferrer" style="text-decoration: none; color: #667eea; font-weight: 500;" title="${mintAddress}">
                        ${displayName}
                    </a>
                    ${createCopyIcon(mintAddress)}
                </div>
            `;
        };

        // Helper function to truncate address
        const truncateAddress = (address, startLength = 8, endLength = 6) => {
            if (!address || address.length <= startLength + endLength) {
                return address;
            }
            return `${address.substring(0, startLength)}...${address.substring(address.length - endLength)}`;
        };

        // Helper function to format SOL amount (for fee+tip)
        const formatSOL = (value) => {
            if (value === null || value === undefined || value === '') {
                return '-';
            }
            const num = parseFloat(value);
            if (isNaN(num) || num === 0) {
                return '-';
            }
            // Format with up to 9 decimal places, but remove trailing zeros
            return num.toFixed(9).replace(/\.?0+$/, '') + ' SOL';
        };

        // Calculate fee+tip
        // Handle both null/undefined and string values from database
        // Also handle potential case variations (tip_amount, tipAmount, etc.)
        const tipAmount = (tx.tipAmount != null ? parseFloat(tx.tipAmount) :
            tx.tip_amount != null ? parseFloat(tx.tip_amount) : 0) || 0;
        const feeAmount = (tx.feeAmount != null ? parseFloat(tx.feeAmount) :
            tx.fee_amount != null ? parseFloat(tx.fee_amount) : 0) || 0;

        // Debug logging (remove in production if needed)
        if (tx.tipAmount != null || tx.feeAmount != null || tx.tip_amount != null || tx.fee_amount != null) {
            console.log('Transaction fee data:', {
                transaction_id: tx.transaction_id,
                tipAmount: tx.tipAmount,
                feeAmount: tx.feeAmount,
                tip_amount: tx.tip_amount,
                fee_amount: tx.fee_amount,
                parsed_tipAmount: tipAmount,
                parsed_feeAmount: feeAmount
            });
        }

        // Display fee and tip on separate lines
        const feeDisplay = formatSOL(feeAmount);
        const tipDisplay = formatSOL(tipAmount);
        const feeTipDisplay = feeDisplay !== '-' || tipDisplay !== '-'
            ? `<div style="line-height: 1.4;">
                <div>Fee: ${feeDisplay}</div>
                <div>Tip: ${tipDisplay}</div>
               </div>`
            : '-';

        return `
        <tr>
            <td class="mono" title="${tx.transaction_id}" >
                <div style="display: flex; align-items: center; gap: 6px; min-width: 0;">
                    <a href="https://solscan.io/tx/${tx.transaction_id}" target="_blank" rel="noopener noreferrer" style="flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">
                        ${truncateAddress(tx.transaction_id)}
                    </a>
                    ${createCopyIcon(tx.transaction_id)}
                </div>
            </td>
            <td><span class="platform-badge ${getPlatformClass(tx.platform)}">${tx.platform}</span></td>
            <td>${tx.type}</td>
            <td>${renderTokenCell(tx.mint_from, tx.mint_from_name, tx.mint_from_image, tx.mint_from_symbol)}</td>
            <td>${renderTokenCell(tx.mint_to, tx.mint_to_name, tx.mint_to_image, tx.mint_to_symbol)}</td>
            <td>${formatNumber(tx.in_amount)}</td>
            <td>${formatNumber(tx.out_amount)}</td>
            <td class="mono" title="${tx.feePayer}" >
                <div style="display: flex; align-items: center; gap: 6px; min-width: 0;">
                    <a href="https://solscan.io/account/${tx.feePayer}" target="_blank" rel="noopener noreferrer" style="flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">
                        ${truncateAddress(tx.feePayer)}
                    </a>
                    ${createCopyIcon(tx.feePayer)}
                </div>
            </td>
            <td style="white-space: nowrap;">${feeTipDisplay}</td>
            <td>${formatCurrency(tx.marketCap)}</td>
            <td>${formatTime(tx.created_at)}</td>
        </tr>
    `;
    }).join('');
}

/**
 * Update pagination UI
 */
function updatePagination() {
    const totalPages = Math.ceil(state.totalTransactions / state.pageSize);
    document.getElementById('pageInfo').textContent = `Page ${state.currentPage} of ${totalPages || 1}`;

    document.getElementById('prevBtn').disabled = state.currentPage === 1;
    document.getElementById('nextBtn').disabled = state.currentPage >= totalPages;
}

/**
 * Go to previous page
 */
export function previousPage() {
    if (state.currentPage > 1) {
        state.currentPage--;
        fetchTransactions();
    }
}

/**
 * Go to next page
 */
export function nextPage() {
    const totalPages = Math.ceil(state.totalTransactions / state.pageSize);
    if (state.currentPage < totalPages) {
        state.currentPage++;
        fetchTransactions();
    }
}

/**
 * Start auto-refresh
 */
export function startAutoRefresh() {
    if (state.autoRefreshInterval) return;

    state.autoRefreshInterval = setInterval(() => {
        fetchTransactions();
    }, 3000); // Refresh every 3 seconds
}

/**
 * Stop auto-refresh
 */
export function stopAutoRefresh() {
    if (state.autoRefreshInterval) {
        clearInterval(state.autoRefreshInterval);
        state.autoRefreshInterval = null;
    }
}

