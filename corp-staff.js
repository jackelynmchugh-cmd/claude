/**
 * corp-staff.js — Office staffing and job assignment
 *
 * RAM: ~85GB
 * upgradeOfficeSize(20) + hireEmployee(20) + setJobAssignment(20) +
 * getOffice(10) + getOfficeSizeUpgradeCost(10) + getCorporation(10) + base(1.6)
 *
 * Args: divisionName defaultSize [mainCity] [mainSize]
 *   defaultSize — target size for all cities
 *   mainCity    — optional city to get a different size
 *   mainSize    — size for mainCity if specified
 *
 * Usage: run corp-staff.js [div] [size]
 *    or: run corp-staff.js [div] [size] [mainCity] [mainSize]
 */

const ALL_CITIES = ['Aevum', 'Chongqing', 'Sector-12', 'New Tokyo', 'Ishima', 'Volhaven'];

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

    const div      = ns.args[0];
    const defSize  = parseInt(ns.args[1]) || 9;
    const mainCity = ns.args[2] ?? null;
    const mainSize = parseInt(ns.args[3]) || defSize;

    if (!div) { ns.tprint('corp-staff: no division'); return; }

    const funds = () => ns.corporation.getCorporation().funds;

    for (const city of ALL_CITIES) {
        const targetSize = (mainCity && city === mainCity) ? mainSize : defSize;
        const extraEng   = (mainCity && city === mainCity) ? 3 : 0;

        try {
            // Expand office if needed
            const cur = ns.corporation.getOffice(div, city).size;
            if (cur < targetSize) {
                const cost = ns.corporation.getOfficeSizeUpgradeCost(div, city, targetSize - cur);
                if (funds() > cost * 1.5) {
                    ns.corporation.upgradeOfficeSize(div, city, targetSize - cur);
                    ns.print(`👥 Office ${targetSize}: ${div}/${city}`);
                }
            }

            // Hire up to size
            let off = ns.corporation.getOffice(div, city);
            while (off.numEmployees < off.size) {
                ns.corporation.hireEmployee(div, city);
                off = ns.corporation.getOffice(div, city);
            }

            // Assign jobs — zero first per API docs
            const size   = ns.corporation.getOffice(div, city).size;
            const jobMap = buildJobMap(size, extraEng);

            for (const job of ['Operations','Engineer','Business','Management','Research & Development','Intern']) {
                try { ns.corporation.setJobAssignment(div, city, job, 0); } catch {}
            }
            for (const [job, count] of Object.entries(jobMap)) {
                try { ns.corporation.setJobAssignment(div, city, job, count); } catch {}
            }

        } catch (e) { ns.print(`⚠ ${div}/${city}: ${e}`); }
    }

    ns.print(`✅ Staffing done: ${div}`);
}