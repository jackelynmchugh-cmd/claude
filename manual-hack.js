/**
 * Home-Only Aggressive Swarm
 */

import { formatMoney } from 'Utils.js';

// ─── Constants ────────────────────────────────────────────────────────────────

const HOME_RAM_CAP  = 0.90;
const MAX_TARGETS   = 4;

const HACK_SCRIPT   = 'hack-only.js';
const GROW_SCRIPT   = 'grow-only.js';
const WEAKEN_SCRIPT = 'weaken-only.js';

const LOOP_SLEEP    = 500;

// ─── Security Tolerance ───────────────────────────────────────────────────────

const WEAK_THRESHOLD_ABSOLUTE = 1e12;  // servers >= $1T always use strict weaken threshold
const SEC_SCALE_DIVISOR       = 1e9;   // $1b max money = 1 point of sec tolerance
const SEC_TOLERANCE_MIN       = 1;     // never tolerate less than 1 point over min
const SEC_TOLERANCE_MAX       = 20;    // cap tolerance at 20 points for mid-tier servers

function getSecTolerance(maxMoney) {
    if (maxMoney >= WEAK_THRESHOLD_ABSOLUTE) return 7;
    return Math.max(SEC_TOLERANCE_MIN, Math.min(SEC_TOLERANCE_MAX, maxMoney / SEC_SCALE_DIVISOR));
}

// ─── RAM ──────────────────────────────────────────────────────────────────────

function getHomeFree(ns) {
    const max  = ns.getServerMaxRam('home');
    const used = ns.getServerUsedRam('home');
    return Math.max(0, max * HOME_RAM_CAP - used);
}

// ─── Running Thread Count ─────────────────────────────────────────────────────

function getRunningThreads(ns, script, target, host = 'home') {
    return ns.ps(host)
        .filter(p => p.filename === script && p.args[0] === target)
        .reduce((s, p) => s + p.threads, 0);
}

// ─── Targets ──────────────────────────────────────────────────────────────────

function pickTargets(ns) {
    const visited = new Set(['home']);
    const queue   = ['home'];
    const list    = [];

    while (queue.length) {
        const host = queue.shift();
        for (const n of ns.scan(host)) {
            if (visited.has(n)) continue;
            visited.add(n);
            queue.push(n);

            if (!ns.hasRootAccess(n)) continue;
            if (ns.getServerMaxMoney(n) <= 0) continue;

            const score = ns.getServerMaxMoney(n) / ns.getWeakenTime(n);
            list.push({ host: n, score });
        }
    }

    return list
        .sort((a, b) => b.score - a.score)
        .slice(0, MAX_TARGETS)
        .map(x => x.host);
}

// ─── EXEC ─────────────────────────────────────────────────────────────────────

function execAdaptive(ns, script, target, desiredThreads) {
    const ram        = ns.getScriptRam(script, 'home');
    const free       = getHomeFree(ns);
    const maxThreads = Math.floor(free / ram);

    if (maxThreads < 1 || desiredThreads < 1) return 0;

    const threads = Math.min(desiredThreads, maxThreads);
    const pid     = ns.exec(script, 'home', threads, target);
    return pid > 0 ? threads : 0;
}

// ─── MAIN ─────────────────────────────────────────────────────────────────────

export async function main(ns) {
    ns.disableLog('ALL');
    ns.ui.openTail();
    ns.ui.setTailTitle('💰 Aggressive Home Swarm');

    let targets             = pickTargets(ns);
    let cyclesSinceRetarget = 0;

    while (true) {
        ns.clearLog();

        if (cyclesSinceRetarget++ >= 60) {
            targets = pickTargets(ns);
            cyclesSinceRetarget = 0;
        }

        const hackRam = ns.getScriptRam(HACK_SCRIPT,   'home');
        const growRam = ns.getScriptRam(GROW_SCRIPT,   'home');
        const weakRam = ns.getScriptRam(WEAKEN_SCRIPT, 'home');

        const readiness = targets.map(target => {
            const s          = ns.getServer(target);
            const secDiff    = s.hackDifficulty - s.minDifficulty;
            const tolerance  = getSecTolerance(s.moneyMax);
            return secDiff <= tolerance && s.moneyAvailable >= s.moneyMax * 0.50;
        });

        const readyCount = readiness.filter(Boolean).length;
        const prepCount  = readiness.filter(b => !b).length;
        const totalFree  = getHomeFree(ns);

        const readyShare = readyCount === 0 ? 0
            : (totalFree * 0.80) / readyCount;

        const prepShare = prepCount === 0 ? 0
            : readyCount === 0
                ? totalFree / prepCount
                : (totalFree * 0.20) / prepCount;

        ns.print('TARGET        PHASE    SEC (tol)    MONEY                    H     G     W');
        ns.print('────────────────────────────────────────────────────────────────────────────');

        for (let ti = 0; ti < targets.length; ti++) {
            const target    = targets[ti];
            const isReady   = readiness[ti];
            const ramShare  = isReady ? readyShare : prepShare;

            const s         = ns.getServer(target);
            const secDiff   = s.hackDifficulty - s.minDifficulty;
            const money     = s.moneyAvailable;
            const max       = s.moneyMax;
            const tolerance = getSecTolerance(max);

            let phase = '';

            if (secDiff > tolerance) {
                phase = '🔵 WEAK';
                execAdaptive(ns, WEAKEN_SCRIPT, target, Math.floor(ramShare / weakRam));

            } else if (money < max * 0.50) {
                phase = '🟡 GROW';
                const growThreads = Math.floor(ramShare / (growRam + weakRam * 0.5));
                execAdaptive(ns, GROW_SCRIPT,   target, growThreads);
                execAdaptive(ns, WEAKEN_SCRIPT, target, Math.ceil(growThreads * 0.5));

            } else {
                phase = '🟢 HACK';
                const unitCost = hackRam * 6 + growRam * 2 + weakRam;
                const units    = Math.floor(ramShare / unitCost);
                execAdaptive(ns, HACK_SCRIPT,   target, units * 6);
                execAdaptive(ns, GROW_SCRIPT,   target, units * 2);
                execAdaptive(ns, WEAKEN_SCRIPT, target, units);
            }

            const h = getRunningThreads(ns, HACK_SCRIPT,   target);
            const g = getRunningThreads(ns, GROW_SCRIPT,   target);
            const w = getRunningThreads(ns, WEAKEN_SCRIPT, target);

            // Show sec diff vs tolerance, e.g. "+3.2 / 5.0"
            const secStr = `+${secDiff.toFixed(1)}/${tolerance.toFixed(1)}`;

            ns.print(
                `${target.padEnd(14)}` +
                `${phase.padEnd(9)}` +
                `${secStr.padEnd(13)}` +
                `${(formatMoney(money) + ' / ' + formatMoney(max)).padEnd(26)}` +
                `${String(h).padStart(4)}${String(g).padStart(4)}${String(w).padStart(4)}`
            );
        }

        ns.print('');
        ns.print(`Free RAM: ${getHomeFree(ns).toFixed(1)} GB  Ready: ${readyCount}  Prepping: ${prepCount}`);
        ns.print(`Next retarget in: ${60 - cyclesSinceRetarget} cycles`);

        await ns.sleep(LOOP_SLEEP);
    }
}