/**
 * orchestrator.js — Batcher manager + single shared tail display
 *
 * - Manages up to 4 Batcher.js instances
 * - Batcher.js runs on purchased servers or rooted servers
 * - Workers (h/g/w) spread across all rooted + purchased servers
 * - Auto-migrates off home onto pserv-0 if available
 * - Reads batcher-[target].txt state files written by each Batcher to home
 * - Syncs worker scripts to all rooted + purchased servers every 5 minutes
 *
 * Usage: run orchestrator.js
 * Compatible with Bitburner 3.0 API.
 */

import {
    getRootedServers,
    formatMoney,
    formatRam,
    formatTime,
    formatPct,
    TailBox,
} from 'Utils.js';

// ─── Constants ────────────────────────────────────────────────────────────────

const MAX_BATCHERS    = 3;
const CHECK_INTERVAL  = 5 * 60 * 1000;
const RAM_BUFFER_PCT  = 0.85;
const BATCHER_SCRIPT  = 'Batcher.js';
const HACK_PCT        = 0.10;
const LOOP_SLEEP      = 1000;
const WORKERS         = ['hack-only.js', 'grow-only.js', 'weaken-only.js'];
const BATCHER_FILES   = ['Batcher.js', 'Utils.js', 'hack-only.js', 'grow-only.js', 'weaken-only.js'];
const MIN_BATCHER_RAM = 10; // just above Batcher.js 9.05GB cost

// ─── Migration ────────────────────────────────────────────────────────────────

async function migrateIfNeeded(ns) {
    if (ns.getHostname() !== 'home') return;

    const pservs = ns.cloud.getServerNames();
    if (!pservs.includes('pserv-0')) return;
    if (ns.getServerMaxRam('pserv-0') < 16) return;

    const already = ns.ps('pserv-0');
    if (already.some(p => p.filename === 'orchestrator.js')) {
        ns.tprint('⏭ Orchestrator already running on pserv-0, exiting home copy.');
        ns.exit();
    }

    const allFiles = [...BATCHER_FILES, 'orchestrator.js'];
    for (const file of allFiles) {
        if (ns.fileExists(file, 'home')) {
            await ns.scp(file, 'pserv-0', 'home');
            ns.tprint(`  SCP'd ${file} to pserv-0`);
        } else {
            ns.tprint(`  ⚠ Missing ${file} on home, skipping`);
        }
    }

    await ns.sleep(500);

    const pid = ns.exec('orchestrator.js', 'pserv-0', 1);
    if (pid > 0) {
        ns.tprint(`✅ Orchestrator launched on pserv-0 (pid ${pid}), exiting home copy.`);
        await ns.sleep(200);
        ns.exit();
    } else {
        ns.tprint('⚠ Failed to launch orchestrator on pserv-0, staying on home.');
    }
}

// ─── Startup Kill Switch ──────────────────────────────────────────────────────

async function killAllBatchers(ns) {
    const allHosts = [ns.getHostname(), ...getWorkerHosts(ns)];
    let killed = 0;

    for (const host of allHosts) {
        for (const proc of ns.ps(host)) {
            if (proc.filename === BATCHER_SCRIPT) {
                ns.kill(proc.pid);
                ns.tprint(`🔪 Killed ${BATCHER_SCRIPT} on ${host} (pid ${proc.pid}, target: ${proc.args[0] ?? '?'})`);
                killed++;
            }
        }
    }

    // Clean up any leftover state files
    for (const file of ns.ls('home', 'batcher-')) {
        ns.rm(file);
    }

    if (killed > 0) {
        ns.tprint(`✅ Kill switch: terminated ${killed} Batcher instance(s).`);
        await ns.sleep(500); // brief pause to let processes fully die
    } else {
        ns.tprint(`ℹ Kill switch: no running Batchers found.`);
    }
}

// ─── Server helpers ───────────────────────────────────────────────────────────

function getPservs(ns) {
    return ns.cloud.getServerNames();
}

function getWorkerHosts(ns) {
    const pservs = new Set(getPservs(ns));
    const rooted = getRootedServers(ns).filter(h => h !== 'home' && !pservs.has(h));
    return [...rooted, ...pservs];
}

function getBatcherHosts(ns) {
    const pservs = new Set(getPservs(ns));
    const hosts  = [];

    // purchased servers first
    for (const h of getPservs(ns)) {
        const free = ns.getServerMaxRam(h) - ns.getServerUsedRam(h);
        if (free >= MIN_BATCHER_RAM) hosts.push(h);
    }

    // rooted non-home servers as fallback
    for (const h of getRootedServers(ns)) {
        if (h === 'home')    continue;
        if (pservs.has(h))   continue;
        if (h === 'darkweb') continue;
        const free = ns.getServerMaxRam(h) - ns.getServerUsedRam(h);
        if (free >= MIN_BATCHER_RAM) hosts.push(h);
    }

    return hosts;
}

function getTotalUsableRam(ns) {
    let total = 0;
    for (const host of getWorkerHosts(ns)) {
        const max  = ns.getServerMaxRam(host);
        const used = ns.getServerUsedRam(host);
        total += Math.max(0, max * RAM_BUFFER_PCT - used);
    }
    return total;
}

function hasRamForNewBatcher(ns) {
    return getTotalUsableRam(ns) >= 32 && getBatcherHosts(ns).length > 0;
}

function isBatcherAlive(ns, pid) {
    return pid != null && ns.isRunning(pid);
}

// ─── Target scoring ───────────────────────────────────────────────────────────

function getAllServers(ns) {
    const visited = new Set(['home']);
    const queue   = ['home'];
    while (queue.length > 0) {
        const host = queue.shift();
        for (const neighbor of ns.scan(host)) {
            if (!visited.has(neighbor)) {
                visited.add(neighbor);
                queue.push(neighbor);
            }
        }
    }
    visited.delete('home');
    return [...visited];
}

function getTopTargets(ns, count) {
    const pservs = new Set(getPservs(ns));
    const servers = getAllServers(ns);
    const player  = ns.getPlayer();
    const scores  = [];

    for (const s of servers) {
        if (!ns.hasRootAccess(s))  continue;
        if (pservs.has(s))         continue;
        if (s === 'home')          continue;
        if (s === 'darkweb')       continue;

        try {
            const maxMoney = ns.getServerMaxMoney(s);
            if (maxMoney <= 0) continue;
            if (ns.getServerRequiredHackingLevel(s) > player.skills.hacking) continue;

            const minSec   = ns.getServerMinSecurityLevel(s);
            const hackTime = ns.getHackTime(s);
            const score    = maxMoney / (hackTime * minSec);
            scores.push({ server: s, score });
        } catch { continue; }
    }

    return scores
        .sort((a, b) => b.score - a.score)
        .slice(0, count)
        .map(x => x.server);
}

// ─── State file reader ────────────────────────────────────────────────────────

function readBatcherState(ns, target) {
    try {
        const raw = ns.read(`batcher-${target}.txt`);
        if (!raw || raw === '') return null;
        return JSON.parse(raw);
    } catch { return null; }
}

// ─── Worker + Batcher sync ────────────────────────────────────────────────────

async function syncWorkers(ns) {
    const hosts    = getWorkerHosts(ns);
    const hostname = ns.getHostname();

    for (const host of hosts) {
        for (const worker of WORKERS) {
            if (ns.fileExists(worker, hostname)) {
                await ns.scp(worker, host, hostname);
            }
        }
    }
    for (const host of getPservs(ns)) {
        for (const file of BATCHER_FILES) {
            if (ns.fileExists(file, hostname)) {
                await ns.scp(file, host, hostname);
            }
        }
    }
    return hosts.length;
}

// ─── Phase display helpers ────────────────────────────────────────────────────

function phaseIcon(phase) {
    switch (phase) {
        case 'PREPPING':  return '⏳';
        case 'BATCHING':  return '⚡';
        case 'NO RAM':    return '⚠';
        default:          return '❓';
    }
}

function secBar(cur, min, width = 10) {
    const drift  = Math.max(0, cur - min);
    const filled = Math.round(Math.min(1, drift / 50) * width);
    return '[' + '█'.repeat(filled) + '░'.repeat(width - filled) + ']';
}

function monBar(cur, max, width = 10) {
    const ratio  = max > 0 ? Math.min(1, cur / max) : 0;
    const filled = Math.round(ratio * width);
    return '[' + '█'.repeat(filled) + '░'.repeat(width - filled) + ']';
}

// ─── Main ─────────────────────────────────────────────────────────────────────

/** @param {NS} ns */
export async function main(ns) {
    ns.disableLog('ALL');

    await migrateIfNeeded(ns);
    await killAllBatchers(ns);

    ns.ui.openTail();
    ns.ui.setTailTitle('🎯 Orchestrator');

    const slots = new Array(MAX_BATCHERS).fill(null);

    ns.print('⏳ Syncing workers...');
    const synced = await syncWorkers(ns);
    ns.print(`✅ Synced to ${synced} servers`);

    let lastRamCheck  = 0;
    let totalRamFree  = 0;
    let ramOk         = true;
    let cycle         = 0;
    let lastSyncCount = synced;

    while (true) {
        cycle++;
        const now = Date.now();

        if (now - lastRamCheck >= CHECK_INTERVAL || lastRamCheck === 0) {
            totalRamFree  = getTotalUsableRam(ns);
            ramOk         = hasRamForNewBatcher(ns);
            lastRamCheck  = now;
            lastSyncCount = await syncWorkers(ns);
        }

        for (let i = 0; i < MAX_BATCHERS; i++) {
            if (slots[i] && !isBatcherAlive(ns, slots[i].pid)) {
                try { ns.rm(`batcher-${slots[i].target}.txt`); } catch {}
                slots[i] = null;
            }
        }

        const usedTargets = slots.filter(Boolean).map(s => s.target);
        const emptySlots  = slots.map((s, i) => s === null ? i : -1).filter(i => i !== -1);

        if (emptySlots.length > 0 && ramOk) {
            const candidates   = getTopTargets(ns, 20).filter(t => !usedTargets.includes(t));
            const batcherHosts = getBatcherHosts(ns);

            for (let e = 0; e < emptySlots.length; e++) {
                if (e >= candidates.length)    break;
                if (batcherHosts.length === 0) break;
                if (!hasRamForNewBatcher(ns))  break;

                const slotIdx   = emptySlots[e];
                const target    = candidates[e];
                const hostname  = ns.getHostname();

                const batchHost = batcherHosts.sort((a, b) =>
                    (ns.getServerMaxRam(b) - ns.getServerUsedRam(b)) -
                    (ns.getServerMaxRam(a) - ns.getServerUsedRam(a))
                )[0];

                for (const file of BATCHER_FILES) {
                    if (ns.fileExists(file, hostname)) {
                        await ns.scp(file, batchHost, hostname);
                    }
                }

                const pid = ns.exec(BATCHER_SCRIPT, batchHost, 1, target, HACK_PCT);
                if (pid > 0) {
                    slots[slotIdx] = { target, pid, host: batchHost, startTime: Date.now() };
                    ns.print(`✅ Batcher launched on ${batchHost} for ${target}`);
                } else {
                    ns.print(`⚠ Failed to launch Batcher on ${batchHost} for ${target}`);
                }
            }
        }

        ns.clearLog();
        const box = new TailBox(ns);

        box.row(`  🎯 ORCHESTRATOR  [${ns.getHostname()}]`);
        box.div();
        box.row(`  Cycle:       ${cycle}`);
        box.row(`  Usable RAM:  ${formatRam(totalRamFree)}  RAM ok: ${ramOk ? 'Yes' : 'No'}`);
        box.row(`  Next sync:   ${formatTime(Math.max(0, CHECK_INTERVAL - (now - lastRamCheck)))}  Servers: ${lastSyncCount}`);
        box.row(`  Batcher hosts: ${getBatcherHosts(ns).length} available  Hack%: ${formatPct(HACK_PCT)}`);
        box.div();
        box.row(`  ${'TARGET'.padEnd(18)} ${'HOST'.padEnd(12)} ${'PHASE'.padEnd(10)} ${'SEC / MIN'.padEnd(16)} MONEY`);
        box.div();

        for (let i = 0; i < MAX_BATCHERS; i++) {
            const slot = slots[i];

            if (!slot) {
                box.row(`  [${i + 1}] — EMPTY`);
                continue;
            }

            const alive = isBatcherAlive(ns, slot.pid);
            const state = readBatcherState(ns, slot.target);

            if (!alive) {
                box.row(`  [${i + 1}] 💀 ${slot.target.padEnd(16)} DEAD (was on ${slot.host})`);
                continue;
            }

            if (!state) {
                const uptime = formatTime(now - slot.startTime);
                box.row(`  [${i + 1}] ⏳ ${slot.target.padEnd(16)} starting... (${slot.host}, up ${uptime})`);
                continue;
            }

            const icon   = phaseIcon(state.phase);
            const secStr = `${state.secCur.toFixed(1)} / ${state.secMin.toFixed(1)}`;
            const secB   = secBar(state.secCur, state.secMin, 8);
            const monStr = `${formatMoney(state.monCur)} / ${formatMoney(state.monMax)}`;
            const monB   = monBar(state.monCur, state.monMax, 8);
            const uptime = formatTime(now - slot.startTime);

            box.row(`  [${i + 1}] ${icon} ${slot.target.padEnd(16)} ${slot.host.padEnd(12)} ${state.phase.padEnd(10)} sec: ${secStr.padEnd(12)} ${secB}`);
            box.row(`       up: ${uptime.padEnd(12)} mon: ${monStr.padEnd(22)} ${monB}`);
            box.row(`       batches: ${String(state.batches ?? 0).padEnd(8)} failures: ${state.failures ?? 0}  hack%: ${formatPct(state.hackPct ?? HACK_PCT)}`);

            if (state.threads) {
                const t = state.threads;
                box.row(`       threads  H:${String(t.h).padStart(4)}  W1:${String(t.w1).padStart(4)}  G:${String(t.g).padStart(4)}  W2:${String(t.w2).padStart(4)}`);
            }

            if (i < MAX_BATCHERS - 1) box.div();
        }

        box.print();
        await ns.sleep(LOOP_SLEEP);
    }
}