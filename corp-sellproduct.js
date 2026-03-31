/**
 * corp-sell-product.js — Set sell orders on finished products
 *
 * RAM: ~52GB
 * setProductMarketTA2(20) + sellProduct(20) + getCorporation(10) + base(1.6)
 *
 * Args: tobaccoDiv [product names...]
 * Usage: run corp-sell-product.js [tobaccoDiv] [p1] [p2] ...
 */

const ALL_CITIES = ['Aevum', 'Chongqing', 'Sector-12', 'New Tokyo', 'Ishima', 'Volhaven'];

/** @param {NS} ns */
export async function main(ns) {
    ns.disableLog('ALL');

    const tobacco  = ns.args[0];
    const products = ns.args.slice(1);

    if (!tobacco || products.length === 0) {
        ns.tprint('corp-sell-product: usage: run corp-sell-product.js [div] [p1] [p2]...');
        return;
    }

    for (const p of products) {
        for (const city of ALL_CITIES) {
            try {
                ns.corporation.setProductMarketTA2(tobacco, p, true);
                ns.corporation.sellProduct(tobacco, city, p, 'MAX', 'MP', true);
            } catch {
                try { ns.corporation.sellProduct(tobacco, city, p, 'MAX', 'MP*5', true); } catch {}
            }
        }
    }

    ns.print(`✅ Sell orders set for: ${products.join(', ')}`);
}