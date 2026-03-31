/**
 * share.js — Runs ns.share() on all available RAM across pservs and rooted servers
 * Boosts faction rep gain rate passively
 *
 * Usage: run share.js
 * It spawns share-worker.js on every server with spare RAM
 */

/** @param {NS} ns */
export async function main(ns) {
    ns.disableLog('ALL');

    // share-worker costs 4GB (ns.share base cost)
    const WORKER_RAM    = 4;
    const HOME_RESERVE  = 32; // always keep 32GB free on home
    const LOOP_MS       = 60_000;

    // write worker script if it doesn't exist
    const WORKER = 'share-worker.js';
    if (!ns.fileExists(WORKER, 'home')) {
        ns.write(WORKER, `export async function main(ns) { await ns.share(); }`, 'w');
    }

    ns.ui.openTail();
    ns.ui.setTailTitle('📡 Share Manager');

    function getAllServers() {
        const visited = new Set(['home']);
        const queue   = ['home'];
        const servers = [];
        while (queue.length) {
            const host = queue.shift();
            servers.push(host);
            for (const neighbor of ns.scan(host)) {
                if (!visited.has(neighbor)) {
                    visited.add(neighbor);
                    queue.push(neighbor);
                }
            }
        }
        return servers;
    }

    while (true) {
        // kill existing share workers to recalculate
        const allServers = getAllServers();
        for (const server of allServers) {
            for (const proc of ns.ps(server)) {
                if (proc.filename === WORKER) ns.kill(proc.pid);
            }
        }

        await ns.sleep(500);

        let totalThreads = 0;
        const spawned    = [];

        for (const server of allServers) {
            if (!ns.hasRootAccess(server)) continue;

            // copy worker to server
            await ns.scp(WORKER, server);

            const maxRam  = ns.getServerMaxRam(server);
            const usedRam = ns.getServerUsedRam(server);
            const reserve = server === 'home' ? HOME_RESERVE : 0;
            const free    = maxRam - usedRam - reserve;
            const threads = Math.floor(free / WORKER_RAM);

            if (threads <= 0) continue;

            const pid = ns.exec(WORKER, server, threads);
            if (pid > 0) {
                totalThreads += threads;
                spawned.push(`${server}: ${threads}t`);
            }
        }

        ns.clearLog();
        ns.print('📡 SHARE MANAGER');
        ns.print('─'.repeat(48));
        ns.print(`  Total share threads: ${totalThreads}`);
        ns.print(`  Servers used: ${spawned.length}`);
        ns.print(`  Rep multiplier boost: ~${(1 + totalThreads * 0.01).toFixed(2)}x (est)`);
        ns.print('─'.repeat(48));
        for (const s of spawned.slice(0, 10)) ns.print(`  ${s}`);
        if (spawned.length > 10) ns.print(`  ...+${spawned.length - 10} more`);
        ns.print('─'.repeat(48));
        ns.print('  Recalculates every 60s');

        await ns.sleep(LOOP_MS);
    }
}