/**
 * corp-misc.js — Misc one-shot actions
 *
 * RAM: ~85GB
 * hireAdVert(20) + purchaseUnlock(20) + expandIndustry(20) + goPublic(20) +
 * getHireAdVertCost(10) + getUnlockCost(10) + hasUnlock(10) +
 * getCorporation(10) + base(1.6)
 * Note: not all calls used at once — actual RAM depends on action
 * Worst case: ~91.6GB — fits in 256GB
 *
 * Actions:
 *   advert  [div]              — hire AdVert if affordable
 *   unlock  [unlockName]       — buy unlock if not owned
 *   expand  [industry] [name]  — create a new division
 *   ipo                        — go public with 0 shares issued
 *
 * Usage: run corp-misc.js [action] [args...]
 */

/** @param {NS} ns */
export async function main(ns) {
    ns.disableLog('ALL');

    const action = ns.args[0];
    const funds  = () => ns.corporation.getCorporation().funds;

    switch (action) {
        case 'advert': {
            const div = ns.args[1];
            if (!div) { ns.tprint('corp-misc advert: no division'); return; }
            try {
                const cost = ns.corporation.getHireAdVertCost(div);
                if (funds() > cost * 3) {
                    ns.corporation.hireAdVert(div);
                    ns.tprint(`📢 AdVert hired: ${div}`);
                }
            } catch (e) { ns.print(`⚠ advert: ${e}`); }
            break;
        }

        case 'unlock': {
            const name = ns.args[1];
            if (!name) { ns.tprint('corp-misc unlock: no name'); return; }
            try {
                if (ns.corporation.hasUnlock(name)) { ns.print(`✅ Already have: ${name}`); return; }
                const cost = ns.corporation.getUnlockCost(name);
                if (funds() > cost) {
                    ns.corporation.purchaseUnlock(name);
                    ns.tprint(`🔓 Unlocked: ${name}`);
                } else {
                    ns.print(`💸 Can't afford ${name}: $${ns.format.number(cost)}`);
                }
            } catch (e) { ns.print(`⚠ unlock: ${e}`); }
            break;
        }

        case 'expand': {
            const industry = ns.args[1];
            const name     = ns.args[2];
            if (!industry || !name) { ns.tprint('corp-misc expand: need industry and name'); return; }
            try {
                ns.corporation.expandIndustry(industry, name);
                ns.tprint(`🏭 Expanded: ${name} (${industry})`);
            } catch (e) { ns.print(`⚠ expand: ${e}`); }
            break;
        }

        case 'ipo': {
            try {
                const corp = ns.corporation.getCorporation();
                if (corp.public) { ns.print('Already public'); return; }
                ns.corporation.goPublic(0);
                ns.tprint(`🚀 IPO! Valuation: $${ns.format.number(corp.valuation)}`);
            } catch (e) { ns.print(`⚠ ipo: ${e}`); }
            break;
        }

        default:
            ns.tprint(`corp-misc: unknown action "${action}". Use: advert, unlock, expand, ipo`);
    }
}