/**
 * stock-sell.js — Manual stock sell command
 *
 * Usage:
 *   run stock-sell.js [SYM]        — sell all shares of one symbol
 *   run stock-sell.js all          — sell all held positions
 *
 * Examples:
 *   run stock-sell.js JGN
 *   run stock-sell.js all
 *
 * Compatible with Bitburner 3.0 API.
 */

import { formatMoney } from 'Utils.js';

const COMMISSION = 100_000;

/** @param {NS} ns */
export async function main(ns) {
    const arg = ns.args[0];

    if (!arg) {
        ns.tprint('Usage:');
        ns.tprint('  run stock-sell.js [SYM]   — sell all shares of one symbol');
        ns.tprint('  run stock-sell.js all      — sell all held positions');
        return;
    }

    const symbols = ns.stock.getSymbols();
    const targets = arg.toLowerCase() === 'all'
        ? symbols
        : [arg.toUpperCase()];

    // Validate symbol if not selling all
    if (arg.toLowerCase() !== 'all' && !symbols.includes(arg.toUpperCase())) {
        ns.tprint(`ERROR: Unknown symbol "${arg.toUpperCase()}". Valid symbols:`);
        ns.tprint(symbols.join(', '));
        return;
    }

    let totalProfit = 0;
    let soldAny     = false;

    for (const sym of targets) {
        const pos        = ns.stock.getPosition(sym);
        const longShares = pos[0];
        const longPrice  = pos[1];

        if (longShares <= 0) {
            if (arg.toLowerCase() !== 'all') {
                ns.tprint(`INFO: No position held in ${sym}.`);
            }
            continue;
        }

        const salePrice = ns.stock.sellStock(sym, longShares);
        if (salePrice === 0) {
            ns.tprint(`ERROR: Failed to sell ${sym}.`);
            continue;
        }

        const saleTotal = salePrice * longShares;
        const costBasis = longShares * longPrice;
        const profit    = saleTotal - costBasis - 2 * COMMISSION;
        totalProfit    += profit;
        soldAny         = true;

        const pnlStr  = (profit >= 0 ? '+' : '') + formatMoney(profit);
        const pctStr  = ((profit / costBasis) * 100).toFixed(2) + '%';
        ns.tprint(`✅ SOLD ${sym}: ${longShares.toLocaleString()} shares @ ${formatMoney(salePrice)} — P&L: ${pnlStr} (${pctStr})`);
    }

    if (soldAny && targets.length > 1) {
        ns.tprint(`─────────────────────────────────────`);
        ns.tprint(`Total realized P&L: ${(totalProfit >= 0 ? '+' : '') + formatMoney(totalProfit)}`);
    }

    if (!soldAny && arg.toLowerCase() === 'all') {
        ns.tprint('INFO: No positions held to sell.');
    }
}