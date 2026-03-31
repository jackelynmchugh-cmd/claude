/**
 * reset-timer.js — Reset timing calculator and advisor
 * Tracks income rate, rep progress, diminishing returns,
 * cross-run aug/hr efficiency, and optimal reset window
 *
 * Usage: run reset-timer.js
 */

/** @param {NS} ns */
export async function main(ns) {
    ns.disableLog('ALL');
    ns.ui.openTail();
    ns.ui.setTailTitle('⏱ Reset Timer');

    const LOOP_MS        = 15_000;
    const SAMPLE_MS      = 15_000;
    const HISTORY_LEN    = 240;   // 1 hour of samples at 15s
    const RATE_WINDOW    = 20;    // rate over last 5 min
    const STATE_FILE     = 'reset-timer-state.txt';
    const RESET_FILE     = 'reset-ready.txt';

    // diminishing returns threshold —
    // if projected augs/hr drops below this fraction of peak, flag it
    const DR_THRESHOLD   = 0.60;

    // ─── Color helpers ────────────────────────────────────────────────────────
    const C = {
        reset:   '\x1b[0m', bold:    '\x1b[1m', dim:     '\x1b[2m',
        red:     '\x1b[31m', green:   '\x1b[32m', yellow:  '\x1b[33m',
        cyan:    '\x1b[36m', white:   '\x1b[37m', bred:    '\x1b[91m',
        bgreen:  '\x1b[92m', byellow: '\x1b[93m', bcyan:   '\x1b[96m',
        bwhite:  '\x1b[97m',
    };

    const col     = (c, t) => `${c}${t}${C.reset}`;
    const bold    = (t)    => `${C.bold}${t}${C.reset}`;
    const dim     = (t)    => col(C.dim, t);
    const header  = (t)    => col(C.bcyan, bold(t));
    const divider = (n=62) => col(C.dim, '─'.repeat(n));
    const label   = (t)    => col(C.cyan, t);

    const fmt = (n) => {
        if (Math.abs(n) >= 1e12) return `$${(n/1e12).toFixed(2)}t`;
        if (Math.abs(n) >= 1e9)  return `$${(n/1e9).toFixed(2)}b`;
        if (Math.abs(n) >= 1e6)  return `$${(n/1e6).toFixed(2)}m`;
        if (Math.abs(n) >= 1e3)  return `$${(n/1e3).toFixed(2)}k`;
        return `$${n.toFixed(0)}`;
    };

    const fmtRep = (n) => {
        if (n >= 1e6) return `${(n/1e6).toFixed(2)}m`;
        if (n >= 1e3) return `${(n/1e3).toFixed(1)}k`;
        return n.toFixed(0);
    };

    const fmtTime = (s) => {
        if (!isFinite(s) || s < 0) return col(C.dim, '?');
        if (s < 60)    return `${s.toFixed(0)}s`;
        if (s < 3600)  return `${(s/60).toFixed(1)}m`;
        if (s < 86400) return `${(s/3600).toFixed(1)}h`;
        return `${(s/86400).toFixed(1)}d`;
    };

    const colTime = (s) => {
        if (!isFinite(s) || s < 0) return col(C.dim, '?');
        const str = fmtTime(s);
        if (s < 3600)  return col(C.bgreen,  str);
        if (s < 86400) return col(C.byellow, str);
        return col(C.bred, str);
    };

    // ─── Portfolio value ──────────────────────────────────────────────────────
    function getPortfolioValue() {
        let total = ns.getPlayer().money;
        try {
            for (const sym of ns.stock.getSymbols()) {
                const [lng, lngAvg, shrt, shrtAvg] = ns.stock.getPosition(sym);
                const price = ns.stock.getPrice(sym);
                if (lng  > 0) total += lng  * price;
                if (shrt > 0) total += shrt * (shrtAvg * 2 - price);
            }
        } catch { }
        return total;
    }

    // ─── History tracking ─────────────────────────────────────────────────────
    const history = {
        portfolio:  [],
        augCount:   [],
        timestamps: [],
    };

    function addSample(portfolio, augCount) {
        history.portfolio.push(portfolio);
        history.augCount.push(augCount);
        history.timestamps.push(Date.now());
        while (history.portfolio.length > HISTORY_LEN) {
            history.portfolio.shift();
            history.augCount.shift();
            history.timestamps.shift();
        }
    }

    function getRatePerHour(arr) {
        if (arr.length < 2) return 0;
        const window    = Math.min(RATE_WINDOW, arr.length - 1);
        const recent    = arr[arr.length - 1];
        const past      = arr[arr.length - 1 - window];
        const deltaTime = (history.timestamps[history.timestamps.length - 1] -
                           history.timestamps[Math.max(0, history.timestamps.length - 1 - window)]) / 1000;
        return deltaTime > 0 ? ((recent - past) / deltaTime) * 3600 : 0;
    }

    // ─── Aug catalog ──────────────────────────────────────────────────────────
    function buildAugData(factions, ownedAugs) {
        const ownedSet  = new Set(ownedAugs);
        const buyable   = [];
        const needsRep  = [];

        for (const faction of factions) {
            let factionAugs;
            try { factionAugs = ns.singularity.getAugmentationsFromFaction(faction); }
            catch { continue; }

            const rep = ns.singularity.getFactionRep(faction);

            for (const aug of factionAugs) {
                if (ownedSet.has(aug)) continue;

                let price, repReq;
                try {
                    price  = ns.singularity.getAugmentationPrice(aug);
                    repReq = ns.singularity.getAugmentationRepReq(aug);
                } catch { continue; }

                const entry = { name: aug, price, repReq, faction, rep, hasRep: rep >= repReq };

                if (entry.hasRep) {
                    // check not already in buyable
                    if (!buyable.find(a => a.name === aug)) buyable.push(entry);
                } else {
                    if (!needsRep.find(a => a.name === aug)) needsRep.push(entry);
                }
            }
        }

        buyable.sort((a, b)  => b.price - a.price);
        needsRep.sort((a, b) => (b.rep/b.repReq) - (a.rep/a.repReq));

        return { buyable, needsRep };
    }

    // ─── Rep rate per faction ─────────────────────────────────────────────────
    const repHistory = {};

    function sampleFactionReps(factions) {
        for (const f of factions) {
            try {
                const rep = ns.singularity.getFactionRep(f);
                if (!repHistory[f]) repHistory[f] = [];
                repHistory[f].push({ rep, time: Date.now() });
                if (repHistory[f].length > 24) repHistory[f].shift();
            } catch { }
        }
    }

    function getRepRate(faction) {
        const h = repHistory[faction];
        if (!h || h.length < 2) return 0;
        const oldest   = h[0];
        const newest   = h[h.length - 1];
        const deltaRep = newest.rep  - oldest.rep;
        const deltaMs  = newest.time - oldest.time;
        return deltaMs > 0 ? (deltaRep / deltaMs) * 1000 * 3600 : 0;
    }

    // ─── Cost to buy all buyable augs (with cascade) ──────────────────────────
    function getTotalBuyCost(buyable) {
        let total      = 0;
        let multiplier = 1;
        for (const aug of buyable) {
            total      += aug.price * multiplier;
            multiplier *= 1.9;
        }
        return total;
    }

    // ─── Diminishing returns analysis ─────────────────────────────────────────
    // estimates aug/hr at current point vs peak and projects when it will drop
    function getDiminishingReturns(augCount, incomeRate, buyable, needsRep) {
        const totalRemaining  = buyable.length + needsRep.length;
        const totalBuyCost    = getTotalBuyCost(buyable);

        // time to buy all current buyable augs
        const timeToBuyAll = incomeRate > 0
            ? (totalBuyCost / incomeRate) * 3600
            : Infinity;

        // aug acquisition rate now — augs we could buy per hour at current income
        const augsPerHourNow = incomeRate > 0 && totalBuyCost > 0
            ? (incomeRate / totalBuyCost) * buyable.length
            : 0;

        // estimated total run time so far
        const runStart  = ns.getResetInfo()?.lastAugReset ?? 0;
        const runTimeMs = Date.now() - runStart;
        const runHours  = runTimeMs / 3600000;

        // augs/hr over entire run
        const augsPerHourRun = runHours > 0 ? augCount / runHours : 0;

        // project augs/hr after buying everything — diminishes as run gets longer
        const projectedAugsTotal = augCount + buyable.length;
        const projectedRunHours  = runHours + (timeToBuyAll / 3600);
        const augsPerHourAfter   = projectedRunHours > 0
            ? projectedAugsTotal / projectedRunHours
            : 0;

        // peak augs/hr — best we've seen this run
        const peakAugsPerHour = Math.max(augsPerHourRun, augsPerHourAfter);

        // DR ratio — how much of peak efficiency we still have
        const drRatio = peakAugsPerHour > 0
            ? augsPerHourAfter / peakAugsPerHour
            : 1;

        return {
            augsPerHourNow,
            augsPerHourRun,
            augsPerHourAfter,
            peakAugsPerHour,
            drRatio,
            timeToBuyAll,
            runHours,
            isDiminishing: drRatio < DR_THRESHOLD,
        };
    }

    // ─── Cross-run state ──────────────────────────────────────────────────────
    function loadState() {
        try {
            const raw = ns.read(STATE_FILE);
            if (raw) return JSON.parse(raw);
        } catch { }
        return { runs: [] };
    }

    function saveState(state) {
        try { ns.write(STATE_FILE, JSON.stringify(state), 'w'); } catch { }
    }

    // ─── Next run income estimate ─────────────────────────────────────────────
    // rough estimate based on aug count — each aug adds ~5% to income multiplier
    function estimateNextRunIncome(augCount, currentIncome) {
        const mult = 1 + augCount * 0.05;
        return currentIncome * mult;
    }

    // ─── SF level after reset ─────────────────────────────────────────────────
    function getSFAfterReset(bn, ownedSF) {
        const current = ownedSF[bn] ?? 0;
        const next    = Math.min(3, current + 1);
        return { bn, current, next };
    }

    let resetAlerted = false;
    let cycle        = 0;
    const state      = loadState();

    // ─── Main loop ────────────────────────────────────────────────────────────
    while (true) {
        cycle++;

        const player    = ns.getPlayer();
        const resetInfo = ns.getResetInfo();
        const bn        = resetInfo.currentNode;
        const factions  = player.factions ?? [];

        const sfRaw   = ns.singularity.getOwnedSourceFiles();
        const ownedSF = {};
        for (const sf of sfRaw) ownedSF[sf.n] = sf.lvl;

        let ownedAugs = [];
        try { ownedAugs = ns.singularity.getOwnedAugmentations(false); } catch { }
        const augCount   = ownedAugs.length;
        const portfolio  = getPortfolioValue();
        const cash       = player.money;
        const incomeRate = getRatePerHour(history.portfolio);

        addSample(portfolio, augCount);
        sampleFactionReps(factions);

        const { buyable, needsRep } = buildAugData(factions, ownedAugs);
        const totalBuyCost          = getTotalBuyCost(buyable);
        const dr                    = getDiminishingReturns(augCount, incomeRate, buyable, needsRep);
        const sfAfter               = getSFAfterReset(bn, ownedSF);

        // time estimates
        const timeToAffordAll  = incomeRate > 0 && totalBuyCost > cash
            ? ((totalBuyCost - cash) / incomeRate) * 3600
            : totalBuyCost <= cash ? 0 : Infinity;

        // time to hit rep for closest missing aug per faction
        const repETAs = needsRep.slice(0, 5).map(aug => {
            const rate = getRepRate(aug.faction);
            const gap  = aug.repReq - aug.rep;
            const eta  = rate > 0 ? (gap / rate) * 3600 : Infinity;
            return { ...aug, rate, gap, eta };
        }).sort((a, b) => a.eta - b.eta);

        // optimal reset check
        const allBought      = buyable.length === 0;
        const cantAffordSoon = incomeRate > 0 && timeToAffordAll > 4 * 3600; // more than 4hrs away
        const drFlagged      = dr.isDiminishing;
        const isOptimalReset = allBought || (drFlagged && cantAffordSoon);

        // write reset ready flag
        ns.write(RESET_FILE, JSON.stringify({
            ready:       isOptimalReset,
            allBought,
            drFlagged,
            augCount,
            updatedAt:   Date.now(),
        }), 'w');

        // alert once
        if (isOptimalReset && !resetAlerted) {
            const reason = allBought
                ? 'All available augs purchased!'
                : 'Diminishing returns detected — resetting now is optimal';
            ns.alert(`⏱ RESET TIMER: ${reason}\nAugs this run: ${augCount}\nEstimated next run income: ${fmt(estimateNextRunIncome(augCount, incomeRate))}/hr`);
            resetAlerted = true;
        }
        if (!isOptimalReset) resetAlerted = false;

        // run time
        const runStartMs = resetInfo?.lastAugReset ?? 0;
        const runTimeMs  = Date.now() - runStartMs;
        const runHours   = runTimeMs / 3600000;

        // ── Display ───────────────────────────────────────────────────────────
        ns.clearLog();

        ns.print(`${header('⏱ RESET TIMER')}  ${dim(`BN${bn} — Cycle: ${cycle}`)}`);
        ns.print(divider());

        // reset recommendation banner
        if (isOptimalReset) {
            ns.print(`  ${col(C.bred, bold('🚨 OPTIMAL RESET WINDOW — consider resetting now'))}`);
            if (allBought)   ns.print(`  ${col(C.bred,    '  → All available augs purchased')}`);
            if (drFlagged)   ns.print(`  ${col(C.byellow, '  → Diminishing returns below 60% of peak efficiency')}`);
            ns.print(divider());
        }

        // run snapshot
        ns.print(header('  📊 CURRENT RUN'));
        ns.print(`  ${label('Run time:')}    ${col(C.bwhite, fmtTime(runTimeMs / 1000))}`);
        ns.print(`  ${label('Augs:')}        ${col(C.bwhite, String(augCount))}  ${dim('(this run)')}`);
        ns.print(`  ${label('Cash:')}        ${col(C.bwhite, fmt(cash))}`);
        ns.print(`  ${label('Portfolio:')}   ${col(C.bwhite, fmt(portfolio))}`);
        ns.print(`  ${label('Income/hr:')}   ${incomeRate > 0 ? col(C.bgreen, fmt(incomeRate)) : col(C.dim, 'calculating...')}`);
        ns.print(`  ${label('SF after:')}    ${col(C.bcyan, `SF${sfAfter.bn}`)} ${sfAfter.current} → ${col(C.bgreen, String(sfAfter.next))}`);

        // aug purchase timing
        ns.print(divider());
        ns.print(header('  💊 AUG TIMING'));
        ns.print(`  ${label('Buyable now:')}    ${col(buyable.length > 0 ? C.bgreen : C.dim, String(buyable.length))}`);
        ns.print(`  ${label('Needs rep:')}      ${col(needsRep.length > 0 ? C.byellow : C.dim, String(needsRep.length))}`);
        ns.print(`  ${label('Total cost:')}     ${col(C.bwhite, fmt(totalBuyCost))}`);

        if (buyable.length > 0) {
            if (cash >= totalBuyCost) {
                ns.print(`  ${label('Afford all:')}    ${col(C.bgreen, '✅ can afford now — run augmgr')}`);
            } else {
                ns.print(`  ${label('Time to afford:')} ${colTime(timeToAffordAll)}`);
            }
        } else {
            ns.print(`  ${label('Buyable:')}       ${col(C.bgreen, '✅ all purchased')}`);
        }

        // rep ETAs
        if (repETAs.length > 0) {
            ns.print(divider());
            ns.print(header('  ⏳ REP TARGETS — ETA'));
            for (const aug of repETAs) {
                const pct      = (aug.rep / aug.repReq * 100).toFixed(1);
                const pctColor = Number(pct) >= 75 ? C.bgreen : Number(pct) >= 40 ? C.byellow : C.bred;
                ns.print(
                    `  ${col(C.white, aug.name.slice(0,28).padEnd(28))} ` +
                    `${col(pctColor, pct+'%').padStart(6)}  ` +
                    `ETA: ${colTime(aug.eta)}`
                );
                ns.print(
                    `  ${dim('  ' + aug.faction.padEnd(26))} ` +
                    `rep: ${fmtRep(aug.rep)} / ${fmtRep(aug.repReq)}  ` +
                    `${aug.rate > 0 ? col(C.dim, '+'+fmtRep(aug.rate)+'/hr') : dim('no data')}`
                );
            }
        }

        // diminishing returns
        ns.print(divider());
        ns.print(header('  📉 DIMINISHING RETURNS'));
        ns.print(`  ${label('Augs/hr (run avg):')}  ${col(C.bwhite, dr.augsPerHourRun.toFixed(3))}`);
        ns.print(`  ${label('Augs/hr (projected):')} ${col(C.bwhite, dr.augsPerHourAfter.toFixed(3))}`);
        ns.print(`  ${label('Peak augs/hr:')}        ${col(C.bwhite, dr.peakAugsPerHour.toFixed(3))}`);

        const drColor = dr.drRatio >= 0.80 ? C.bgreen : dr.drRatio >= 0.60 ? C.byellow : C.bred;
        const drBar   = Math.floor(dr.drRatio * 20);
        ns.print(`  ${label('Efficiency:')}          ${col(drColor, (dr.drRatio * 100).toFixed(1) + '%')}  [${col(drColor, '█'.repeat(drBar) + '░'.repeat(20 - drBar))}]`);

        if (dr.isDiminishing) {
            ns.print(`  ${col(C.bred, '⚠ Below 60% of peak — diminishing returns active')}`);
        } else {
            ns.print(`  ${col(C.bgreen, '✅ Efficiency still healthy')}`);
        }

        // reset now vs wait comparison
        ns.print(divider());
        ns.print(header('  🔄 RESET NOW vs WAIT'));

        const nextRunIncome = estimateNextRunIncome(augCount, incomeRate);
        const nextRunWithMore = estimateNextRunIncome(augCount + buyable.length, incomeRate);

        ns.print(`  ${label('Reset now:')}     next run ~${col(C.bgreen, fmt(nextRunIncome) + '/hr')}  (${augCount} augs)`);
        if (buyable.length > 0) {
            ns.print(`  ${label('Buy all first:')} next run ~${col(C.byellow, fmt(nextRunWithMore) + '/hr')}  (+${buyable.length} more augs)`);
            ns.print(`  ${label('Income gain:')}   ${col(C.bcyan, fmt(nextRunWithMore - nextRunIncome) + '/hr')} for waiting ${fmtTime(timeToAffordAll)}`);
            // break-even — how long does it take next run to recover the wait time
            const gainPerHour    = nextRunWithMore - nextRunIncome;
            const breakEvenHours = gainPerHour > 0 ? timeToAffordAll / 3600 : Infinity;
            ns.print(`  ${label('Break-even:')}    ${colTime(breakEvenHours * 3600)} into next run`);
        }

        // lategame faction progress
        ns.print(divider());
        ns.print(header('  🎯 LATEGAME TARGETS'));
        const targets = [
            { name: 'The Covenant', augReq: 20, moneyReq: 75e9,  hackReq: 850  },
            { name: 'Daedalus',     augReq: 30, moneyReq: 100e9, hackReq: 2500 },
            { name: 'Illuminati',   augReq: 30, moneyReq: 150e9, hackReq: 1500 },
        ];

        for (const t of targets) {
            const augOk   = augCount >= t.augReq;
            const monOk   = cash >= t.moneyReq;
            const hackOk  = player.skills.hacking >= t.hackReq;
            const allOk   = augOk && monOk && hackOk;
            const inFac   = factions.includes(t.name);

            const status  = inFac    ? col(C.bgreen,  '✅ JOINED')
                          : allOk    ? col(C.bgreen,  '✅ ELIGIBLE')
                          : col(C.dim, '⬜ locked');

            ns.print(`  ${col(C.bwhite, t.name.padEnd(18))} ${status}`);
            ns.print(
                `  ${dim('  augs:')} ${col(augOk  ? C.bgreen : C.yellow, `${augCount}/${t.augReq}`)}  ` +
                `${dim('$:')} ${col(monOk  ? C.bgreen : C.yellow, fmt(cash) + '/' + fmt(t.moneyReq))}  ` +
                `${dim('hack:')} ${col(hackOk ? C.bgreen : C.yellow, `${player.skills.hacking}/${t.hackReq}`)}`
            );
        }

        // cross-run aug/hr history
        if (state.runs && state.runs.length > 1) {
            ns.print(divider());
            ns.print(header('  📈 CROSS-RUN HISTORY'));
            const recent = state.runs.slice(-5);
            for (const run of recent) {
                ns.print(
                    `  BN${run.bn}  augs: ${col(C.bwhite, String(run.augs).padStart(3))}  ` +
                    `time: ${col(C.dim, fmtTime(run.runHours * 3600))}  ` +
                    `aug/hr: ${col(C.bgreen, run.augsPerHour.toFixed(3))}`
                );
            }
        }

        ns.print(divider());
        ns.print(`  ${dim(`Refreshes every ${LOOP_MS/1000}s`)}`);

        await ns.sleep(LOOP_MS);
    }
}

//Add the alias:
//alias -g resettimer="run reset-timer.js"