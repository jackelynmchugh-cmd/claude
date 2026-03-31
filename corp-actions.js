/**
 * corp-actions.js — Execute all corp write operations
 *
 * Receives a JSON action object as its single arg.
 * Runs all operations sequentially then exits.
 *
 * RAM: ~500GB (has all write calls)
 * With 1TB home RAM this is fine — only one instance runs at a time.
 *
 * Action schema:
 * {
 *   phase: 1|2|3,
 *   agri: string,           — agriculture division name
 *   tobacco: string,        — tobacco division name
 *   unlocks: string[],      — unlocks to buy
 *   setup: string[],        — divisions to expand to all cities + buy warehouses
 *   createTobacco: bool,    — create tobacco division
 *   staff: [{div, size, city?, extraEng?}], — staff offices
 *   sell: [{div, mats[]}],  — set sell orders
 *   warehouses: [{div, city, level, type?}], — upgrade warehouses + buy boost mats
 *   export: {agri, tobacco} | null,
 *   dummies: string[],      — restaurant division names to create
 *   upgrades: bool,         — level corp upgrades
 *   advert: string[],       — divisions to advertise
 *   research: string[],     — divisions to research
 *   ipo: bool,              — go public
 * }
 *
 * Usage: run corp-actions.js [jsonAction]
 */

const ALL_CITIES = ['Aevum', 'Chongqing', 'Sector-12', 'New Tokyo', 'Ishima', 'Volhaven'];
const MAIN_CITY  = 'Aevum';

const CORP_UPGRADES = [
    'Smart Factories', 'Smart Storage', 'Wilson Analytics',
    'Nuoptimal Nootropic Injector Implants', 'Speech Processor Implants',
    'Neural Accelerators', 'FocusWires', 'ABC SalesBots', 'Project Insight',
];

const RESEARCH_ORDER = [
    'Hi-Tech R&D Laboratory', 'Overclock', 'Sti.mu',
    'Automatic Drug Administration', 'Go-Juice', 'CPH4 Injections',
    'Drones', 'Drones - Assembly', 'Self-Correcting Assemblers',
    'Drones - Transport', 'uPgrade: Fulcrum', 'Market-TA.I', 'Market-TA.II',
];

const AGRI_FACTORS    = { Hardware: 0.2,  Robots: 0.3,  'AI Cores': 0.3,  'Real Estate': 0.72 };
const TOBACCO_FACTORS = { Hardware: 0.15, Robots: 0.2,  'AI Cores': 0.15, 'Real Estate': 0.15 };
const MAT_SIZES       = { Hardware: 0.06, Robots: 0.5,  'AI Cores': 0.1,  'Real Estate': 0.005 };

function calcBoostTargets(warehouseSize, factors) {
    // Reserve 50% for input/output — only use 50% for boost mats to prevent congestion
    const S = warehouseSize * 0.5;
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

function buildJobMap(size, extraEng = 0) {
    const interns = Math.max(1, Math.floor(size / 9));
    const w       = size - interns;
    const eng     = Math.max(1, Math.floor(w * 0.25) + extraEng);
    const ops     = Math.max(1, Math.floor(w * 0.25));
    const mgmt    = Math.max(1, Math.floor(w * 0.20));
    const biz     = Math.max(1, Math.floor(w * 0.15));
    const rnd     = Math.max(1, w - eng - ops - mgmt - biz);
    return { Operations: ops, Engineer: eng, Business: biz, Management: mgmt, 'Research & Development': rnd, Intern: interns };
}

/** @param {NS} ns */
export async function main(ns) {
    ns.disableLog('ALL');

    const raw = ns.args[0];
    if (!raw) { ns.tprint('corp-actions: no action JSON'); return; }

    let action;
    try { action = JSON.parse(raw); }
    catch (e) { ns.tprint(`corp-actions: bad JSON: ${e}`); return; }

    const funds = () => ns.corporation.getCorporation().funds;
    const phase = action.phase ?? 1;

    // ── IPO ───────────────────────────────────────────────────────────────────
    if (action.ipo) {
        try {
            const corp = ns.corporation.getCorporation();
            if (!corp.public) {
                ns.corporation.goPublic(0);
                ns.tprint(`🚀 IPO! $${ns.format.number(corp.valuation)}`);
            }
        } catch (e) { ns.print(`⚠ IPO: ${e}`); }
        return;
    }

    // ── Unlocks ───────────────────────────────────────────────────────────────
    for (const name of (action.unlocks ?? [])) {
        try {
            if (!ns.corporation.hasUnlock(name)) {
                const cost = ns.corporation.getUnlockCost(name);
                if (funds() > cost) {
                    ns.corporation.buyUnlock(name);
                    ns.print(`🔓 ${name}`);
                } else {
                    ns.print(`💸 Can't afford unlock: ${name} ($${ns.format.number(cost)})`);
                }
            }
        } catch (e) { ns.print(`⚠ unlock ${name}: ${e}`); }
    }

    // ── Create Tobacco ────────────────────────────────────────────────────────
    if (action.createTobacco && action.tobacco) {
        try {
            ns.corporation.expandIndustry('Tobacco', action.tobacco);
            ns.print(`🚬 Created: ${action.tobacco}`);
        } catch {}
    }

    // ── Dummy divisions ───────────────────────────────────────────────────────
    for (const name of (action.dummies ?? [])) {
        try {
            ns.corporation.expandIndustry('Restaurant', name);
            ns.print(`🍜 Dummy: ${name}`);
            for (const city of ALL_CITIES) {
                try { ns.corporation.expandCity(name, city); } catch {}
                try { ns.corporation.purchaseWarehouse(name, city); } catch {}
            }
        } catch {}
    }

    // ── Setup (expand cities + warehouses + smart supply) ─────────────────────
    for (const div of (action.setup ?? [])) {
        for (const city of ALL_CITIES) {
            try { ns.corporation.expandCity(div, city); } catch {}
            try { ns.corporation.purchaseWarehouse(div, city); } catch {}
            try { ns.corporation.setSmartSupply(div, city, true); } catch {}
        }
        ns.print(`✅ Setup: ${div}`);
    }

    // ── Staff (expand offices + hire + assign jobs) ────────────────────────────
    for (const s of (action.staff ?? [])) {
        const cities = s.city ? [s.city] : ALL_CITIES;
        for (const city of cities) {
            try {
                const cur = ns.corporation.getOffice(s.div, city).size;
                if (cur < s.size) {
                    const cost = ns.corporation.getOfficeSizeUpgradeCost(s.div, city, s.size - cur);
                    if (funds() > cost * 1.5) {
                        ns.corporation.upgradeOfficeSize(s.div, city, s.size - cur);
                        ns.print(`👥 Office ${s.size}: ${s.div}/${city}`);
                    }
                }
                // Hire up to size
                let off = ns.corporation.getOffice(s.div, city);
                while (off.numEmployees < off.size) {
                    ns.corporation.hireEmployee(s.div, city);
                    off = ns.corporation.getOffice(s.div, city);
                }
                // Assign jobs — zero first per API docs
                const size   = ns.corporation.getOffice(s.div, city).size;
                const jobMap = buildJobMap(size, s.extraEng ?? 0);
                for (const job of ['Operations','Engineer','Business','Management','Research & Development','Intern']) {
                    try { ns.corporation.setJobAssignment(s.div, city, job, 0); } catch {}
                }
                for (const [job, count] of Object.entries(jobMap)) {
                    try { ns.corporation.setJobAssignment(s.div, city, job, count); } catch {}
                }
            } catch (e) { ns.print(`⚠ staff ${s.div}/${city}: ${e}`); }
        }
    }

    // ── Sell orders ───────────────────────────────────────────────────────────
    for (const s of (action.sell ?? [])) {
        for (const city of ALL_CITIES) {
            for (const mat of s.mats) {
                try { ns.corporation.sellMaterial(s.div, city, mat, 'MAX', 'MP'); } catch {}
            }
        }
        ns.print(`💰 Sell orders: ${s.div}`);
    }

    // ── Warehouses + boost materials ──────────────────────────────────────────
    for (const w of (action.warehouses ?? [])) {
        try {
            const wh = ns.corporation.getWarehouse(w.div, w.city);
            if (wh.level < w.level) {
                const delta = w.level - wh.level;
                const cost  = ns.corporation.getUpgradeWarehouseCost(w.div, w.city, delta);
                if (funds() > cost * 2) {
                    ns.corporation.upgradeWarehouse(w.div, w.city, delta);
                    ns.print(`📦 WH ${w.level}: ${w.div}/${w.city}`);
                }
            }
            // Buy boost materials — skip if warehouse over 85% full
            const freshWh = ns.corporation.getWarehouse(w.div, w.city);
            const usedPct = freshWh.sizeUsed / freshWh.size;
            const factors = w.type === 'tobacco' ? TOBACCO_FACTORS : AGRI_FACTORS;
            // Always stop any lingering buy rates first
            for (const mat of Object.keys(factors)) {
                try { ns.corporation.buyMaterial(w.div, w.city, mat, 0); } catch {}
            }

            if (usedPct < 0.75) {
                // Use bulkPurchase for one-time buy — no lingering rate
                const targets = calcBoostTargets(freshWh.size, factors);
                for (const [mat, target] of Object.entries(targets)) {
                    try {
                        const stored = ns.corporation.getMaterial(w.div, w.city, mat).stored;
                        const needed = Math.floor(target - stored);
                        if (needed > 0 && funds() > 0) {
                            ns.corporation.bulkPurchase(w.div, w.city, mat, needed);
                            ns.print("Bought " + needed + " " + mat + " for " + w.div + "/" + w.city);
                        }
                    } catch (e) {
                        ns.print("bulkPurchase " + mat + " " + w.div + "/" + w.city + ": " + e);
                    }
                }
            } else {
                ns.print("WH " + Math.floor(usedPct*100) + "% full: " + w.div + "/" + w.city + " — skipping boost buy");
            }
        } catch (e) { ns.print(`⚠ warehouse ${w.div}/${w.city}: ${e}`); }
    }

    // ── Export routes ─────────────────────────────────────────────────────────
    if (action.export) {
        const { agri, tobacco } = action.export;
        for (const city of ALL_CITIES) {
            try { ns.corporation.cancelExportMaterial(agri, city, tobacco, city, 'Plants'); } catch {}
            try {
                ns.corporation.exportMaterial(agri, city, tobacco, city, 'Plants', '(IPROD+IINV/10)*(-1)');
            } catch (e) { ns.print(`⚠ export ${city}: ${e}`); }
        }
        ns.print(`🔗 Export routes: ${agri} → ${tobacco}`);
    }

    // ── Upgrades ──────────────────────────────────────────────────────────────
    if (action.upgrades) {
        // Phase 1: SmartStorage priority
        if (phase === 1) {
            for (let i = 0; i < 3; i++) {
                try {
                    if (funds() > ns.corporation.getUpgradeLevelCost('Smart Storage') * 2)
                        ns.corporation.levelUpgrade('Smart Storage');
                } catch {}
            }
        }
        // Phase 2+: SmartFactories priority
        if (phase >= 2) {
            for (let i = 0; i < 3; i++) {
                try {
                    if (funds() > ns.corporation.getUpgradeLevelCost('Smart Factories') * 2)
                        ns.corporation.levelUpgrade('Smart Factories');
                } catch {}
            }
        }
        const passes = phase >= 3 ? 5 : phase === 2 ? 3 : 2;
        for (let p = 0; p < passes; p++) {
            for (const upg of CORP_UPGRADES) {
                try {
                    if (funds() > ns.corporation.getUpgradeLevelCost(upg) * 2)
                        ns.corporation.levelUpgrade(upg);
                } catch {}
            }
        }
    }

    // ── Advert ────────────────────────────────────────────────────────────────
    for (const div of (action.advert ?? [])) {
        try {
            const cost = ns.corporation.getHireAdVertCost(div);
            if (funds() > cost * 3) {
                ns.corporation.hireAdVert(div);
                ns.print(`📢 AdVert: ${div}`);
            }
        } catch {}
    }

    // ── Research ──────────────────────────────────────────────────────────────
    for (const div of (action.research ?? [])) {
        try {
            const rp = ns.corporation.getDivision(div).researchPoints;
            for (const r of RESEARCH_ORDER) {
                try {
                    if (ns.corporation.hasResearched(div, r)) continue;
                    const cost   = ns.corporation.getResearchCost(div, r);
                    const isProd = ['Drones','Drones - Assembly','Self-Correcting Assemblers',
                                    'Drones - Transport','uPgrade: Fulcrum'].includes(r);
                    if (rp > 0 && cost / rp < (isProd ? 0.1 : 0.2)) {
                        ns.corporation.research(div, r);
                        ns.print(`🔬 ${div}: ${r}`);
                        break; // one per run
                    }
                } catch {}
            }
        } catch {}
    }

    ns.print(`✅ Actions complete (phase ${phase})`);
}