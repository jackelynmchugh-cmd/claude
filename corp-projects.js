/**
 * corp-products.js — Tobacco product development manager
 *
 * Spawned by corp-manager.js in phase 3.
 * Checks product status, sells finished products, starts new ones.
 * Exits after taking action so it doesn't hog RAM.
 *
 * Args: tobaccoDiv
 * Usage: run corp-products.js [tobaccoDiv]
 */

const ALL_CITIES = ['Aevum', 'Chongqing', 'Sector-12', 'New Tokyo', 'Ishima', 'Volhaven'];
const MAIN_CITY  = 'Aevum';
const MAX_PRODUCTS = 3; // base limit — increases with uPgrade: Capacity research

/** @param {NS} ns */
export async function main(ns) {
    ns.disableLog('ALL');

    const tobacco = ns.args[0];
    if (!tobacco) { ns.tprint('corp-products: no division specified'); return; }

    const funds = () => ns.corporation.getCorporation().funds;

    try {
        const div      = ns.corporation.getDivision(tobacco);
        const products = div.products;

        // Check if anything is still developing
        for (const p of products) {
            try {
                const prod = ns.corporation.getProduct(tobacco, MAIN_CITY, p);
                if (prod.developmentProgress < 100) {
                    ns.print(`⏳ ${p}: ${prod.developmentProgress.toFixed(1)}%`);
                    return; // wait — one product at a time
                }

                // Product is done — set up selling
                for (const city of ALL_CITIES) {
                    // Try Market-TA.II first, fall back to static multiplier
                    try {
                        ns.corporation.setProductMarketTA2(tobacco, p, true);
                        ns.corporation.sellProduct(tobacco, city, p, 'MAX', 'MP', true);
                    } catch {
                        try { ns.corporation.sellProduct(tobacco, city, p, 'MAX', 'MP*5', true); } catch {}
                    }
                }
            } catch {}
        }

        // Discontinue oldest product if at limit
        if (products.length >= MAX_PRODUCTS) {
            try {
                ns.corporation.discontinueProduct(tobacco, products[0]);
                ns.print(`🗑 Discontinued: ${products[0]}`);
            } catch {}
        }

        // Start new product — 1% of funds split evenly design/marketing
        // Per docs: higher budget = better product rating = more revenue
        const budget  = Math.min(funds() * 0.01, 1e11);
        const version = products.length > 0
            ? (parseInt(products[products.length - 1].match(/\d+$/)?.[0] ?? '0') + 1)
            : 1;
        const name = `HeavenSmoke-v${version}`;

        try {
            ns.corporation.makeProduct(tobacco, MAIN_CITY, name, budget / 2, budget / 2);
            ns.tprint(`🚬 New product: ${name} ($${ns.formatNumber(budget)} budget)`);
        } catch (e) {
            ns.print(`⚠ makeProduct: ${e}`);
        }

    } catch (e) { ns.tprint(`⚠ corp-products: ${e}`); }
}