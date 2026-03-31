/**
 * corp-tea.js — Buy tea + throw party for all offices, then exit
 *
 * RAM: ~41GB
 * buyTea(20) + throwParty(20) + getOffice(10) + getCorporation(10) + base(1.6)
 * Wait — getCorporation not needed. Actually:
 * buyTea(20) + throwParty(20) + getOffice(10) + base(1.6) = 51.6GB
 *
 * Per docs:
 *  - Energy drops when office >= 9 employees
 *  - Tea gives flat +2 energy, costs 500k/employee
 *  - Party boosts morale — 500k/employee is fine
 *  - Target: keep both above 99.5
 *
 * Args: division names (variadic)
 * Usage: run corp-tea.js [div1] [div2] ...
 */

const ALL_CITIES         = ['Aevum', 'Chongqing', 'Sector-12', 'New Tokyo', 'Ishima', 'Volhaven'];
const ENERGY_MIN         = 99.5;
const MORALE_MIN         = 99.5;
const PARTY_PER_EMPLOYEE = 500_000;

/** @param {NS} ns */
export async function main(ns) {
    ns.disableLog('ALL');

    const divs = ns.args.filter(a => typeof a === 'string' && a.length > 0);
    if (divs.length === 0) { ns.tprint('corp-tea: no divisions specified'); return; }

    for (const div of divs) {
        for (const city of ALL_CITIES) {
            try {
                const office = ns.corporation.getOffice(div, city);
                if (office.numEmployees === 0) continue;

                if (office.avgEnergy < ENERGY_MIN) {
                    ns.corporation.buyTea(div, city);
                }
                if (office.avgMorale < MORALE_MIN) {
                    ns.corporation.throwParty(div, city, PARTY_PER_EMPLOYEE);
                }
            } catch {} // city may not exist in this division yet
        }
    }
}