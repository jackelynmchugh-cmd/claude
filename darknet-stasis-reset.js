/**
 * darknet-stasis-reset.js — Free all low-priority stasis slots
 *
 * Run this after an augment install or any time the wrong servers
 * have claimed stasis slots. Frees all generic (score 0) linked
 * servers so high-priority nodes (lab/shadow adjacent) can claim them.
 *
 * Usage: run darknet-stasis-reset.js [--dry-run]
 * Compatible with Bitburner 3.0 API.
 */

// Must match the lists in darknet-node.js
const LAB_HOSTNAMES = ['m3rc1l3ss_l4byr1nth'];

function stasisScore(hostname) {
    if (LAB_HOSTNAMES.includes(hostname)) return 500;
    return 0;
}

function scoreLabel(score) {
    if (score >= 500) return '🔒 lab-adjacent';
    return '⬜ generic';
}

/** @param {NS} ns */
export async function main(ns) {
    ns.disableLog('ALL');

    const dryRun = ns.args.includes('--dry-run');
    if (dryRun) ns.tprint('🔍 DRY RUN — no changes will be made');

    const linked = ns.dnet.getStasisLinkedServers?.() ?? [];
    const limit  = ns.dnet.getStasisLinkLimit?.()    ?? 0;

    ns.tprint(`📊 Stasis slots: ${linked.length}/${limit} used`);
    ns.tprint(`─────────────────────────────────`);

    if (linked.length === 0) {
        ns.tprint('Nothing linked — nothing to do.');
        return;
    }

    const keep = [];
    const free = [];

    for (const h of linked) {
        const score = stasisScore(h);
        if (score > 0) keep.push({ host: h, score });
        else           free.push({ host: h, score });
    }

    ns.tprint(`✅ Keeping ${keep.length} high-priority slot(s):`);
    for (const { host, score } of keep) {
        ns.tprint(`   ${scoreLabel(score)}: ${host}`);
    }

    ns.tprint(`🗑 Freeing ${free.length} generic slot(s):`);

    for (const { host } of free) {
        ns.tprint(`   ⬜ ${host}`);
        if (dryRun) continue;

        // Verify we can reach the server
        let details;
        try { details = ns.dnet.getServerAuthDetails(host); } catch (e) {
            ns.tprint(`   ⚠ Can't get details for ${host}: ${e}`);
            continue;
        }

        if (!details?.isOnline) {
            ns.tprint(`   ⚠ ${host} is offline — skipping`);
            continue;
        }

        // Ensure unstasis script is on the target
        if (!ns.fileExists('darknet-unstasis.js', host)) {
            const copied = ns.scp('darknet-unstasis.js', host);
            if (!copied) {
                ns.tprint(`   ⚠ Could not SCP darknet-unstasis.js to ${host}`);
                continue;
            }
            ns.tprint(`   📋 Copied darknet-unstasis.js to ${host}`);
        }

        // Check RAM — darknet-unstasis.js needs ~13.65GB
        const free_ram = ns.getServerMaxRam(host) - ns.getServerUsedRam(host);
        if (free_ram < 2) {
            ns.tprint(`   ⚠ ${host} has only ${free_ram.toFixed(2)}GB free RAM — trying to kill existing scripts`);
            // Kill darknet-stasis.js if it's still running (it should have exited but just in case)
            ns.kill('darknet-stasis.js', host);
            await ns.sleep(500);
        }

        // Exec the unstasis script on the target server
        const pid = ns.exec('darknet-unstasis.js', host, { preventDuplicates: true });
        if (pid > 0) {
            ns.tprint(`   🚀 Launched darknet-unstasis.js on ${host} (PID ${pid})`);
            // Wait for it to finish — it's a one-shot script
            await ns.sleep(2000);

            // Verify it worked
            const afterLinked = ns.dnet.getStasisLinkedServers?.() ?? [];
            if (!afterLinked.includes(host)) {
                ns.tprint(`   ✅ ${host} freed`);
            } else {
                ns.tprint(`   ❌ ${host} still linked after unstasis — may need manual intervention`);
            }
        } else {
            ns.tprint(`   ❌ exec failed on ${host} — RAM: ${(ns.getServerMaxRam(host) - ns.getServerUsedRam(host)).toFixed(2)}GB free`);
            ns.tprint(`      Try manually: connect ${host}; run darknet-unstasis.js`);
        }

        await ns.sleep(500);
    }

    if (!dryRun) {
        const after = ns.dnet.getStasisLinkedServers?.() ?? [];
        ns.tprint(`─────────────────────────────────`);
        ns.tprint(`📊 After reset: ${after.length}/${limit} slots used`);
        if (after.length > 0) ns.tprint(`   Remaining: ${after.join(', ')}`);
        else                  ns.tprint(`   All slots cleared`);
        ns.tprint(`✅ Done — nodes will claim strategic slots on next loop`);
    }
}