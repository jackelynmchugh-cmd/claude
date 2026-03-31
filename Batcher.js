/**
 * Batcher.js — JIT HWGW Batcher (single target, silent)
 *
 * Runs silently — no tail window. Writes state to a JSON file each cycle
 * so orchestrator.js can render it in the single shared display.
 *
 * State file: batcher-[target].txt
 * State shape: { target, phase, batches, failures, secCur, secMin, monCur, monMax, weakenTime }
 *
 * Usage:
 *   run Batcher.js [target] [hackPercent]
 *
 * Compatible with Bitburner 3.0 API.
 */

import {
    getWorkerServersNoHome,
    getUsableRam,
    distributeThreads,
    formatPct
} from 'Utils.js';

// ─── Constants ────────────────────────────────────────────────────────────────

const GAP           = 50;
const LOOP_SLEEP    = 20;
const HACK_SCRIPT   = 'hack-only.js';
const GROW_SCRIPT   = 'grow-only.js';
const WEAKEN_SCRIPT = 'weaken-only.js';
const HACK_RAM      = 1.7;
const GROW_RAM      = 1.75;
const WEAKEN_RAM    = 1.75;
const WEAKEN_PER_THREAD    = 0.05;
const HACK_SEC_PER_THREAD  = 0.002;
const GROW_SEC_PER_THREAD  = 0.004;

// ─── State file helpers ───────────────────────────────────────────────────────

function stateFile(target) {
    return `batcher-${target}.txt`;
}

function writeState(ns, target, state) {
    try {
        // Always write to home so orchestrator can read it regardless of
        // which server this Batcher is running on
        ns.write(stateFile(target), JSON.stringify(state), 'w');
        if (ns.getHostname() !== 'home') {
            ns.scp(stateFile(target), 'home');
        }
    } catch { /* non-fatal */ }
}

function clearState(ns, target) {
    try { ns.rm(stateFile(target)); } catch { /* non-fatal */ }
    try { if (ns.getHostname() !== 'home') ns.rm(stateFile(target), 'home'); } catch {}
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function weakenThreadsFor(amount) {
    return Math.ceil(amount / WEAKEN_PER_THREAD);
}

function calcBatch(ns, target, hackPercent, workers) {
    const server      = ns.getServer(target);
    const maxMoney    = server.moneyMax;
    const hackAmount  = maxMoney * hackPercent;

    const hackThreads = Math.max(1, Math.floor(ns.hackAnalyzeThreads(target, hackAmount)));
    const w1Threads   = weakenThreadsFor(hackThreads * HACK_SEC_PER_THREAD);

    const moneyAfterHack = maxMoney * (1 - hackPercent);
    const growMult       = maxMoney / Math.max(moneyAfterHack, 1);
    const growThreads    = Math.ceil(ns.growthAnalyze(target, growMult));
    const w2Threads      = weakenThreadsFor(growThreads * GROW_SEC_PER_THREAD);

    const hackTime   = ns.getHackTime(target);
    const growTime   = ns.getGrowTime(target);
    const weakenTime = ns.getWeakenTime(target);

    const T        = weakenTime + GAP;
    const hackDelay  = T - GAP     - hackTime;
    const w1Delay    = T           - weakenTime;
    const growDelay  = T + GAP     - growTime;
    const w2Delay    = T + GAP * 2 - weakenTime;

    if (hackDelay < 0 || w1Delay < 0 || growDelay < 0 || w2Delay < 0) return null;

    const totalRamNeeded =
        hackThreads * HACK_RAM   +
        w1Threads   * WEAKEN_RAM +
        growThreads * GROW_RAM   +
        w2Threads   * WEAKEN_RAM;

    const totalRamAvail = workers.reduce((sum, h) => sum + getUsableRam(ns, h), 0);
    if (totalRamAvail < totalRamNeeded) return null;

    return {
        hackThreads, w1Threads, growThreads, w2Threads,
        hackDelay, w1Delay, growDelay, w2Delay,
        weakenTime, hackAmount,
        batchDuration: T + GAP * 2 + weakenTime,
    };
}

function launchOp(ns, script, threads, workers, target, delay, batchId) {
    const ramCost    = script === HACK_SCRIPT ? HACK_RAM : (script === GROW_SCRIPT ? GROW_RAM : WEAKEN_RAM);
    const placements = distributeThreads(ns, ramCost, workers, threads);
    let placed = 0;
    for (const { host, threads: t } of placements) {
        const pid = ns.exec(script, host, t, target, delay, batchId);
        if (pid > 0) placed += t;
    }
    return placed >= threads;
}

// ─── Prep Phase ───────────────────────────────────────────────────────────────

async function prepTarget(ns, target, workers, hackPercent) {
    let batchId = 0;

    while (true) {
        const server  = ns.getServer(target);
        const secDiff = server.hackDifficulty - server.minDifficulty;
        const monOk   = server.moneyAvailable >= server.moneyMax * 0.999;
        const secOk   = secDiff < 0.01;

        // Write prep state for orchestrator display
        writeState(ns, target, {
            target,
            phase:      'PREPPING',
            batches:    0,
            failures:   0,
            secCur:     server.hackDifficulty,
            secMin:     server.minDifficulty,
            monCur:     server.moneyAvailable,
            monMax:     server.moneyMax,
            weakenTime: ns.getWeakenTime(target),
            hackPct:    hackPercent,
        });

        if (monOk && secOk) return;

        const weakenTime = ns.getWeakenTime(target);
        const growTime   = ns.getGrowTime(target);

        if (secDiff >= 0.01) {
            launchOp(ns, WEAKEN_SCRIPT, weakenThreadsFor(secDiff), workers, target, 0, batchId++);
            await ns.sleep(weakenTime + 200);
        } else {
            const growMult  = server.moneyMax / Math.max(server.moneyAvailable, 1);
            const gThreads  = Math.ceil(ns.growthAnalyze(target, growMult));
            const w2Threads = weakenThreadsFor(gThreads * GROW_SEC_PER_THREAD);
            launchOp(ns, GROW_SCRIPT,   gThreads,  workers, target, 0,   batchId++);
            launchOp(ns, WEAKEN_SCRIPT, w2Threads, workers, target, GAP, batchId++);
            await ns.sleep(growTime + 200);
        }
    }
}

// ─── Main ─────────────────────────────────────────────────────────────────────

/** @param {NS} ns */
export async function main(ns) {
    ns.disableLog('ALL');

    const target      = ns.args[0];
    const hackPercent = ns.args[1] ?? 0.5;

    if (!target) {
        ns.tprint('ERROR: Usage: run Batcher.js [target] [hackPercent]');
        return;
    }

    // No tail — orchestrator owns the display
    const workers = getWorkerServersNoHome(ns);

    // ── Prep ──────────────────────────────────────────────────────────────────
    await prepTarget(ns, target, workers, hackPercent);

    // ── Batch loop ────────────────────────────────────────────────────────────
    let batchId         = 0;
    let batchesLaunched = 0;
    let failures        = 0;

    while (true) {
        const currentWorkers = getWorkerServersNoHome(ns);
        const server         = ns.getServer(target);
        const batch          = calcBatch(ns, target, hackPercent, currentWorkers);

        if (!batch) {
            writeState(ns, target, {
                target,
                phase:      'NO RAM',
                batches:    batchesLaunched,
                failures,
                secCur:     server.hackDifficulty,
                secMin:     server.minDifficulty,
                monCur:     server.moneyAvailable,
                monMax:     server.moneyMax,
                weakenTime: ns.getWeakenTime(target),
                hackPct:    hackPercent,
            });
            await ns.sleep(5000);
            continue;
        }

        const { hackThreads, w1Threads, growThreads, w2Threads,
                hackDelay, w1Delay, growDelay, w2Delay,
                weakenTime, hackAmount } = batch;

        const id = batchId++;
        const ok =
            launchOp(ns, HACK_SCRIPT,   hackThreads, currentWorkers, target, hackDelay, id) &&
            launchOp(ns, WEAKEN_SCRIPT, w1Threads,   currentWorkers, target, w1Delay,   id) &&
            launchOp(ns, GROW_SCRIPT,   growThreads, currentWorkers, target, growDelay, id) &&
            launchOp(ns, WEAKEN_SCRIPT, w2Threads,   currentWorkers, target, w2Delay,   id);

        if (!ok) failures++;
        else batchesLaunched++;

        // Write batch state for orchestrator display
        writeState(ns, target, {
            target,
            phase:      'BATCHING',
            batches:    batchesLaunched,
            failures,
            secCur:     server.hackDifficulty,
            secMin:     server.minDifficulty,
            monCur:     server.moneyAvailable,
            monMax:     server.moneyMax,
            weakenTime,
            hackPct:    hackPercent,
            threads:    { h: hackThreads, w1: w1Threads, g: growThreads, w2: w2Threads },
        });

        // Re-prep if drifted
        const secDrift = server.hackDifficulty - server.minDifficulty;
        const monRatio = server.moneyAvailable / server.moneyMax;
        if (secDrift > 5 || monRatio < 0.5) {
            await prepTarget(ns, target, currentWorkers, hackPercent);
            continue;
        }

        await ns.sleep(GAP * 4 + LOOP_SLEEP);
    }

    // Cleanup state file if we somehow exit
    clearState(ns, target);
}