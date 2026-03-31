/**
 * backdoor.js — Auto-backdoor all rooted servers
 *
 * - BFS walks the network to find path to every server
 * - Backdoors any rooted server that hasn't been backdoored yet
 * - Skips servers that require higher hacking level than current
 * - Runs once and exits (or loops on a timer if you prefer)
 * - Has its own tail with live progress
 *
 * Usage: run backdoor.js
 * Compatible with Bitburner 3.0 API.
 */

import { getAllServers } from 'Utils.js';

// ─── Helpers ──────────────────────────────────────────────────────────────────

/**
 * BFS to find the path from 'home' to a target server.
 * Returns array of hostnames to connect through, including target.
 */
function findPath(ns, target) {
    const visited = new Set(['home']);
    const queue   = [['home']];

    while (queue.length > 0) {
        const path = queue.shift();
        const node = path[path.length - 1];

        for (const neighbor of ns.scan(node)) {
            if (visited.has(neighbor)) continue;
            visited.add(neighbor);
            const newPath = [...path, neighbor];
            if (neighbor === target) return newPath;
            queue.push(newPath);
        }
    }
    return null;
}

/**
 * Navigates to a server by connecting through the path,
 * installs backdoor, then returns home.
 */
async function backdoorServer(ns, target) {
    const path = findPath(ns, target);
    if (!path) {
        ns.print(`⚠ Could not find path to ${target}`);
        return false;
    }

    // Connect through each hop (skip 'home', it's the start)
    for (let i = 1; i < path.length; i++) {
        ns.singularity.connect(path[i]);
    }

    await ns.singularity.installBackdoor();

    // Return home
    ns.singularity.connect('home');
    return true;
}

// ─── Main ─────────────────────────────────────────────────────────────────────

/** @param {NS} ns */
export async function main(ns) {
    ns.disableLog('ALL');
    ns.ui.openTail();
    ns.ui.setTailTitle('🔑 Backdoor');

    const player       = ns.getPlayer();
    const hackLevel    = player.skills.hacking;
    const all          = getAllServers(ns);

    // Filter to servers we can backdoor
    const candidates = all.filter(host => {
        const s = ns.getServer(host);
        if (!s.hasAdminRights)       return false; // need root
        if (s.backdoorInstalled)     return false; // already done
        if (s.requiredHackingSkill > hackLevel) return false; // too high
        if (ns.cloud.getServerNames().includes(host)) return false; // skip pservs
        return true;
    });

    ns.print('╔══════════════════════════════════════╗');
    ns.print('║           BACKDOOR STATUS            ║');
    ns.print('╠══════════════════════════════════════╣');
    ns.print(`║  Hack level:  ${String(hackLevel).padEnd(23)}║`);
    ns.print(`║  Candidates:  ${String(candidates.length).padEnd(23)}║`);
    ns.print('╠══════════════════════════════════════╣');

    if (candidates.length === 0) {
        ns.print('║  ✅ All reachable servers backdoored! ║');
        ns.print('╚══════════════════════════════════════╝');
        return;
    }

    let done    = 0;
    let failed  = 0;

    for (const host of candidates) {
        ns.print(`║  ⏳ Backdooring: ${host.padEnd(20)}║`);
        const success = await backdoorServer(ns, host);

        if (success) {
            done++;
            ns.print(`║  ✅ Done: ${host.padEnd(28)}║`);
        } else {
            failed++;
            ns.print(`║  ❌ Failed: ${host.padEnd(26)}║`);
        }
    }

    ns.print('╠══════════════════════════════════════╣');
    ns.print(`║  Completed:  ${String(done).padEnd(24)}║`);
    ns.print(`║  Failed:     ${String(failed).padEnd(24)}║`);
    ns.print('╚══════════════════════════════════════╝');
    ns.print('✅ Backdoor run complete.');
}