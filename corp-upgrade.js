/**
 * corp-upgrade.js — Level upgrades and research
 *
 * RAM: ~82GB
 * levelUpgrade(20) + research(20) + getUpgradeLevelCost(10) +
 * hasResearched(10) + getResearchCost(10) + getDivision(10) + getCorporation(10) + base(1.6)
 *
 * Args: divisionName phase
 * Usage: run corp-upgrade.js [div] [phase]
 */

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

/** @param {NS} ns */
export async function main(ns) {
    ns.disableLog('ALL');

    const div   = ns.args[0];
    const phase = parseInt(ns.args[1]) || 1;
    if (!div) { ns.tprint('corp-upgrade: no division'); return; }

    const funds = () => ns.corporation.getCorporation().funds;

    // Phase 1: SmartStorage priority
    if (phase === 1) {
        for (let i = 0; i < 3; i++) {
            try {
                if (funds() > ns.corporation.getUpgradeLevelCost('Smart Storage') * 2)
                    ns.corporation.levelUpgrade('Smart Storage');
            } catch {}
        }
    }

    // Phase 2+: SmartFactories priority too
    if (phase >= 2) {
        for (let i = 0; i < 2; i++) {
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

    // Research — one per run, conservative thresholds
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
                    break;
                }
            } catch {}
        }
    } catch {}

    ns.print(`✅ Upgrades: ${div} phase ${phase}`);
}