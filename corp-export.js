/**
 * corp-export.js — Set up export routes Agriculture → Tobacco
 *
 * Spawned by corp-manager.js once Export unlock is purchased.
 * Sets optimal export formula then exits.
 *
 * Export formula per docs: (IPROD+IINV/10)*(-1)
 * This keeps Tobacco stocked optimally without overflow.
 *
 * Args: agriDiv tobaccoDiv
 * Usage: run corp-export.js [agriDiv] [tobaccoDiv]
 */

const ALL_CITIES = ['Aevum', 'Chongqing', 'Sector-12', 'New Tokyo', 'Ishima', 'Volhaven'];

// Tobacco only needs Plants (not Food) per getIndustryData
const EXPORT_MATERIALS = ['Plants'];

/** @param {NS} ns */
export async function main(ns) {
    ns.disableLog('ALL');

    const agri    = ns.args[0];
    const tobacco = ns.args[1];

    if (!agri || !tobacco) {
        ns.tprint('corp-export: usage: run corp-export.js [agriDiv] [tobaccoDiv]');
        return;
    }

    ns.tprint(`📤 Setting up export routes: ${agri} → ${tobacco}`);

    let set = 0;
    for (const city of ALL_CITIES) {
        for (const mat of EXPORT_MATERIALS) {
            // Cancel existing route first to avoid duplicates
            try { ns.corporation.cancelExportMaterial(agri, city, tobacco, city, mat); } catch {}

            // Set export with optimal formula
            try {
                ns.corporation.exportMaterial(agri, city, tobacco, city, mat, '(IPROD+IINV/10)*(-1)');
                set++;
            } catch (e) {
                ns.tprint(`⚠ Export ${mat} ${city}: ${e}`);
            }
        }
    }

    ns.tprint(`✅ Export routes set: ${set}/${ALL_CITIES.length * EXPORT_MATERIALS.length}`);
}