/**
 * intel-tracker.js — Intelligence XP tracker and advisor
 * Shows current Intel level, XP rate, best actions for Intel gain
 *
 * Usage: run intel-tracker.js
 */

/** @param {NS} ns */
export async function main(ns) {
    ns.disableLog('ALL');
    ns.ui.openTail();
    ns.ui.setTailTitle('🧠 Intel Tracker');

    const LOOP_MS     = 10_000;
    const HISTORY_LEN = 360;  // 1 hour at 10s intervals
    const RATE_WINDOW = 30;   // rate over last 5 min

    const fmt = (n) => {
        if (n >= 1e6) return `${(n/1e6).toFixed(2)}m`;
        if (n >= 1e3) return `${(n/1e3).toFixed(1)}k`;
        return n.toFixed(2);
    };

    const fmtTime = (seconds) => {
        if (!isFinite(seconds) || seconds <= 0) return 'unknown';
        if (seconds < 60)    return `${seconds.toFixed(0)}s`;
        if (seconds < 3600)  return `${(seconds/60).toFixed(1)}m`;
        if (seconds < 86400) return `${(seconds/3600).toFixed(1)}h`;
        return `${(seconds/86400).toFixed(1)}d`;
    };

    // ─── Intel XP sources ranked by gain rate ────────────────────────────────
    const INTEL_ACTIONS = [
        { action: 'Destroying BitNodes',      note: 'Massive burst each destroy',          weight: 10 },
        { action: 'Installing backdoors',     note: 'Large burst per backdoor',             weight: 5  },
        { action: 'Solving coding contracts', note: 'Large burst per contract',             weight: 5  },
        { action: 'Buying augmentations',     note: 'Burst per aug purchased',              weight: 4  },
        { action: 'Completing infiltrations', note: 'Burst per infiltration completed',     weight: 4  },
        { action: 'Hacking servers',          note: 'Small gain per successful hack',       weight: 3  },
        { action: 'Creating programs',        note: 'Burst when program finishes',          weight: 3  },
        { action: 'Working for factions',     note: 'Slow passive gain',                    weight: 2  },
        { action: 'Running share()',          note: 'Very small passive gain',              weight: 1  },
        { action: 'Gang management',          note: 'Very small passive gain over time',    weight: 1  },
    ];

    // ─── History tracking ─────────────────────────────────────────────────────
    const xpHistory = [];
    let   cycle     = 0;

    function addSample(intelXp) {
        xpHistory.push({ xp: intelXp, time: Date.now() });
        while (xpHistory.length > HISTORY_LEN) xpHistory.shift();
    }

    function getXpRatePerHour() {
        if (xpHistory.length < 2) return 0;
        const window  = Math.min(RATE_WINDOW, xpHistory.length - 1);
        const recent  = xpHistory[xpHistory.length - 1];
        const past    = xpHistory[xpHistory.length - 1 - window];
        const deltaXp = recent.xp - past.xp;
        const deltaMs = recent.time - past.time;
        return deltaMs > 0 ? (deltaXp / deltaMs) * 1000 * 3600 : 0;
    }

    // ─── Main loop ────────────────────────────────────────────────────────────
    while (true) {
        cycle++;
        const player   = ns.getPlayer();
        const intelLvl = player.skills.intelligence ?? 0;
        const intelXp  = player.exp.intelligence    ?? 0;

        addSample(intelXp);

        const xpRate     = getXpRatePerHour();
        const samples    = xpHistory.length;
        const windowMins = (Math.min(samples, RATE_WINDOW) * LOOP_MS / 60000).toFixed(1);

        // ── Current work ──────────────────────────────────────────────────────
        let currentWork = 'idle';
        try {
            const work = ns.singularity.getCurrentWork();
            if (work) {
                const detail = work.companyName ?? work.factionName ?? work.crimeType ?? work.augmentation ?? '';
                currentWork  = `${work.type}${detail ? ': ' + detail : ''}`;
            }
        } catch { }

        // ── Share threads — fixed for 3.0 API ────────────────────────────────
        let shareThreads = 0;
        try {
            const pservs  = (() => { try { return ns.cloud.getServerNames(); } catch { return []; } })();
            for (const server of ['home', ...pservs]) {
                for (const proc of ns.ps(server)) {
                    if (proc.filename === 'share-worker.js') shareThreads += proc.threads;
                }
            }
        } catch { }

        // ── Coding contracts ──────────────────────────────────────────────────
        let contractCount = 0;
        try {
            const visited = new Set(['home']);
            const queue   = ['home'];
            while (queue.length) {
                const host = queue.shift();
                contractCount += ns.ls(host, '.cct').length;
                for (const n of ns.scan(host)) {
                    if (!visited.has(n)) { visited.add(n); queue.push(n); }
                }
            }
        } catch { }

        // ── ETA estimate using recent XP gain events ──────────────────────────
        // since we don't know the exact formula, estimate from rate
        // XP needed to gain 1 level is roughly 2*level based on observed data
        const approxXpPerLevel = intelLvl * 2;
        const etaSeconds       = xpRate > 0
            ? (approxXpPerLevel / xpRate) * 3600
            : Infinity;

        // ── Intel multiplier — from game source approximately ──────────────────
        // int_mult = 1 + (level^0.8) / 600
        const intelMult = 1 + Math.pow(intelLvl, 0.8) / 600;

        // ── Display ───────────────────────────────────────────────────────────
        ns.clearLog();
        ns.print('🧠 INTELLIGENCE TRACKER');
        ns.print('─'.repeat(56));
        ns.print(`  Intel Level:  ${intelLvl}`);
        ns.print(`  Intel XP:     ${fmt(intelXp)}`);
        ns.print(`  XP rate:      ${fmt(xpRate)} XP/hr  (over ${windowMins}min)`);
        ns.print(`  ETA +1 level: ${fmtTime(etaSeconds)}  (approx)`);
        ns.print(`  Cycle:        ${cycle}`);

        ns.print('─'.repeat(56));
        ns.print('  📍 CURRENT ACTIVITY:');
        ns.print(`  Work:         ${currentWork}`);
        ns.print(`  Share:        ${shareThreads > 0 ? `✅ ${shareThreads} threads` : '❌ run share.js for passive Intel'}`);
        ns.print(`  Contracts:    ${contractCount > 0 ? `⭐ ${contractCount} available — HIGH Intel source!` : '✅ none pending'}`);

        ns.print('─'.repeat(56));
        ns.print('  🎯 BEST INTEL SOURCES (ranked):');
        for (const a of INTEL_ACTIONS.slice(0, 6)) {
            const stars = '⭐'.repeat(Math.min(a.weight, 5));
            ns.print(`  ${stars.padEnd(7)} ${a.action.padEnd(28)} ${a.note}`);
        }

        ns.print('─'.repeat(56));
        ns.print('  💡 INTEL MULTIPLIER:');
        ns.print(`  Current (lv${intelLvl}): ${intelMult.toFixed(4)}x`);
        ns.print(`  At level 100:    ${(1 + Math.pow(100, 0.8)/600).toFixed(4)}x`);
        ns.print(`  At level 200:    ${(1 + Math.pow(200, 0.8)/600).toFixed(4)}x`);
        ns.print(`  At level 500:    ${(1 + Math.pow(500, 0.8)/600).toFixed(4)}x`);
        ns.print(`  At level 1000:   ${(1 + Math.pow(1000, 0.8)/600).toFixed(4)}x`);
        ns.print('  Boosts: hacking, crime, work, infiltration success');
        ns.print('  ⚠ Intel is PERMANENT across all BNs — always worth gaining');

        ns.print('─'.repeat(56));
        ns.print(`  Refreshes every ${LOOP_MS/1000}s`);

        await ns.sleep(LOOP_MS);
    }
}

//Add aliases:

//alias -g hacknet="run hacknet-manager.js"
//alias -g share="run share.js"
//alias -g stats="run stat-tracker.js"
//alias -g intel="run intel-tracker.js"