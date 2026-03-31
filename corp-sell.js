/**
 * corp-sell.js — Set sell orders for materials
 *
 * RAM: ~25GB
 * sellMaterial(20) + base(1.6)
 *
 * Args: divisionName [material names...]
 * Usage: run corp-sell.js [div] [mat1] [mat2] ...
 * Example: run corp-sell.js "Fluffy butt farm" Food Plants
 */

const ALL_CITIES = ['Aevum', 'Chongqing', 'Sector-12', 'New Tokyo', 'Ishima', 'Volhaven'];

/** @param {NS} ns */
export async function main(ns) {
    ns.disableLog('ALL');

    const div       = ns.args[0];
    const materials = ns.args.slice(1);

    if (!div || materials.length === 0) {
        ns.tprint('corp-sell: usage: run corp-sell.js [div] [mat1] [mat2] ...');
        return;
    }

    for (const city of ALL_CITIES) {
        for (const mat of materials) {
            try { ns.corporation.sellMaterial(div, city, mat, 'MAX', 'MP'); } catch {}
        }
    }

    ns.print(`✅ Sell orders set: ${div} — ${materials.join(', ')}`);
}