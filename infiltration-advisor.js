/**
 * infiltration-advisor.js — Ranks infiltration targets by reward efficiency
 *
 * Usage: run infiltration-advisor.js [mode]
 * Modes: rep (default), money, time
 *
 * rep   — best faction rep per difficulty
 * money — best cash per difficulty
 * time  — best reward per estimated time
 */

/** @param {NS} ns */
export async function main(ns) {
    ns.disableLog('ALL');
    ns.ui.openTail();
    ns.ui.setTailTitle('🏢 Infiltration Advisor');

    const mode = (ns.args[0] ?? 'rep').toString().toLowerCase();

    if (!['rep', 'money', 'time'].includes(mode)) {
        ns.tprint(`ERROR: Unknown mode "${mode}". Valid: rep, money, time`);
        return;
    }

    // ─── Get all infiltration locations ──────────────────────────────────────
    let infiltrations;
    try {
        const locations = ns.infiltration.getPossibleLocations();
        infiltrations   = locations.map(loc => ns.infiltration.getInfiltration(loc));
    } catch(e) {
        ns.tprint(`ERROR: Could not get infiltration data. ${e}`);
        return;
    }

    if (!infiltrations || infiltrations.length === 0) {
        ns.tprint('No infiltration locations found.');
        return;
    }

    // ─── Format helpers ───────────────────────────────────────────────────────
    const fmt = (n) => {
        if (n >= 1e12) return `$${(n / 1e12).toFixed(2)}t`;
        if (n >= 1e9)  return `$${(n / 1e9).toFixed(2)}b`;
        if (n >= 1e6)  return `$${(n / 1e6).toFixed(2)}m`;
        if (n >= 1e3)  return `$${(n / 1e3).toFixed(2)}k`;
        return `$${n.toFixed(0)}`;
    };

    const fmtRep = (n) => {
        if (n >= 1e6) return `${(n / 1e6).toFixed(2)}m`;
        if (n >= 1e3) return `${(n / 1e3).toFixed(1)}k`;
        return n.toFixed(0);
    };

    // ─── Main display loop ────────────────────────────────────────────────────
    while (true) {

        // re-fetch each cycle in case stats changed
        try {
            const locations = ns.infiltration.getPossibleLocations();
            infiltrations   = locations.map(loc => ns.infiltration.getInfiltration(loc));
        } catch { /* keep existing data */ }

        // ── Score each location ───────────────────────────────────────────────
        const scored = infiltrations.map(inf => {
            const difficulty = inf.difficulty         ?? 1;
            const maxRep     = inf.reward?.tradeRep   ?? 0;
            const maxRep2    = inf.reward?.SoARep      ?? 0;
            const maxMoney   = inf.reward?.sellCash   ?? 0;
            const totalRep   = maxRep + maxRep2;
            const levels     = inf.maxClearanceLevel  ?? 1;
            const estTime    = difficulty * levels * 30;

            const repScore       = difficulty > 0 ? totalRep / difficulty  : 0;
            const moneyScore     = difficulty > 0 ? maxMoney / difficulty  : 0;
            const timeRepScore   = estTime   > 0 ? totalRep / estTime     : 0;

            return {
                name:      inf.location?.name ?? 'Unknown',
                city:      inf.location?.city ?? 'Unknown',
                difficulty,
                levels,
                totalRep,
                maxMoney,
                estTime,
                repScore,
                moneyScore,
                timeRepScore,
            };
        });

        // ── Sort by mode ──────────────────────────────────────────────────────
        let sorted;
        switch (mode) {
            case 'rep':   sorted = [...scored].sort((a, b) => b.repScore       - a.repScore);       break;
            case 'money': sorted = [...scored].sort((a, b) => b.moneyScore     - a.moneyScore);     break;
            case 'time':  sorted = [...scored].sort((a, b) => b.timeRepScore   - a.timeRepScore);   break;
            default:      sorted = [...scored].sort((a, b) => b.repScore       - a.repScore);
        }

        // ── Render ────────────────────────────────────────────────────────────
        ns.clearLog();
        ns.print(`🏢 INFILTRATION ADVISOR  [mode: ${mode}]`);
        ns.print(`  infil rep | infil money | infil time`);
        ns.print('─'.repeat(70));
        ns.print(`  ${'#'.padEnd(3)} ${'LOCATION'.padEnd(26)} ${'CITY'.padEnd(12)} ${'DIFF'.padEnd(6)} ${'LVL'.padEnd(5)} ${'REP'.padEnd(10)} MONEY`);
        ns.print('─'.repeat(70));

        for (let i = 0; i < Math.min(sorted.length, 15); i++) {
            const inf  = sorted[i];
            const rank = `${i + 1}.`.padEnd(3);
            ns.print(
                `  ${rank} ${inf.name.padEnd(26)} ${inf.city.padEnd(12)} ` +
                `${inf.difficulty.toFixed(1).padEnd(6)} ` +
                `${String(inf.levels).padEnd(5)} ` +
                `${fmtRep(inf.totalRep).padEnd(10)} ` +
                `${fmt(inf.maxMoney)}`
            );
        }

        ns.print('─'.repeat(70));
        ns.print(`  Sorted by: ${
            mode === 'rep'   ? 'Rep per difficulty point'   :
            mode === 'money' ? 'Money per difficulty point' :
                               'Rep per estimated second'
        }`);
        ns.print(`  Total locations: ${sorted.length}`);

        if (sorted.length > 0) {
            const top = sorted[0];
            ns.print('─'.repeat(70));
            ns.print('  🏆 TOP PICK:');
            ns.print(`  📍 ${top.name} (${top.city})`);
            ns.print(`     Difficulty: ${top.difficulty.toFixed(1)}  Levels: ${top.levels}`);
            ns.print(`     Max Rep:    ${fmtRep(top.totalRep)}`);
            ns.print(`     Max Money:  ${fmt(top.maxMoney)}`);
            ns.print(`     Est. Time:  ~${top.estTime.toFixed(0)}s`);
        }

        await ns.sleep(30000);
    }
}