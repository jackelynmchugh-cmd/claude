/**
 * darknet-recover.js — Re-auth and redeploy to all known darknet servers
 *
 * After a restart or server migration, sessions are lost. This script
 * re-authenticates every server using saved password files, then deploys
 * darknet-node.js to all of them.
 *
 * Must run on darkweb. If run from home it relaunches itself there.
 *
 * Usage: run darknet-recover.js
 * Compatible with Bitburner 3.0 API.
 */

const NODE_SCRIPTS = [
    'darknet-node.js', 'darknet-solver.js', 'darknet-actions.js',
    'darknet-auth.js', 'darknet-stasis.js', 'darknet-unstasis.js',
];
const DARKWEB   = 'darkweb';
const AUTH_DELAY = 50;

function loadPassword(ns, host) {
    try { const r = ns.read(`dnet-pw-${host}.txt`); return r && r !== '' ? r.trim() : null; }
    catch { return null; }
}

// Attempt to auth a server using its saved password
async function tryAuth(ns, host) {
    const pw = loadPassword(ns, host);
    if (!pw) return false;
    try {
        const r = await ns.dnet.authenticate(host, pw);
        return r?.success === true;
    } catch { return false; }
}

/** @param {NS} ns */
export async function main(ns) {
    ns.disableLog('ALL');

    // Relaunch on darkweb if running from home
    if (ns.getHostname() !== DARKWEB) {
        ns.tprint('📡 Relaunching on darkweb...');
        ns.scp('darknet-recover.js', DARKWEB, 'home');
        const pid = ns.exec('darknet-recover.js', DARKWEB, 1);
        if (pid > 0) ns.tprint(`✅ Launched on darkweb (PID ${pid})`);
        else ns.tprint(`❌ Launch failed — check RAM on darkweb`);
        return;
    }

    ns.tprint('🔄 Darknet recovery starting...');

    // Restore all password files from home
    const pwFiles = ns.ls('home').filter(f => f.startsWith('dnet-pw-') || f === 'dnet-passwords.txt');
    for (const f of pwFiles) { try { ns.scp(f, DARKWEB, 'home'); } catch {} }
    ns.tprint(`  🔑 Restored ${pwFiles.length} password files`);

    // Build list of all hosts we have passwords for
    const knownHosts = pwFiles
        .filter(f => f.startsWith('dnet-pw-') && f.endsWith('.txt'))
        .map(f => f.replace('dnet-pw-', '').replace('.txt', ''))
        .filter(h => h.length > 0 && h !== DARKWEB);

    ns.tprint(`  📋 Found passwords for ${knownHosts.length} hosts`);

    // BFS from darkweb — probe, auth each adjacent server, expand outward
    const visited = new Set([DARKWEB]);
    const queue   = [DARKWEB];
    const authed  = [];
    const failed  = [];

    while (queue.length > 0) {
        const current = queue.shift();

        // Probe adjacent servers
        let adjacent = [];
        try { adjacent = ns.dnet.probe(); }
        catch { continue; }

        for (const host of adjacent) {
            if (visited.has(host)) continue;
            visited.add(host);

            let details;
            try { details = ns.dnet.getServerAuthDetails(host); } catch { continue; }
            if (!details?.isOnline) continue;

            const alreadyAuthed = details.hasSession || details.hasAdminRights;

            if (!alreadyAuthed) {
                // Try to re-authenticate using saved password
                const ok = await tryAuth(ns, host);
                if (!ok) {
                    failed.push(host);
                    ns.print(`  ❌ Auth failed: ${host}`);
                    continue;
                }
                ns.print(`  🔓 Re-authed: ${host}`);
            }

            authed.push(host);

            // SCP password files + scripts
            for (const f of pwFiles) { try { ns.scp(f, host, 'home'); } catch {} }
            ns.scp(NODE_SCRIPTS, host, DARKWEB);

            // Navigate into this server to probe its neighbors
            const pw = loadPassword(ns, host);
            if (pw) {
                try {
                    await ns.dnet.connectToSession(host, pw);
                    queue.push(host); // will probe from here next iteration
                    await ns.sleep(100);
                    // Navigate back to current before next probe
                    // (we re-navigate per queue entry via path tracking below)
                } catch { ns.print(`  ⚠ Nav failed: ${host}`); }
                // Return to darkweb for next iteration
                try { await ns.dnet.connectToSession(DARKWEB, loadPassword(ns, DARKWEB) ?? ''); } catch {}
            }

            await ns.sleep(AUTH_DELAY);
        }
    }

    // Also auth any known hosts we didn't reach via BFS (disconnected after migration)
    ns.tprint(`\n  📡 Checking ${knownHosts.length} known hosts not yet visited...`);
    for (const host of knownHosts) {
        if (visited.has(host)) continue;

        let details;
        try { details = ns.dnet.getServerAuthDetails(host); } catch { continue; }
        if (!details?.isOnline) { ns.print(`  💤 Offline: ${host}`); continue; }
        if (!details?.isConnectedToCurrentServer) { ns.print(`  📍 Not adjacent: ${host} (migrated away)`); continue; }

        const ok = await tryAuth(ns, host);
        if (ok) {
            authed.push(host);
            ns.scp(NODE_SCRIPTS, host, DARKWEB);
            ns.print(`  🔓 Re-authed (direct): ${host}`);
        } else {
            failed.push(host);
        }
        await ns.sleep(AUTH_DELAY);
    }

    ns.tprint(`\n📊 Recovery scan complete:`);
    ns.tprint(`  ✅ Re-authed: ${authed.length}`);
    ns.tprint(`  ❌ Failed: ${failed.length}`);
    ns.tprint(`  📡 Total visited: ${visited.size}`);

    // Deploy nodes to all authed servers
    ns.tprint(`\n🚀 Deploying nodes...`);
    let deployed = 0, skipped = 0, deployFailed = 0;

    for (const host of authed) {
        if (ns.isRunning('darknet-node.js', host)) {
            skipped++;
            continue;
        }
        const pid = ns.exec('darknet-node.js', host, 1);
        if (pid > 0) {
            ns.print(`  ✅ → ${host} (PID ${pid})`);
            deployed++;
        } else {
            ns.print(`  ⚠ RAM issue: ${host} (${ns.getServerMaxRam(host) - ns.getServerUsedRam(host)}GB free)`);
            deployFailed++;
        }
        await ns.sleep(50);
    }

    ns.tprint(`\n✅ Done — deployed:${deployed} skipped:${skipped} failed:${deployFailed}`);

    if (failed.length > 0) {
        ns.tprint(`\n⚠ Could not re-auth ${failed.length} servers (passwords may be stale):`);
        failed.slice(0, 10).forEach(h => ns.tprint(`  → ${h}`));
        if (failed.length > 10) ns.tprint(`  ... and ${failed.length - 10} more`);
    }
}