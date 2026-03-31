/**
 * corp-recover.js — Emergency warehouse unclogger
 *
 * Discards all boost materials by selling them at $0,
 * stops boost material buying, and fixes energy/morale.
 *
 * After running: wait 1-2 corp cycles (10-20s) for SALE state
 * to clear the materials, then re-run corp-manager normally.
 * Corp-actions will re-buy boost materials at the correct 50% cap.
 *
 * Usage: run corp-recover.js
 */

const ALL_CITIES    = ['Aevum', 'Chongqing', 'Sector-12', 'New Tokyo', 'Ishima', 'Volhaven'];
const BOOST_MATS    = ['Hardware', 'Robots', 'AI Cores', 'Real Estate'];
const PARTY_PER_EMP = 500_000;

/** @param {NS} ns */
export async function main(ns) {
    ns.disableLog('ALL');
    ns.ui.openTail();
    ns.ui.setTailTitle('🚑 Corp Recovery');

    const divs = ns.corporation.getCorporation().divisions
        .filter(d => {
            try { return !['Noodle Bar','Quick Bites','Street Eats'].includes(d); }
            catch { return true; }
        });

    ns.tprint(`🚑 Unclogging ${divs.length} division(s)...`);

    for (const div of divs) {
        ns.tprint(`── ${div} ──`);
        for (const city of ALL_CITIES) {
            // 1. Stop buying boost materials
            for (const mat of BOOST_MATS) {
                try { ns.corporation.buyMaterial(div, city, mat, 0); } catch {}
            }

            // 2. Sell boost materials at $0 to discard them
            for (const mat of BOOST_MATS) {
                try {
                    ns.corporation.sellMaterial(div, city, mat, 'MAX', '0');
                } catch (e) {
                    ns.print(`⚠ sell ${mat} ${city}: ${e}`);
                }
            }

            // 3. Tea + party to fix morale/energy
            try {
                const o = ns.corporation.getOffice(div, city);
                if (o.numEmployees > 0) {
                    try { ns.corporation.buyTea(div, city); } catch {}
                    try { ns.corporation.throwParty(div, city, PARTY_PER_EMP); } catch {}
                }
            } catch {}

            // Report
            try {
                const wh = ns.corporation.getWarehouse(div, city);
                const o  = ns.corporation.getOffice(div, city);
                ns.tprint(`  ${city}: WH ${Math.floor(wh.sizeUsed/wh.size*100)}% | E:${o.avgEnergy?.toFixed(0)} M:${o.avgMorale?.toFixed(0)}`);
            } catch {}
        }
    }

    ns.tprint('');
    ns.tprint('✅ Done. Boost mats selling at $0 — clears on next SALE cycle (~10s).');
    ns.tprint('   Corp-manager will re-buy them at the correct levels automatically.');
    ns.tprint('   You may need to run this 2-3 times until warehouses drop below 50%.');
}