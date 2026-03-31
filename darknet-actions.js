/**
 * darknet-actions.js — Phishing + caches + RAM blocks
 *
 * Runs persistently on each darknet server.
 * RAM budget: ~7GB (no stasis — that's in darknet-stasis.js)
 *
 * Compatible with Bitburner 3.0 API.
 */

const PHISH_SLEEP = 500;
const RAM_SLEEP   = 300;
const CACHE_CYCLE = 60;  // check for new caches every N phishing loops

/** @param {NS} ns */
export async function main(ns) {
    ns.disableLog('ALL');

    const host = ns.getHostname();
    ns.print(`⚡ actions on ${host}`);

    // ── One-time: free RAM blocks ─────────────────────────────────────────────
    let freed = 0;
    for (let i = 0; i < 300; i++) {
        try {
            const res = await ns.dnet.influence.memoryReallocation();
            if (!res?.success) break;
            freed++;
            await ns.sleep(RAM_SLEEP);
        } catch { break; }
    }
    if (freed > 0) ns.print(`🔧 Freed ${freed} RAM blocks`);

    // ── One-time: open existing caches ────────────────────────────────────────
    await openCaches(ns);

    // ── Continuous: phishing + periodic cache check ───────────────────────────
    let loop = 0;
    while (true) {
        loop++;
        try {
            const res = await ns.dnet.phishingAttack();
            if (res?.success) ns.print(`🎣 ${res.message}`);
        } catch {}

        try {
            const sym = ns.peek(3);
            if (sym && sym !== 'NULL PORT DATA') {
                await ns.dnet.promoteStock(sym);
            }
        } catch {}

        if (loop % CACHE_CYCLE === 0) await openCaches(ns);

        await ns.sleep(PHISH_SLEEP);
    }
}

async function openCaches(ns) {
    const caches = ns.ls(ns.getHostname(), '.cache');
    for (const cache of caches) {
        try {
            const res = await ns.dnet.openCache(cache);
            if (res?.success) ns.print(`📦 Cache: ${res.message ?? cache}`);
        } catch {}
        await ns.sleep(100);
    }
}