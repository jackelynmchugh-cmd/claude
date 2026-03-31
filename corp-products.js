/**
 * corp-products.js — Tobacco product development manager, then exit
 *
 * RAM: ~111GB
 * getDivision(10) + getProduct(10) + setProductMarketTA2(20) +
 * sellProduct(20) + discontinueProduct(20) + makeProduct(20) +
 * getCorporation(10) + base(1.6)
 *
 * Checks product status. If in development, exits.
 * If all done: sets sell orders, discontinues oldest if needed, starts new product.
 *
 * Args: tobaccoDivName
 * Usage: run corp-products.js [tobaccoDiv]
 */

const ALL_CITIES   = ['Aevum', 'Chongqing', 'Sector-12', 'New Tokyo', 'Ishima', 'Volhaven'];
const MAIN_CITY    = 'Aevum';
const MAX_PRODUCTS = 3;

/** @param {NS} ns */
export async function main(ns) {
    ns.disableLog('ALL');

    const tobacco = ns.args[0];
    if (!tobacco) { ns.tprint('corp-products: no division'); return; }

    let products;
    try {
        products = ns.corporation.getDivision(tobacco).products;
    } catch (e) { ns.tprint(`⚠ getDivision: ${e}`); return; }

    // Check development progress
    for (const p of products) {
        try {
            const prod = ns.corporation.getProduct(tobacco, MAIN_CITY, p);
            if (prod.developmentProgress < 100) {
                ns.print(`⏳ ${p}: ${prod.developmentProgress.toFixed(1)}%`);
                return; // still developing — nothing to do yet
            }
        } catch {}
    }

    // All products done — set sell orders
    for (const p of products) {
        for (const city of ALL_CITIES) {
            try {
                ns.corporation.setProductMarketTA2(tobacco, p, true);
                ns.corporation.sellProduct(tobacco, city, p, 'MAX', 'MP', true);
            } catch {
                // Market-TA.II not researched yet
                try { ns.corporation.sellProduct(tobacco, city, p, 'MAX', 'MP*5', true); } catch {}
            }
        }
    }

    // Discontinue oldest if at limit
    if (products.length >= MAX_PRODUCTS) {
        try {
            ns.corporation.discontinueProduct(tobacco, products[0]);
            ns.tprint(`🗑 Discontinued: ${products[0]}`);
            products = products.slice(1);
        } catch {}
    }

    // Start new product
    const lastVer = products.length > 0
        ? (parseInt(products[products.length - 1].match(/\d+$/)?.[0] ?? '0') + 1)
        : 1;
    const name   = `HeavenSmoke-v${lastVer}`;
    const budget = Math.min(ns.corporation.getCorporation().funds * 0.01, 1e11);

    try {
        ns.corporation.makeProduct(tobacco, MAIN_CITY, name, budget / 2, budget / 2);
        ns.tprint(`🚬 New product: ${name} ($${ns.format.number(budget)} budget)`);
    } catch (e) { ns.tprint(`⚠ makeProduct: ${e}`); }
}