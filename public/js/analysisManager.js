/**
 * Wallet analysis management
 */

import { state } from './state.js';
import * as api from './api.js';
import { showNotification, formatTimestamp, formatNum } from './utils.js';

// Import XLSX library (loaded via CDN in HTML)
// We'll use the global XLSX object

/**
 * Initialize column resizing for analysis table
 */
function initializeColumnResizing() {
    const table = document.getElementById('analysisTable');
    if (!table) return;
    
    const resizers = table.querySelectorAll('th .resizer');
    let currentResizer = null;
    let currentCell = null;
    let startX = 0;
    let startWidth = 0;
    
    resizers.forEach((resizer) => {
        resizer.addEventListener('mousedown', (e) => {
            e.preventDefault();
            e.stopPropagation();
            currentResizer = resizer;
            currentCell = resizer.parentElement;
            startX = e.pageX;
            startWidth = currentCell.offsetWidth;
            
            resizer.classList.add('active');
            
            document.addEventListener('mousemove', handleMouseMove);
            document.addEventListener('mouseup', handleMouseUp);
        });
    });
    
    function handleMouseMove(e) {
        if (!currentCell || !currentResizer) return;
        
        const diff = e.pageX - startX;
        const newWidth = startWidth + diff;
        
        if (newWidth > 50) { // Minimum width
            currentCell.style.width = `${newWidth}px`;
            currentCell.style.minWidth = `${newWidth}px`;
            
            // Update corresponding td cells
            const columnIndex = Array.from(currentCell.parentElement.children).indexOf(currentCell);
            const rows = table.querySelectorAll('tbody tr');
            rows.forEach(row => {
                const cell = row.children[columnIndex];
                if (cell) {
                    cell.style.width = `${newWidth}px`;
                    cell.style.minWidth = `${newWidth}px`;
                }
            });
        }
    }
    
    function handleMouseUp() {
        if (currentResizer) {
            currentResizer.classList.remove('active');
        }
        currentResizer = null;
        currentCell = null;
        document.removeEventListener('mousemove', handleMouseMove);
        document.removeEventListener('mouseup', handleMouseUp);
    }
}

/**
 * Analyze selected wallet
 */
export async function analyzeSelectedWallet() {
    // Use tab select instead of modal select
    const select = document.getElementById('walletSelectTab') || document.getElementById('walletSelect');
    const walletAddress = select ? select.value : state.selectedWalletForAnalysis;

    if (!walletAddress) {
        // Don't show error notification when called automatically
        return;
    }

    const container = document.getElementById('walletInfoContainer');

    // Show loading
    container.innerHTML = `
        <div class="loading">
            <div class="loading-spinner"></div>
            <p>Analyzing wallet...</p>
        </div>
    `;

    // Disable select during analysis
    if (select) {
        select.disabled = true;
    }

    try {
        const result = await api.analyzeWallet(walletAddress, state.analysisPage, state.analysisPageSize);

        if (!result.success) {
            throw new Error(result.error);
        }

        displayWalletInfo(result.data);
    } catch (error) {
        container.innerHTML = `
            <div class="wallet-info">
                <div class="wallet-info-section">
                    <p style="color: #ef4444; text-align: center;">
                        ❌ Failed to analyze wallet. Please try again.
                    </p>
                </div>
            </div>
        `;
        showNotification('Failed to analyze wallet', 'error');
    } finally {
        // Re-enable select after analysis
        if (select) {
            select.disabled = false;
        }
    }
}

/**
 * Display wallet analysis information
 */
export function displayWalletInfo(data) {
    const container = document.getElementById('walletInfoContainer');

    // Store data globally for fetchTokenInfo function (if needed)
    window.currentWalletData = data;
    
    // Update pagination state
    if (data.totalTrades !== undefined) {
        state.totalAnalysisTrades = data.totalTrades;
    }
    if (data.page !== undefined) {
        state.analysisPage = data.page;
    }
    if (data.pageSize !== undefined) {
        state.analysisPageSize = data.pageSize;
    }

    let tradesHTML = '';
    if (data.trades && data.trades.length > 0) {
        const SOL_MINT = 'So11111111111111111111111111111111111111112';

        const tradeRows = data.trades.map((trade, index) => {
            // Check if this is SOL
            const isSOL = trade.token_address === SOL_MINT;

            // Token name: WSOL for SOL, otherwise use token_name or Unknown
            const tokenName = isSOL ? 'WSOL' : (trade.token_name || 'Unknown Token');

            // Token image: wsol.svg for SOL
            const tokenImage = isSOL
                ? `<img src="/img/wsol.svg" alt="WSOL" class="token-image" style="width: 24px; height: 24px; border-radius: 50%; object-fit: cover; border: 1px solid #e5e7eb;">`
                : (trade.image
                    ? `<img src="${trade.image}" alt="${trade.symbol || '?'}" class="token-image" style="width: 24px; height: 24px; border-radius: 50%; object-fit: cover; border: 1px solid #e5e7eb;" onerror="this.src='/img/unknown_coin.png'">`
                    : `<img src="/img/unknown_coin.png" alt="Unknown Token" class="token-image" style="width: 24px; height: 24px; border-radius: 50%; object-fit: cover; border: 1px solid #e5e7eb;">`);

            // Token symbol: WSOL for SOL
            const tokenSymbol = isSOL ? 'WSOL' : (trade.symbol || '???');

            const creatorCell = trade.creator
                ? `<td class="token-creator-cell" title="${trade.creator}">
                    <a href="https://solscan.io/account/${trade.creator}" target="_blank" rel="noopener noreferrer" style="color: #667eea; text-decoration: none; font-family: 'Courier New', monospace; font-size: 0.7rem; white-space: nowrap;">
                        ${trade.creator}
                    </a>
                </td>`
                : `<td class="token-creator-cell" style="color: #9ca3af; font-style: italic;">-</td>`;

            // First Buy Info
            let firstBuyMarketCapDisplay;
            let firstBuyLabel = 'Market Cap:';
            if (trade.first_buy_mcap !== null && trade.first_buy_mcap !== undefined) {
                firstBuyMarketCapDisplay = `$${formatNum(trade.first_buy_mcap)}`;
            } else if (trade.first_buy_supply) {
                firstBuyLabel = 'Total Supply:';
                const supplyFormatted = formatNum(trade.first_buy_supply);
                firstBuyMarketCapDisplay = supplyFormatted;
            } else {
                firstBuyMarketCapDisplay = '<span style="color: #9ca3af; font-weight: normal; font-style: italic;">Not available</span>';
            }

            const firstBuyInfo = trade.first_buy_timestamp
                ? `<div style="display: flex; flex-direction: column; gap: 4px;">
                    <div style="font-weight: 600; color: #10b981;">${formatTimestamp(trade.first_buy_timestamp)}</div>
                    <div style="font-size: 0.7rem; color: #6b7280;">
                        <strong>Amount:</strong> ${formatNum(trade.first_buy_amount)}
                    </div>
                    <div style="font-size: 0.7rem; color: #10b981; font-weight: 600;">
                        <strong>${firstBuyLabel}</strong> ${firstBuyMarketCapDisplay}
                    </div>
                </div>`
                : '<span style="color: #9ca3af; font-style: italic;">-</span>';

            // First Sell Info
            let firstSellMarketCapDisplay;
            let firstSellLabel = 'Market Cap:';
            if (trade.first_sell_mcap !== null && trade.first_sell_mcap !== undefined) {
                firstSellMarketCapDisplay = `$${formatNum(trade.first_sell_mcap)}`;
            } else if (trade.first_sell_supply) {
                firstSellLabel = 'Total Supply:';
                const supplyFormatted = formatNum(trade.first_sell_supply);
                firstSellMarketCapDisplay = supplyFormatted;
            } else {
                firstSellMarketCapDisplay = '<span style="color: #9ca3af; font-weight: normal; font-style: italic;">Not available</span>';
            }

            const firstSellInfo = trade.first_sell_timestamp
                ? `<div style="display: flex; flex-direction: column; gap: 4px;">
                    <div style="font-weight: 600; color: #ef4444;">${formatTimestamp(trade.first_sell_timestamp)}</div>
                    <div style="font-size: 0.7rem; color: #6b7280;">
                        <strong>Amount:</strong> ${formatNum(trade.first_sell_amount)}
                    </div>
                    <div style="font-size: 0.7rem; color: #ef4444; font-weight: 600;">
                        <strong>${firstSellLabel}</strong> ${firstSellMarketCapDisplay}
                    </div>
                </div>`
                : '<span style="color: #9ca3af; font-style: italic;">-</span>';

            // Holding Duration Until 1st Sell
            const holdingDurationInfo = trade.holding_duration
                ? `<div style="font-size: 0.75rem; color: #667eea; font-weight: 600;">${trade.holding_duration}</div>`
                : '<span style="color: #9ca3af; font-style: italic;">-</span>';

            // Dev Buy Info
            let devBuyInfo;
            if (trade.dev_buy_amount && trade.dev_buy_amount_decimal !== null && trade.dev_buy_amount_decimal !== undefined) {
                const amountSpent = parseFloat(trade.dev_buy_amount) / Math.pow(10, trade.dev_buy_amount_decimal);
                const tokensReceived = trade.dev_buy_token_amount && trade.dev_buy_token_amount_decimal !== null && trade.dev_buy_token_amount_decimal !== undefined
                    ? parseFloat(trade.dev_buy_token_amount) / Math.pow(10, trade.dev_buy_token_amount_decimal)
                    : null;

                devBuyInfo = `<div style="display: flex; flex-direction: column; gap: 4px;">
                    <div style="font-size: 0.7rem; color: #6b7280; font-weight: 600; white-space: nowrap;">
                        <strong>Amount Spent:</strong> ${amountSpent.toLocaleString('en-US', { useGrouping: true, maximumFractionDigits: 18 })}
                    </div>
                    ${tokensReceived ? `
                        <div style="font-size: 0.7rem; color: #667eea; font-weight: 600;">
                            <strong>Tokens Received:</strong> ${formatNum(tokensReceived)}
                        </div>
                    ` : ''}
                    ${trade.dev_buy_used_token ? `
                        <div style="font-size: 0.65rem; color: #9ca3af; font-family: 'Courier New', monospace; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">
                            <strong>Token Used:</strong> ${trade.dev_buy_used_token}
                        </div>
                    ` : ''}
                </div>`;
            } else {
                devBuyInfo = '<span style="color: #9ca3af; font-style: italic;">-</span>';
            }

            // Total Sells (SOL amount) - centered
            const totalSells = trade.total_sells !== undefined && trade.total_sells !== null && trade.total_sells > 0
                ? `<div style="font-size: 0.75rem; color: #667eea; font-weight: 600; text-align: center;">${formatNum(trade.total_sells)} SOL</div>`
                : '<div style="text-align: center;"><span style="color: #9ca3af; font-style: italic;">-</span></div>';

            // Wallet Buy Amount (total SOL spent in buy transactions)
            const totalBuyAmount = trade.total_buy_amount !== undefined && trade.total_buy_amount !== null && trade.total_buy_amount > 0
                ? `<div style="font-size: 0.75rem; color: #10b981; font-weight: 600; text-align: center;">${formatNum(trade.total_buy_amount)} SOL</div>`
                : '<span style="color: #9ca3af; font-style: italic;">-</span>';

            // Wallet Buy Tokens (total token amount received in buy transactions)
            // Check if value exists and is a valid number (including 0)
            // Note: 0 is a valid value, so we check if it's not undefined/null and is a number
            const hasBuyTokens = trade.total_buy_tokens !== undefined && trade.total_buy_tokens !== null && !isNaN(trade.total_buy_tokens);
            const totalBuyTokens = hasBuyTokens
                ? `<div style="font-size: 0.75rem; color: #10b981; font-weight: 600; text-align: center;">${formatNum(trade.total_buy_tokens)}</div>`
                : '<span style="color: #9ca3af; font-style: italic;">-</span>';

            // Social Links
            const socialLinks = [];
            if (trade.twitter) {
                socialLinks.push(`<a href="${trade.twitter}" target="_blank" rel="noopener noreferrer" style="display: flex; align-items: center; gap: 4px; color: #60a5fa; text-decoration: none; font-size: 0.7rem; margin-bottom: 4px;" onmouseover="this.style.color='#93c5fd'" onmouseout="this.style.color='#60a5fa'">
                    <img src="/img/x-icon.svg" alt="Twitter/X" style="width: 16px; height: 16px;">
                    <span>Twitter/X</span>
                </a>`);
            }
            if (trade.website) {
                socialLinks.push(`<a href="${trade.website}" target="_blank" rel="noopener noreferrer" style="display: flex; align-items: center; gap: 4px; color: #60a5fa; text-decoration: none; font-size: 0.7rem; margin-bottom: 4px;" onmouseover="this.style.color='#93c5fd'" onmouseout="this.style.color='#60a5fa'">
                    <img src="/img/website.svg" alt="Website" style="width: 16px; height: 16px;">
                    <span>Website</span>
                </a>`);
            }
            if (trade.discord) {
                socialLinks.push(`<a href="${trade.discord}" target="_blank" rel="noopener noreferrer" style="display: flex; align-items: center; gap: 4px; color: #60a5fa; text-decoration: none; font-size: 0.7rem; margin-bottom: 4px;" onmouseover="this.style.color='#93c5fd'" onmouseout="this.style.color='#60a5fa'">
                    <img src="/img/discord.svg" alt="Discord" style="width: 16px; height: 16px;">
                    <span>Discord</span>
                </a>`);
            }
            if (trade.telegram) {
                socialLinks.push(`<a href="${trade.telegram}" target="_blank" rel="noopener noreferrer" style="display: flex; align-items: center; gap: 4px; color: #60a5fa; text-decoration: none; font-size: 0.7rem; margin-bottom: 4px;" onmouseover="this.style.color='#93c5fd'" onmouseout="this.style.color='#60a5fa'">
                    <img src="/img/telegram.svg" alt="Telegram" style="width: 16px; height: 16px;">
                    <span>Telegram</span>
                </a>`);
            }
            
            const socialCell = socialLinks.length > 0
                ? `<td style="font-size: 0.7rem;">
                    <div style="display: flex; flex-direction: column; gap: 2px;">
                        ${socialLinks.join('')}
                    </div>
                </td>`
                : '<td style="color: #9ca3af; font-style: italic; text-align: center;">-</td>';

            return `
                <tr>
                    <td class="token-index-cell">${index + 1}</td>
                    <td class="token-name-cell">
                        <div>
                            ${tokenImage}
                        <a href="https://solscan.io/token/${trade.token_address}" target="_blank" rel="noopener noreferrer" class="token-name-text" style="text-decoration: none; color: #667eea;">
                            ${tokenSymbol}
                        </a>
                        </div>
                    </td>
                    ${creatorCell}
                    <td style="font-size: 0.75rem;">${firstBuyInfo}</td>
                    <td style="font-size: 0.75rem;">${firstSellInfo}</td>
                    <td style="font-size: 0.75rem;">${holdingDurationInfo}</td>
                    <td style="font-size: 0.75rem;">${totalBuyAmount}</td>
                    <td style="font-size: 0.75rem;">${totalBuyTokens}</td>
                    <td style="font-size: 0.75rem;">${totalSells}</td>
                    <td class="token-dev-buy-cell" style="font-size: 0.75rem;">${devBuyInfo}</td>
                    ${socialCell}
                    <td style="text-align: center;">
                        <button 
                            onclick="window.exportTokenData('${data.wallet.replace(/'/g, "\\'")}', '${trade.token_address.replace(/'/g, "\\'")}', '${tokenSymbol.replace(/'/g, "\\'")}')"
                            class="btn-export"
                            style="padding: 6px 12px; background: #667eea; color: white; border: none; border-radius: 4px; cursor: pointer; font-size: 0.75rem; font-weight: 600; transition: all 0.2s;"
                            onmouseover="this.style.background='#5568d3'"
                            onmouseout="this.style.background='#667eea'"
                            title="Export to Excel"
                        >
                            📥 Export
                        </button>
                    </td>
                </tr>
            `;
        }).join('');

        tradesHTML = `
            <div class="table-container">
                <table class="token-table" id="analysisTable">
                    <thead>
                        <tr>
                            <th>🪙 #<span class="resizer"></span></th>
                            <th>Token<span class="resizer"></span></th>
                            <th>Creator<span class="resizer"></span></th>
                            <th>First Buy<span class="resizer"></span></th>
                            <th>First Sell<span class="resizer"></span></th>
                            <th>Holding Duration Until 1st Sell<span class="resizer"></span></th>
                            <th>Wallet Buy Amount<span class="resizer"></span></th>
                            <th>Wallet Buy Tokens<span class="resizer"></span></th>
                            <th>Total Sells<span class="resizer"></span></th>
                            <th>Dev Buy<span class="resizer"></span></th>
                            <th>Social<span class="resizer"></span></th>
                            <th>Action<span class="resizer"></span></th>
                        </tr>
                    </thead>
                    <tbody>
                        ${tradeRows}
                    </tbody>
                </table>
            </div>
        `;
        
        // Initialize column resizing after table is rendered
        setTimeout(() => {
            initializeColumnResizing();
        }, 0);
    } else {
        tradesHTML = '<div class="empty-tokens" style="padding: 20px; text-align: center; color: #9ca3af;">No trading history found for this wallet</div>';
    }

    // Build pagination HTML
    const totalPages = data.totalPages || Math.ceil((data.totalTrades || 0) / (data.pageSize || 50));
    const currentPage = data.page || 1;
    const paginationHTML = totalPages > 1 ? `
        <div class="pagination" style="display: flex; justify-content: center; align-items: center; gap: 12px; margin-top: 20px; padding: 12px; background: #1a1f2e; border-radius: 8px; border: 1px solid #334155;">
            <button 
                id="analysisPrevBtn" 
                onclick="window.analysisPreviousPage()"
                style="padding: 8px 16px; background: ${currentPage === 1 ? '#334155' : '#667eea'}; color: white; border: none; border-radius: 6px; cursor: ${currentPage === 1 ? 'not-allowed' : 'pointer'}; font-size: 0.85rem; font-weight: 600; transition: all 0.2s;"
                ${currentPage === 1 ? 'disabled' : ''}
                onmouseover="${currentPage !== 1 ? "this.style.background='#5568d3'" : ''}"
                onmouseout="${currentPage !== 1 ? "this.style.background='#667eea'" : ''}"
            >
                ← Previous
            </button>
            <span id="analysisPageInfo" style="color: #cbd5e1; font-size: 0.9rem; font-weight: 600;">
                Page ${currentPage} of ${totalPages || 1}
            </span>
            <button 
                id="analysisNextBtn" 
                onclick="window.analysisNextPage()"
                style="padding: 8px 16px; background: ${currentPage >= totalPages ? '#334155' : '#667eea'}; color: white; border: none; border-radius: 6px; cursor: ${currentPage >= totalPages ? 'not-allowed' : 'pointer'}; font-size: 0.85rem; font-weight: 600; transition: all 0.2s;"
                ${currentPage >= totalPages ? 'disabled' : ''}
                onmouseover="${currentPage < totalPages ? "this.style.background='#5568d3'" : ''}"
                onmouseout="${currentPage < totalPages ? "this.style.background='#667eea'" : ''}"
            >
                Next →
            </button>
        </div>
    ` : '';

    container.innerHTML = `
        <div class="wallet-info">
            <div class="wallet-info-section">
                <h3 style="font-size: 1.1rem; margin-bottom: 15px;">🪙 Tokens Traded <span style="background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); color: white; padding: 4px 12px; border-radius: 20px; font-size: 0.85rem; margin-left: 8px;">${data.totalTrades || 0}</span></h3>
                <div class="token-list">
                    ${tradesHTML}
                </div>
                ${paginationHTML}
            </div>
        </div>
    `;
}

/**
 * Update pagination UI for analysis
 */
export function updateAnalysisPagination() {
    const totalPages = Math.ceil(state.totalAnalysisTrades / state.analysisPageSize);
    const pageInfo = document.getElementById('analysisPageInfo');
    const prevBtn = document.getElementById('analysisPrevBtn');
    const nextBtn = document.getElementById('analysisNextBtn');
    
    if (pageInfo) {
        pageInfo.textContent = `Page ${state.analysisPage} of ${totalPages || 1}`;
    }
    
    if (prevBtn) {
        prevBtn.disabled = state.analysisPage === 1;
        prevBtn.style.background = state.analysisPage === 1 ? '#334155' : '#667eea';
        prevBtn.style.cursor = state.analysisPage === 1 ? 'not-allowed' : 'pointer';
    }
    
    if (nextBtn) {
        nextBtn.disabled = state.analysisPage >= totalPages;
        nextBtn.style.background = state.analysisPage >= totalPages ? '#334155' : '#667eea';
        nextBtn.style.cursor = state.analysisPage >= totalPages ? 'not-allowed' : 'pointer';
    }
}

/**
 * Go to previous page in analysis
 */
export function analysisPreviousPage() {
    if (state.analysisPage > 1) {
        state.analysisPage--;
        analyzeSelectedWallet();
    }
}

/**
 * Go to next page in analysis
 */
export function analysisNextPage() {
    const totalPages = Math.ceil(state.totalAnalysisTrades / state.analysisPageSize);
    if (state.analysisPage < totalPages) {
        state.analysisPage++;
        analyzeSelectedWallet();
    }
}

/**
 * Export token data to XLSX
 */
async function exportTokenData(walletAddress, tokenAddress, tokenSymbol) {
    try {
        showNotification('Preparing export...', 'info');
        
        // Call server-side endpoint to generate Excel file with proper styling
        const result = await api.downloadTokenExcel(walletAddress, tokenAddress);
        
        if (!result.success) {
            throw new Error(result.error || 'Failed to download Excel file');
        }
        
        showNotification('Export completed successfully!', 'success');
    } catch (error) {
        console.error('Export error:', error);
        showNotification(`Export failed: ${error.message}`, 'error');
    }
}

// Make export function available globally
window.exportTokenData = exportTokenData;

/**
 * Export all tokens data to XLSX
 */
async function exportAllTokenData() {
    const select = document.getElementById('walletSelectTab') || document.getElementById('walletSelect');
    const walletAddress = select ? select.value : null;

    if (!walletAddress) {
        showNotification('Please select a wallet first', 'error');
        return;
    }

    try {
        showNotification('Preparing export for all tokens...', 'info');
        
        // Call server-side endpoint to generate Excel file with all tokens
        const result = await api.downloadAllTokensExcel(walletAddress);
        
        if (!result.success) {
            throw new Error(result.error || 'Failed to download Excel file');
        }
        
        showNotification('Export completed successfully!', 'success');
    } catch (error) {
        console.error('Export error:', error);
        showNotification(`Export failed: ${error.message}`, 'error');
    }
}

// Make export all function available globally
window.exportAllTokenData = exportAllTokenData;

