/**
 * darknet-auth.js — Heavy auth dispatcher (lightweight executor)
 *
 * Kept small deliberately — all logic lives in darknet-solver.js.
 * Strictly sequential — Bitburner does not allow concurrent ns calls.
 *
 * Strategy per target:
 *   NIL  → runNilSolver (iterative feedback loop)
 *   else → interleaved heartbleed + packet capture rounds, then retry
 *
 * Usage: run darknet-auth.js [host1] [host2] ...
 * Compatible with Bitburner 3.0 API.
 */

import { runNilSolver, runHeartbleed, runPacketCapture, runDeepGreenSolver, run2GCellularSolver, rememberPassword, extractPacketCandidates, extractHeartbleedCandidates } from 'darknet-solver.js';

const MAX_RETRIES = 5;
const RETRY_DELAY = 8_000;

function savePassword(ns, host, pw) {
    try { ns.write(`dnet-pw-${host}.txt`, pw, 'w'); } catch {}
}

async function authTarget(ns, target) {
    let details;
    try { details = ns.dnet.getServerAuthDetails(target); } catch { return false; }
    if (!details?.isOnline || !details?.isConnectedToCurrentServer) return false;
    if (details.hasSession || details.hasAdminRights) return true;

    const tryCandidates = async (candidates, label) => {
        for (const pw of candidates) {
            try {
                const r = await ns.dnet.authenticate(target, pw);
                if (r?.success) {
                    savePassword(ns, target, pw);
                    rememberPassword(ns, details.modelId, pw, target);
                    ns.print(`  ✅ ${label} → ${target}: "${pw}"`);
                    return pw;
                }
            } catch {}
            await ns.sleep(50);
        }
        return null;
    };

    if (details.modelId === 'NIL') {
        const result = await runNilSolver(ns, target, details);
        return result !== null;
    }

    if (details.modelId === 'DeepGreen') {
        const result = await runDeepGreenSolver(ns, target, details);
        return result !== null;
    }

    if (details.modelId === '2G_cellular') {
        const result = await run2GCellularSolver(ns, target, details);
        return result !== null;
    }

    // Interleaved: one heartbleed round then one packet round, sequential
    const pw = await runInterleaved(ns, target, details, tryCandidates);
    return pw !== null;
}

async function runInterleaved(ns, target, details, tryCandidates) {
    const HB_ROUNDS      = 12;
    const HB_POLL        = 1_200;
    const PACKET_POLLS   = 8;
    const PACKET_POLL    = 800;

    const hbSeen     = new Set();
    const packetSeen = new Set();

    for (let round = 0; round < Math.max(HB_ROUNDS, PACKET_POLLS); round++) {
        // ── Heartbleed round ───────────────────────────────────────────────
        if (round < HB_ROUNDS) {
            try {
                const hb   = await ns.dnet.heartbleed(target, { logsToCapture: 8 });
                const logs = hb?.logs ?? [];
                if (Array.isArray(logs) && logs.length > 0) {
                    // extract candidates inline to avoid importing the heavy fn
                    const fresh = extractHeartbleedCandidates(logs, details).filter(c => !hbSeen.has(c));
                    fresh.forEach(c => hbSeen.add(c));
                    if (fresh.length > 0) {
                        ns.print(`  🩸 HB round ${round + 1}: ${fresh.length} new candidates`);
                        const pw = await tryCandidates(fresh, 'heartbleed');
                        if (pw !== null) return pw;
                    } else {
                        ns.print(`  🩸 HB round ${round + 1}: no new candidates`);
                    }
                }
            } catch (e) { ns.print(`  ⚠ HB ${round + 1}: ${e}`); }
            await ns.sleep(HB_POLL);
        }

        // ── Packet capture round ───────────────────────────────────────────
        if (round < PACKET_POLLS) {
            try {
                const cap = await ns.dnet.packetCapture(target);
                if (cap?.success && cap?.data) {
                    const raw = cap.data?.trim();
                    if (!packetSeen.has(raw)) {
                        packetSeen.add(raw);
                        ns.print(`  📡 Packet: "${raw?.slice(0, 40)}..."`);
                        const parsed = extractPacketCandidates(raw, details).filter(c => !packetSeen.has(c));
                        parsed.forEach(c => packetSeen.add(c));
                        if (parsed.length > 0) {
                            const pw = await tryCandidates(parsed, 'packet');
                            if (pw !== null) return pw;
                        }
                    }
                }
            } catch (e) { ns.print(`  ⚠ Packet ${round + 1}: ${e}`); }
            await ns.sleep(PACKET_POLL);
        }
    }

    return null;
}



// ─── Main ─────────────────────────────────────────────────────────────────────

/** @param {NS} ns */
export async function main(ns) {
    ns.disableLog('ALL');

    const targets = ns.args.filter(a => typeof a === 'string' && a.length > 0);
    if (targets.length === 0) { ns.tprint('ERROR: Usage: run darknet-auth.js [host1] [host2] ...'); return; }

    ns.print(`🔐 Auth: ${targets.length} target(s): ${targets.join(', ')}`);

    const pending = new Set(targets);

    for (let attempt = 0; attempt < MAX_RETRIES && pending.size > 0; attempt++) {
        if (attempt > 0) {
            ns.print(`🔄 Retry ${attempt}/${MAX_RETRIES} — ${pending.size} remaining`);
            await ns.sleep(RETRY_DELAY);
        }

        // Sequential across targets — no Promise.all
        for (const target of [...pending]) {
            ns.print(`  → [${target}]`);
            const ok = await authTarget(ns, target);
            if (ok) pending.delete(target);
        }
    }

    if (pending.size > 0) ns.print(`  ❌ Gave up on: ${[...pending].join(', ')}`);
    else                  ns.print(`  ✅ All targets cracked`);
}