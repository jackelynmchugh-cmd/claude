/**
 * manual-hack.js — Smart Weighted + Efficiency Distributed Swarm
 */

import { formatMoney } from 'Utils.js';

const HOME_RAM_CAP  = 0.90;
const MAX_TARGETS   = 6;

const HACK_SCRIPT   = 'hack-only.js';
const GROW_SCRIPT   = 'grow-only.js';
const WEAKEN_SCRIPT = 'weaken-only.js';

const LOOP_SLEEP    = 500;

// ─── Color Helpers ─────────────────────────────────────────

const C = {
    reset:   '\x1b[0m',
    bold:    '\x1b[1m',
    dim:     '\x1b[2m',
    red:     '\x1b[31m',
    green:   '\x1b[32m',
    yellow:  '\x1b[33m',
    cyan:    '\x1b[36m',
    bgreen:  '\x1b[92m',
    byellow: '\x1b[93m',
    bcyan:   '\x1b[96m',
};

const col       = (c, t) => `${c}${t}${C.reset}`;
const bold      = (t)    => `${C.bold}${t}${C.reset}`;
const stripAnsi = (s)    => s.replace(/\x1b\[[0-9;]*m/g, '');

function pad(str, width, right = false) {
    const visible = stripAnsi(str);
    const spaces  = Math.max(0, width - visible.length);
    return right ? ' '.repeat(spaces) + str : str + ' '.repeat(spaces);
}

// ─── Runner Discovery ──────────────────────────────────────

function getAllHosts(ns) {
    const visited = new Set();
    const queue   = ['home'];
    while (queue.length) {
        const host = queue.shift();
        if (visited.has(host)) continue;
        visited.add(host);
        for (const n of ns.scan(host)) queue.push(n);
    }
    return [...visited];
}

function getRunners(ns) {
    const runners = [];

    for (const host of getAllHosts(ns)) {
        if (!ns.hasRootAccess(host)) continue;

        const maxRam = ns.getServerMaxRam(host);
        if (maxRam < 2) continue;

        const cap  = host === 'home' ? maxRam * HOME_RAM_CAP : maxRam;
        const free = Math.max(0, cap - ns.getServerUsedRam(host));
        if (free < 2) continue;

        runners.push({ host, free, cap });
    }

    return runners.sort((a, b) => b.free - a.free);
}

// ─── Script Deployment ─────────────────────────────────────

function ensureScripts(ns, host) {
    if (host === 'home') return;
    for (const script of [HACK_SCRIPT, GROW_SCRIPT, WEAKEN_SCRIPT]) {
        if (!ns.fileExists(script, host)) ns.scp(script, host, 'home');
    }
}

// ─── Distributed Exec ──────────────────────────────────────

function execDistributed(ns, script, target, desiredThreads, runners) {
    if (desiredThreads < 1) return 0;

    const ram     = ns.getScriptRam(script, 'home');
    let remaining = desiredThreads;
    let launched  = 0;

    for (const runner of runners) {
        if (remaining <= 0) break;

        const canRun = Math.floor(runner.free / ram);
        if (canRun < 1) continue;

        ensureScripts(ns, runner.host);

        const threads = Math.min(remaining, canRun);
        const pid     = ns.exec(script, runner.host, threads, target);

        if (pid > 0) {
            launched   += threads;
            remaining  -= threads;
            runner.free -= threads * ram;
        }
    }

    return launched;
}

// ─── Target Selection ──────────────────────────────────────

function pickTargets(ns) {
    const list       = [];
    const playerHack = ns.getHackingLevel();

    for (const host of getAllHosts(ns)) {
        if (!ns.hasRootAccess(host))         continue;
        if (ns.getServerMaxMoney(host) <= 0) continue;
        if (ns.getServerRequiredHackingLevel(host) > playerHack * 0.9) continue;

        const maxMoney   = ns.getServerMaxMoney(host);
        const weakenTime = ns.getWeakenTime(host);
        const minSec     = ns.getServerMinSecurityLevel(host);
        const growth     = ns.getServerGrowth(host);

        const baseScore =
            Math.pow(maxMoney, 0.9) *
            Math.pow(growth, 0.3) /
            (Math.pow(weakenTime, 0.6) * (minSec + 1));

        list.push({ host, baseScore });
    }

    return list
        .sort((a, b) => b.baseScore - a.baseScore)
        .slice(0, MAX_TARGETS);
}

function getEfficiency(ns, host, baseScore) {
    return baseScore / ns.getHackTime(host);
}

// ─── MAIN ──────────────────────────────────────────────────

export async function main(ns) {
    ns.disableLog('ALL');
    ns.ui.openTail();
    ns.ui.setTailTitle('💰 Distributed Efficiency Swarm');

    let targets             = pickTargets(ns);
    let cyclesSinceRetarget = 0;

    while (true) {
        ns.clearLog();

        if (cyclesSinceRetarget++ >= 60) {
            targets = pickTargets(ns);
            cyclesSinceRetarget = 0;
        }

        const runners  = getRunners(ns);
        const ramTotal = runners.reduce((s, r) => s + r.free, 0);
        const capTotal = runners.reduce((s, r) => s + r.cap,  0);

        const hackRam = ns.getScriptRam(HACK_SCRIPT, 'home');
        const growRam = ns.getScriptRam(GROW_SCRIPT, 'home');
        const weakRam = ns.getScriptRam(WEAKEN_SCRIPT, 'home');

        const enriched = targets.map(t => ({
            ...t,
            efficiency: getEfficiency(ns, t.host, t.baseScore)
        }));

        const readiness = enriched.map(t => {
            const s = ns.getServer(t.host);
            return (s.hackDifficulty - s.minDifficulty <= 7) &&
                   (s.moneyAvailable >= s.moneyMax * 0.5);
        });

        const readyEff = enriched.reduce((s, t, i) =>  readiness[i] ? s + t.efficiency : s, 0);
        const prepEff  = enriched.reduce((s, t, i) => !readiness[i] ? s + t.efficiency : s, 0);

        function getRamShare(index) {
            const t = enriched[index];
            if (readiness[index]) {
                return readyEff === 0 ? 0 : ramTotal * 0.80 * (t.efficiency / readyEff);
            } else {
                return prepEff  === 0 ? 0 : ramTotal * 0.20 * (t.efficiency / prepEff);
            }
        }

        // ── Header ──
        ns.print(col(C.bcyan, bold(
            'TARGET         PHASE   EFF        RAM%   THREADS (H/G/W)   MONEY'
        )));
        ns.print(col(C.dim,
            '──────────────────────────────────────────────────────────────────────'
        ));

        for (let i = 0; i < enriched.length; i++) {
            const { host, efficiency } = enriched[i];
            const ramShare = getRamShare(i);

            const s        = ns.getServer(host);
            const secDiff  = s.hackDifficulty - s.minDifficulty;
            const money    = s.moneyAvailable;
            const max      = s.moneyMax;
            const moneyPct = (money / max * 100).toFixed(0);
            const ramPct   = ramTotal > 0 ? ((ramShare / ramTotal) * 100).toFixed(0) : '0';

            let h = 0, g = 0, w = 0;
            let phaseStr = '';

            if (secDiff > 7) {
                phaseStr = col(C.cyan, 'WEAK');
                w = execDistributed(ns, WEAKEN_SCRIPT, host,
                    Math.floor(ramShare / weakRam), runners);

            } else if (money < max * 0.50) {
                phaseStr = col(C.yellow, 'GROW');
                const growThreads = Math.floor(ramShare / (growRam + weakRam * 0.5));
                g = execDistributed(ns, GROW_SCRIPT,   host, growThreads,                  runners);
                w = execDistributed(ns, WEAKEN_SCRIPT, host, Math.ceil(growThreads * 0.5), runners);

            } else {
                phaseStr = col(C.bgreen, 'HACK');
                const unitCost = hackRam * 6 + growRam * 2 + weakRam;
                const units    = Math.floor(ramShare / unitCost);
                h = execDistributed(ns, HACK_SCRIPT,   host, units * 6, runners);
                g = execDistributed(ns, GROW_SCRIPT,   host, units * 2, runners);
                w = execDistributed(ns, WEAKEN_SCRIPT, host, units,     runners);
            }

            const threadStr = (h + g + w === 0)
                ? col(C.dim, '  —')
                : `${String(h).padStart(4)}${String(g).padStart(4)}${String(w).padStart(4)}`;

            ns.print(
                pad(host, 15) +
                pad(phaseStr, 8) +
                pad(efficiency.toExponential(2), 11) +
                String(ramPct).padStart(4) + '%   ' +
                pad(threadStr, 16) +
                `${formatMoney(money).padStart(10)} / ${formatMoney(max)} (${moneyPct}%)`
            );
        }

        // ── Footer ──
        const usedRam = capTotal - ramTotal;
        const usedPct = capTotal > 0 ? (usedRam / capTotal * 100).toFixed(0) : '0';

        ns.print('');
        ns.print(
            col(C.green, `RAM: ${usedRam.toFixed(0)}/${capTotal.toFixed(0)} GB (${usedPct}% used)`) +
            col(C.dim, `  |  Runners: `) + col(C.bcyan,  String(runners.length)) +
            col(C.dim, `  Ready: `)      + col(C.bgreen, String(enriched.filter((_,i) =>  readiness[i]).length)) +
            col(C.dim, `  Prepping: `)   + col(C.yellow, String(enriched.filter((_,i) => !readiness[i]).length)) +
            col(C.dim, `  Retarget in: ${60 - cyclesSinceRetarget}`)
        );

        if (ramTotal < 2) ns.print(col(C.red, '⚠ RAM SATURATED across all runners'));

        await ns.sleep(LOOP_SLEEP);
    }
}