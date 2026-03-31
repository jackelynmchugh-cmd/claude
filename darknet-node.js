/**
 * darknet-node.js — Lean darknet controller (probe + auth + spread)
 *
 * Runs on every darknet server. Stays small by offloading heavy actions
 * to separate worker scripts exec'd locally:
 *   darknet-actions.js — RAM blocks, caches, stasis, phishing
 *   darknet-auth.js    — heavy auth strategies (packet capture, heartbleed)
 *
 * Stasis priority (highest to lowest):
 *   1. Shadow-adjacent servers (shadowed_walkway neighbors)
 *   2. Lab-adjacent servers (labyrinth neighbors)
 *   3. Self-link only if a slot is freely available — no eviction for generic nodes
 *
 * Usage: run darknet-node.js
 * Compatible with Bitburner 3.0 API.
 */

import { solvePassword, getDictionaryCandidates, getModelName, getPermutations, rememberPassword } from 'darknet-solver.js';

const LOOP_SLEEP   = 15_000;
const NODE_SCRIPTS = ['darknet-node.js', 'darknet-solver.js', 'darknet-actions.js', 'darknet-auth.js', 'darknet-stasis.js', 'darknet-unstasis.js'];

// ─── Special server lists ─────────────────────────────────────────────────────

// Labyrinth server: do NOT auth or spread into, but DO stasis-link neighbors
const LAB_HOSTNAMES = ['m3rc1l3ss_l4byr1nth', 'ub3r_l4byr1nth', 'et3rn4l_l4byr1nth'];
const LAB_MODELS    = ['(The Labyrinth)', 'th3_l4byr1nth', 'et3rn4l_l4byr1nth', 'ub3r_l4byr1nth'];

// Red pill keywords — stasis-link immediately if any adjacent server has these
const RED_PILL_KEYWORDS = ['redpill', 'red_pill', 'the_red_pill', 'red-pill'];

function isLabServer(hostname, modelId) {
    return LAB_HOSTNAMES.includes(hostname) || LAB_MODELS.includes(modelId);
}

function hasRedPill(ns, hostname) {
    try {
        const files = ns.ls(hostname);
        return files.some(f => RED_PILL_KEYWORDS.some(kw => f.toLowerCase().includes(kw)));
    } catch { return false; }
}

function detailsHaveRedPill(details) {
    // Only check modelId — hints/data are too noisy for substring matching
    if (!details) return false;
    const modelId = (details.modelId ?? '').toLowerCase();
    return RED_PILL_KEYWORDS.some(kw => modelId.includes(kw));
}

// Score a linked server's strategic value — higher = keep, lower = evict first
function stasisScore(hostname) {
    if (LAB_HOSTNAMES.includes(hostname)) return 500;
    return 0;
}

// ─── Password store ───────────────────────────────────────────────────────────

function pwFile(host)               { return `dnet-pw-${host}.txt`; }
function savePassword(ns, host, pw, modelId) {
    try { ns.write(pwFile(host), pw, 'w'); } catch {}
    try { ns.scp(pwFile(host), 'home'); } catch {}
    rememberPassword(ns, modelId, pw, host);
}
function loadPassword(ns, host) {
    try { const r = ns.read(pwFile(host)); return r && r !== '' ? r : null; } catch { return null; }
}

// ─── Quick auth ───────────────────────────────────────────────────────────────

async function quickAuth(ns, hostname, details) {
    const modelId = details.modelId;
    const hint    = details.passwordHint ?? '';
    const data    = details.data ?? '';

    const direct = solvePassword(details);
    if (direct !== null) {
        try {
            const r = await ns.dnet.authenticate(hostname, direct);
            if (r.success) { savePassword(ns, hostname, direct, modelId); return true; }
        } catch {}
    }

    const candidates = getDictionaryCandidates(modelId);
    if (candidates) {
        for (const word of candidates) {
            try {
                const r = await ns.dnet.authenticate(hostname, word);
                if (r.success) { savePassword(ns, hostname, word, modelId); return true; }
            } catch {}
            await ns.sleep(25);
        }
    }

    if (modelId === 'PHP 5.4' && data && data.length <= 6) {
        for (const perm of getPermutations(data)) {
            try {
                const r = await ns.dnet.authenticate(hostname, perm);
                if (r.success) { savePassword(ns, hostname, perm, modelId); return true; }
            } catch {}
            await ns.sleep(20);
        }
    }

    if (modelId === 'AccountsManager_4.2') {
        const m   = hint.match(/0 and (\d+)/);
        const max = m ? Math.min(parseInt(m[1]), 500) : 500;
        for (let i = 0; i <= max; i++) {
            try {
                const r = await ns.dnet.authenticate(hostname, String(i));
                if (r.success) { savePassword(ns, hostname, String(i), modelId); return true; }
            } catch {}
            await ns.sleep(20);
        }
    }

    return false;
}

// ─── Stasis helpers ───────────────────────────────────────────────────────────

// Try to claim a stasis slot for `host`. If no slots are free, evict the
// lowest-scoring currently linked server — but only if it scores lower than us.
function claimStasisSlot(ns, host, linked, limit, reason) {
    if (linked.includes(host)) return;           // already linked
    if (ns.isRunning('darknet-stasis.js', host)) return; // in progress

    if (linked.length < limit) {
        ns.exec('darknet-stasis.js', host, { preventDuplicates: true });
        ns.tprint(`🔗 Stasis claim: ${host} (${reason})`);
        return;
    }

    // No free slots — find lowest-scoring linked server to evict
    const myScore = stasisScore(host);
    const victim  = linked
        .filter(l => l !== host)
        .map(l => ({ host: l, score: stasisScore(l) }))
        .sort((a, b) => a.score - b.score)
        .find(e => e.score < myScore);

    if (victim) {
        ns.tprint(`♻ Evicting ${victim.host} (score ${victim.score}) → ${host} (score ${myScore}, ${reason})`);
        try { ns.exec('darknet-unstasis.js', victim.host, { preventDuplicates: true }); } catch {}
        // Slot will be claimed next loop once freed
    } else {
        ns.print(`⚠ No evictable slot for ${host} — all linked have equal or higher priority`);
    }
}

// ─── Main ─────────────────────────────────────────────────────────────────────

/** @param {NS} ns */
export async function main(ns) {
    ns.disableLog('ALL');

    const host = ns.getHostname();
    if (host === 'darkweb') {
        ns.ui.openTail();
        ns.ui.setTailTitle(`🕸 darknet-node: root`);
    }
    ns.print(`🕸 node on ${host}`);

    // Launch local actions worker once on startup
    if (!ns.isRunning('darknet-actions.js', host)) {
        if (ns.fileExists('darknet-actions.js', host)) {
            ns.exec('darknet-actions.js', host, { preventDuplicates: true });
        }
    }

    // NOTE: No greedy self-stasis on startup.
    // Stasis decisions happen each loop based on strategic position only.

    while (true) {
        const nearby = ns.dnet.probe();
        ns.print(`🔍 ${host}: ${nearby.length} adjacent`);

        // ── Stasis state ───────────────────────────────────────────────────
        const linked      = ns.dnet.getStasisLinkedServers?.() ?? [];
        const limit       = ns.dnet.getStasisLinkLimit?.()    ?? 0;
        const iAmLinked   = linked.includes(host);

        const labAdjacent = nearby.some(t => {
            try {
                const d = ns.dnet.getServerAuthDetails(t);
                return isLabServer(t, d?.modelId);
            } catch { return false; }
        });

        // Red pill: any adjacent server has red pill files or hints
        const redPillAdjacent = nearby.some(t => {
            try {
                const d = ns.dnet.getServerAuthDetails(t);
                return hasRedPill(ns, t) || detailsHaveRedPill(d);
            } catch { return false; }
        });

        // ── Priority 1: red pill adjacent ─────────────────────────────────
        if (redPillAdjacent) {
            if (iAmLinked) {
                ns.print(`🔴 ${host} secured — red pill adjacent!`);
            } else {
                ns.tprint(`🔴 RED PILL DETECTED adjacent to ${host} — claiming stasis!`);
                claimStasisSlot(ns, host, linked, limit, 'red-pill-adjacent');
            }
        }

        // ── Priority 2: lab-adjacent ───────────────────────────────────────
        if (labAdjacent) {
            if (iAmLinked) {
                ns.print(`🔒 ${host} secured — adjacent to lab`);
            } else {
                claimStasisSlot(ns, host, linked, limit, 'lab-adjacent');
            }
        }

        // Generic nodes do NOT self-stasis — slots reserved for priority servers only.

        // ── Main target loop ───────────────────────────────────────────────
        const heavyAuthTargets = [];

        for (const target of nearby) {
            let details;
            try { details = ns.dnet.getServerAuthDetails(target); } catch { continue; }
            if (!details.isOnline) continue;

            // Skip labyrinth servers — do not auth or spread into them
            if (isLabServer(target, details.modelId)) {
                ns.print(`🌀 Skipping lab server: ${target}`);
                continue;
            }

            // Already have session — ensure node is running there
            if (details.hasSession || details.hasAdminRights) {
                if (!ns.isRunning('darknet-node.js', target)) {
                    try {
                        if (!details.hasSession) {
                            const pw = loadPassword(ns, target);
                            if (pw !== null) ns.dnet.connectToSession(target, pw);
                        }
                        ns.scp(NODE_SCRIPTS, target);
                        ns.exec('darknet-node.js', target, { preventDuplicates: true });
                        ns.print(`📡 Redeployed → ${target}`);
                    } catch (e) { ns.print(`⚠ Redeploy ${target}: ${e}`); }
                }
                continue;
            }

            // Try quick auth first
            ns.print(`🔐 Quick auth: ${target} [${getModelName(details.modelId)}]`);
            const solved = await quickAuth(ns, target, details);

            if (solved) {
                try {
                    ns.scp(NODE_SCRIPTS, target);
                    ns.exec('darknet-node.js', target, { preventDuplicates: true });
                    ns.print(`✅ Spread → ${target}`);
                } catch (e) { ns.print(`⚠ Spread ${target}: ${e}`); }
            } else {
                heavyAuthTargets.push(target);
            }
        }

        // Launch a single auth worker for all targets needing heavy auth
        if (heavyAuthTargets.length > 0 &&
            ns.fileExists('darknet-auth.js', host) &&
            !ns.isRunning('darknet-auth.js', host)) {
            ns.exec('darknet-auth.js', host, 1, ...heavyAuthTargets);
            ns.print(`  → Auth worker: ${heavyAuthTargets.join(', ')}`);
        }

        // ── Post-auth spread check ─────────────────────────────────────────
        for (const target of nearby) {
            let details;
            try { details = ns.dnet.getServerAuthDetails(target); } catch { continue; }
            if (!details.isOnline) continue;
            if (!details.hasAdminRights) continue;
            if (ns.isRunning('darknet-node.js', target)) continue;
            if (isLabServer(target, details.modelId)) continue; // never spread into lab
            try {
                if (!details.hasSession) {
                    const pw = loadPassword(ns, target);
                    if (pw !== null) ns.dnet.connectToSession(target, pw);
                }
                ns.scp(NODE_SCRIPTS, target);
                ns.exec('darknet-node.js', target, { preventDuplicates: true });
                ns.print(`✅ Spread (post-auth) → ${target}`);
            } catch {}
        }

        await ns.sleep(LOOP_SLEEP);
    }
}

export function autocomplete() { return ['--tail']; }