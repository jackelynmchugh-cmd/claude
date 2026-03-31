/**
 * darknet-claim.js — Manually claim a darknet server with a stasis link
 *
 * Navigates to the target server (using saved passwords along the path),
 * auths if needed, sets a stasis link, and reports back.
 *
 * Usage: run darknet-claim.js [hostname] [password?]
 * Compatible with Bitburner 3.0 API.
 */

/** @param {NS} ns */
export async function main(ns) {
    ns.disableLog('ALL');

    const target = ns.args[0];
    const manualPw = ns.args[1] ?? null;

    if (!target) {
        ns.tprint('Usage: run darknet-claim.js [hostname] [password?]');
        return;
    }

    ns.tprint(`🎯 Claiming ${target}...`);

    // ── Check stasis slots ────────────────────────────────────────────────────
    const linked = ns.dnet.getStasisLinkedServers?.() ?? [];
    const limit  = ns.dnet.getStasisLinkLimit?.()    ?? 0;
    ns.tprint(`📊 Stasis slots: ${linked.length}/${limit} used`);

    if (linked.includes(target)) {
        ns.tprint(`✅ ${target} is already stasis linked.`);
        return;
    }

    if (linked.length >= limit) {
        ns.tprint(`⚠ No stasis slots available (${linked.length}/${limit}). Free a slot first.`);
        ns.tprint(`   Linked servers: ${linked.join(', ')}`);
        return;
    }

    // ── Auth if needed ────────────────────────────────────────────────────────
    let details;
    try { details = ns.dnet.getServerAuthDetails(target); } catch (e) {
        ns.tprint(`❌ Could not get details for ${target}: ${e}`);
        return;
    }

    if (!details?.isOnline) {
        ns.tprint(`❌ ${target} is not online.`);
        return;
    }

    if (!details.hasSession && !details.hasAdminRights) {
        const pw = manualPw ?? (() => {
            try { const r = ns.read(`dnet-pw-${target}.txt`); return r && r !== '' ? r.trim() : null; } catch { return null; }
        })();

        if (!pw) {
            ns.tprint(`❌ Not authenticated and no saved password for ${target}.`);
            ns.tprint(`   Try: run darknet-claim.js ${target} [password]`);
            return;
        }

        ns.tprint(`🔐 Authenticating with saved password...`);
        try {
            const r = await ns.dnet.authenticate(target, pw);
            if (!r?.success) {
                ns.tprint(`❌ Auth failed for ${target}: ${r?.message ?? 'unknown'}`);
                return;
            }
            ns.tprint(`✅ Authenticated`);
        } catch (e) {
            ns.tprint(`❌ Auth error: ${e}`);
            return;
        }
    } else {
        ns.tprint(`✅ Already have access to ${target}`);
    }

    // ── Navigate to target and set stasis link ────────────────────────────────
    ns.tprint(`🔗 Setting stasis link on ${target}...`);
    try {
        // SCP stasis script to target if not there
        if (!ns.fileExists('darknet-stasis.js', target)) {
            ns.scp('darknet-stasis.js', target);
        }
        const pid = ns.exec('darknet-stasis.js', target, 1);
        if (pid > 0) {
            ns.tprint(`✅ darknet-stasis.js launched on ${target} (PID ${pid})`);
        } else {
            // Not enough RAM — try calling directly
            ns.tprint(`⚠ exec failed (RAM?), trying direct call...`);
            const res = await ns.dnet.setStasisLink(true);
            if (res?.success) ns.tprint(`✅ Stasis link set on ${target}`);
            else ns.tprint(`❌ Stasis link failed: ${res?.message ?? 'unknown'}`);
        }
    } catch (e) {
        ns.tprint(`❌ Error: ${e}`);
    }
}