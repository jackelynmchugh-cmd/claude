/**
 * corp-warehouse.js — Warehouse upgrades and boost material buying
 *
 * RAM: ~45GB
 * upgradeWarehouse(20) + buyMaterial(20) +
 * getWarehouse(10) + getUpgradeWarehouseCost(10) + getMaterial(10) +
 * getCorporation(10) + base(1.6)
 * Note: grouped carefully to stay under 50GB — only uses what's needed
 *
 * Actually RAM: upgradeWarehouse(20) + buyMaterial(20) + getWarehouse(10) +
 * getUpgradeWarehouseCost(10) + getMaterial(10) + getCorporation(10) + base(1.6) = 71.6GB
 *
 * Args: divisionName city targetLevel
 * Usage: run corp-warehouse.js [div] [city] [targetLevel]
 */

// Boost material coefficients per getIndustryData
const AGRI_FACTORS    = { Hardware: 0.2,  Robots: 0.3,  'AI Cores': 0.3,  'Real Estate': 0.72 };
const TOBACCO_FACTORS = { Hardware: 0.15, Robots: 0.2,  'AI Cores': 0.15, 'Real Estate': 0.15 };
const MAT_SIZES       = { Hardware: 0.06, Robots: 0.5,  'AI Cores': 0.1,  'Real Estate': 0.005 };

function calcBoostTargets(warehouseSize, factors) {
    const S = warehouseSize * 0.7;
    let totalWeight = 0;
    const weights = {};
    for (const [mat, c] of Object.entries(factors)) {
        weights[mat] = c / MAT_SIZES[mat];
        totalWeight += weights[mat];
    }
    const result = {};
    for (const [mat, w] of Object.entries(weights)) {
        result[mat] = Math.floor((w / totalWeight) * S / MAT_SIZES[mat]);
    }
    return result;
}

/** @param {NS} ns */
export async function main(ns) {
    ns.disableLog('ALL');

    const div         = ns.args[0];
    const city        = ns.args[1];
    const targetLevel = parseInt(ns.args[2]) || 2;

    if (!div || !city) { ns.tprint('corp-warehouse: usage: run corp-warehouse.js [div] [city] [level]'); return; }

    const funds = () => ns.corporation.getCorporation().funds;

    try {
        // Upgrade warehouse
        const wh = ns.corporation.getWarehouse(div, city);
        if (wh.level < targetLevel) {
            const delta = targetLevel - wh.level;
            const cost  = ns.corporation.getUpgradeWarehouseCost(div, city, delta);
            if (funds() > cost * 2) {
                ns.corporation.upgradeWarehouse(div, city, delta);
                ns.print(`📦 WH lvl ${targetLevel}: ${div}/${city}`);
            }
        }

        // Buy boost materials based on division type
        // Detect type by checking which factors to use
        const freshWh  = ns.corporation.getWarehouse(div, city);
        const isAgri   = ns.args[3] !== 'tobacco';
        const factors  = isAgri ? AGRI_FACTORS : TOBACCO_FACTORS;
        const targets  = calcBoostTargets(freshWh.size, factors);

        for (const [mat, target] of Object.entries(targets)) {
            try {
                const stored = ns.corporation.getMaterial(div, city, mat).stored;
                const buyAmt = stored < target * 0.95 ? Math.ceil((target - stored) / 10) : 0;
                ns.corporation.buyMaterial(div, city, mat, buyAmt);
            } catch {}
        }

    } catch (e) { ns.print(`⚠ corp-warehouse ${div}/${city}: ${e}`); }
}