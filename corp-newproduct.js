/**
 * corp-new-product.js — Discontinue oldest + start new product
 *
 * RAM: ~52GB
 * discontinueProduct(20) + makeProduct(20) + getCorporation(10) + base(1.6)
 *
 * Args: tobaccoDiv needsSlot [existing product names...]
 * Usage: run corp-new-product.js [div] [needsSlot] [p1] [p2] ...
 */

const MAIN_CITY = 'Aevum';

/** @param {NS} ns */
export async function main(ns) {
    ns.disableLog('ALL');

    const tobacco   = ns.args[0];
    const needsSlot = ns.args[1] === 'true';
    const products  = ns.args.slice(2);

    if (!tobacco) { ns.tprint('corp-new-product: no division'); return; }

    // Discontinue oldest if at limit
    if (needsSlot && products.length > 0) {
        try {
            ns.corporation.discontinueProduct(tobacco, products[0]);
            ns.tprint(`🗑 Discontinued: ${products[0]}`);
        } catch (e) { ns.print(`⚠ discontinue: ${e}`); }
    }

    // New product name — increment version from last product
    const lastVersion = products.length > 0
        ? (parseInt(products[products.length - 1].match(/\d+$/)?.[0] ?? '0') + 1)
        : 1;
    const name   = `HeavenSmoke-v${lastVersion}`;
    const budget = Math.min(ns.corporation.getCorporation().funds * 0.01, 1e11);

    try {
        ns.corporation.makeProduct(tobacco, MAIN_CITY, name, budget / 2, budget / 2);
        ns.tprint(`🚬 New product: ${name} ($${ns.format.number(budget)} budget)`);
    } catch (e) { ns.tprint(`⚠ makeProduct: ${e}`); }
}