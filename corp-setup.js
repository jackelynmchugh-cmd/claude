/**
 * corp-setup.js — City expansion and warehouse setup
 *
 * RAM: ~55GB
 * expandCity(20) + purchaseWarehouse(20) + setSmartSupply(20) + base(1.6)
 * Note: no read calls needed — just tries each city and catches errors
 *
 * Args: divisionName
 * Usage: run corp-setup.js [div]
 */

const ALL_CITIES = ['Aevum', 'Chongqing', 'Sector-12', 'New Tokyo', 'Ishima', 'Volhaven'];

/** @param {NS} ns */
export async function main(ns) {
    ns.disableLog('ALL');

    const div = ns.args[0];
    if (!div) { ns.tprint('corp-setup: no division'); return; }

    for (const city of ALL_CITIES) {
        try { ns.corporation.expandCity(div, city); ns.print(`🏙 ${div}/${city}`); } catch {}
        try { ns.corporation.purchaseWarehouse(div, city); ns.print(`🏭 WH: ${div}/${city}`); } catch {}
        try { ns.corporation.setSmartSupply(div, city, true); } catch {}
    }

    ns.print(`✅ Setup: ${div}`);
}