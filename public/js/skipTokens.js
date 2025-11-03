/**
 * Skip tokens management
 */

import * as api from './api.js';
import { showNotification } from './utils.js';

/**
 * Fetch and display skip tokens
 */
export async function fetchSkipTokens() {
    try {
        const result = await api.fetchSkipTokens();
        
        if (result.success) {
            displaySkipTokens(result.data);
        }
    } catch (error) {
        console.error('Failed to fetch skip tokens:', error);
    }
}

/**
 * Display skip tokens list
 */
function displaySkipTokens(skipTokens) {
    const container = document.getElementById('skipTokensList');
    
    if (!skipTokens || skipTokens.length === 0) {
        container.innerHTML = '<p style="color: #9ca3af; font-style: italic; font-size: 0.85rem;">No skip tokens configured</p>';
        return;
    }
    
    container.innerHTML = skipTokens.map(token => `
        <div style="display: inline-flex; align-items: center; gap: 8px; padding: 8px 12px; background: #f3f4f6; border-radius: 6px; font-size: 0.85rem;">
            <span style="font-weight: 600; color: #1f2937;">${token.symbol || 'Token'}</span>
            <span style="color: #6b7280; font-family: 'Courier New', monospace; font-size: 0.75rem;" title="${token.mint_address}">
                ${token.mint_address.substring(0, 8)}...
            </span>
            ${token.description ? `<span style="color: #9ca3af; font-size: 0.75rem;">| ${token.description}</span>` : ''}
            <button onclick="window.removeSkipTokenHandler('${token.mint_address}')" 
                    style="background: none; border: none; color: #ef4444; cursor: pointer; padding: 0; font-size: 1rem; line-height: 1;"
                    title="Remove">
                ×
            </button>
        </div>
    `).join('');
}

/**
 * Add skip token
 */
export async function addSkipToken() {
    const mintInput = document.getElementById('skipTokenMint');
    const symbolInput = document.getElementById('skipTokenSymbol');
    
    const mint = mintInput.value.trim();
    const symbol = symbolInput.value.trim();
    
    if (!mint) {
        showNotification('⚠️ Please enter a token mint address', 'error');
        return;
    }
    
    try {
        const result = await api.addSkipToken(mint, symbol);
        
        if (result.success) {
            showNotification('✅ Skip token added successfully', 'success');
            mintInput.value = '';
            symbolInput.value = '';
            fetchSkipTokens();
        } else {
            showNotification('❌ ' + (result.error || 'Failed to add skip token'), 'error');
        }
    } catch (error) {
        console.error('Failed to add skip token:', error);
        showNotification('❌ Error adding skip token', 'error');
    }
}

/**
 * Remove skip token
 */
export async function removeSkipToken(mintAddress) {
    if (!confirm('Remove this token from skip list?')) {
        return;
    }
    
    try {
        const result = await api.removeSkipToken(mintAddress);
        
        if (result.success) {
            showNotification('✅ Skip token removed successfully', 'success');
            fetchSkipTokens();
        } else {
            showNotification('❌ ' + (result.error || 'Failed to remove skip token'), 'error');
        }
    } catch (error) {
        console.error('Failed to remove skip token:', error);
        showNotification('❌ Error removing skip token', 'error');
    }
}

// Make functions globally available for inline handlers
window.removeSkipTokenHandler = removeSkipToken;

