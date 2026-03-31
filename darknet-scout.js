/**
 * darknet-scout.js — Darknet graph crawler / red pill finder
 *
 * BFS crawls the entire darknet by actually connecting into each server
 * to probe its neighbors, then moving back up the path.
 * Auths into servers only when needed to probe deeper.
 * Prints a full report of every server found.
 *
 * Usage: run darknet-scout.js
 * Compatible with Bitburner 3.0 API.
 */

import { solvePassword, getDictionaryCandidates, getPermutations, getModelName } from 'darknet-solver.js';

const PROBE_DELAY = 200;
const AUTH_DELAY  = 50;

const INTERESTING_KEYWORDS = [
    'red','pill','matrix','choice','truth','wake','real','rabbit',
    'hole','morpheus','oracle','zion','special','secret',
    'hidden','rare','unique','anomaly','glitch','override',
    'forbidden','restricted','classified','artifact','item','object',
];

const HEAVY_AUTH_MODELS = new Set([
    'NIL','DeepGreen','2G_cellular','OpenWebAccessPoint','th3_l4byr1nth',
    'CloudBlare(tm)',
]);

function isInteresting(str) {
    if (!str) return false;
    const lower = str.toLowerCase();
    return INTERESTING_KEYWORDS.some(kw => lower.includes(kw));
}

function sep(n = 60) { return '─'.repeat(n); }

// ─── Quick auth ───────────────────────────────────────────────────────────────

async function quickAuth(ns, hostname, details) {
    const hint  = details.passwordHint     ?? '';
    const data  = details.data ?? '';
    const model = details.modelId;

    const direct = solvePassword(details);
    if (direct !== null) {
        try { const r = await ns.dnet.authenticate(hostname, direct); if (r?.success) return direct; } catch {}
    }

    const candidates = getDictionaryCandidates(model);
    if (candidates) {
        for (const word of candidates) {
            try { const r = await ns.dnet.authenticate(hostname, word); if (r?.success) return word; } catch {}
            await ns.sleep(AUTH_DELAY);
        }
    }

    if (model === 'PHP 5.4' && data && data.length <= 6) {
        for (const perm of getPermutations(data)) {
            try { const r = await ns.dnet.authenticate(hostname, perm); if (r?.success) return perm; } catch {}
            await ns.sleep(AUTH_DELAY);
        }
    }

    if (model === 'AccountsManager_4.2') {
        const m   = hint.match(/0 and (\d+)/);
        const max = m ? Math.min(parseInt(m[1]), 500) : 500;
        for (let i = 0; i <= max; i++) {
            try { const r = await ns.dnet.authenticate(hostname, String(i)); if (r?.success) return String(i); } catch {}
            await ns.sleep(AUTH_DELAY);
        }
    }

    return null;
}

// ─── Load saved password ──────────────────────────────────────────────────────

function loadPassword(ns, host) {
    try { const r = ns.read(`dnet-pw-${host}.txt`); return r && r !== '' ? r.trim() : null; } catch { return null; }
}

// ─── Main ─────────────────────────────────────────────────────────────────────

/** @param {NS} ns */
export async function main(ns) {
    ns.disableLog('ALL');
    ns.ui.openTail();
    ns.ui.setTailTitle('🔴 Darknet Scout');

    const startHost = ns.getHostname();

    // BFS state
    // Each queue entry: { host, path: [host, ...] } — path is how we got here
    const visited = new Set([startHost]);
    const queue   = [{ host: startHost, path: [] }];
    const found   = [];
    const flagged = [];

    ns.print(sep());
    ns.print(`  🔴 DARKNET SCOUT`);
    ns.print(`  Start: ${startHost}`);
    ns.print(sep());

    while (queue.length > 0) {
        const { host: current, path } = queue.shift();

        // ── Navigate to current ────────────────────────────────────────────
        let navOk = true;
        for (const hop of path) {
            try {
                const pw = loadPassword(ns, hop);
                if (pw) {
                    await ns.dnet.connectToSession(hop, pw);
                } else {
                    // No saved password — check if we have active session anyway
                    // and try connecting with empty string (some models allow it)
                    const d = ns.dnet.getServerAuthDetails(hop);
                    if (d?.hasSession || d?.hasAdminRights) {
                        await ns.dnet.connectToSession(hop, '');
                    } else {
                        ns.print(`  ⚠ No saved pw for ${hop} — nav blocked`);
                        navOk = false;
                        break;
                    }
                }
            } catch (e) {
                ns.print(`  ⚠ Nav failed at ${hop}: ${e}`);
                navOk = false;
                break;
            }
        }

        if (!navOk) {
            // Return home before trying next
            try { await ns.dnet.connectToSession(startHost); } catch {}
            continue;
        }

        // ── Probe from current ─────────────────────────────────────────────
        let adjacent = [];
        try { adjacent = ns.dnet.probe(); } catch (e) {
            ns.print(`  ⚠ Probe failed on ${current}: ${e}`);
        }

        ns.print(`📍 ${current} — ${adjacent.length} adjacent`);

        for (const host of adjacent) {
            if (visited.has(host)) continue;

            let details;
            try { details = ns.dnet.getServerAuthDetails(host); } catch { continue; }
            if (!details?.isOnline) continue;

            const modelName = getModelName(details.modelId);
            const hint      = details.passwordHint     ?? '';
            const hintData  = details.data ?? '';
            const hasAccess = details.hasSession || details.hasAdminRights;

            // Check for interesting flags
            const flags = [];
            if (isInteresting(host))            flags.push('hostname');
            if (isInteresting(details.modelId)) flags.push('model');
            if (isInteresting(modelName))       flags.push('model-name');
            if (isInteresting(hint))            flags.push('hint');
            if (isInteresting(hintData))        flags.push('data');

            // Check files if we already have access
            let files = [];
            if (hasAccess) {
                try {
                    files = ns.ls(host);
                    files.forEach(f => { if (isInteresting(f)) flags.push(`file:${f}`); });
                } catch {}
            }

            const record = { host, modelId: details.modelId, modelName, hint, hintData, hasAccess, files, flags };
            found.push(record);
            if (flags.length > 0) flagged.push(record);

            // Log it
            const flagStr   = flags.length > 0 ? ` 🚩[${flags.join(',')}]` : '';
            const accessStr = hasAccess ? '🔓' : '🔒';
            ns.print(`  ${accessStr} ${host} | ${modelName}${flagStr}`);
            if (hint)             ns.print(`       hint: ${hint}`);
            if (hintData)         ns.print(`       data: ${hintData}`);
            if (files.length > 0) ns.print(`       files: ${files.join(', ')}`);

            // ── Try to get access so we can go deeper ──────────────────────
            let canGoDeeper = hasAccess;

            if (!hasAccess) {
                // Re-check live — manual auth may have happened since probe
                try {
                    const live = ns.dnet.getServerAuthDetails(host);
                    if (live?.hasSession || live?.hasAdminRights) {
                        ns.print(`       🔑 Manual auth detected`);
                        canGoDeeper = true;
                        record.hasAccess = true;
                    }
                } catch {}
            }

            if (!canGoDeeper) {
                // Check saved password file
                const savedPw = loadPassword(ns, host);
                if (savedPw) {
                    try {
                        const r = await ns.dnet.authenticate(host, savedPw);
                        if (r?.success) {
                            ns.print(`       🔑 Used saved password`);
                            canGoDeeper = true;
                            record.hasAccess = true;
                            record.password  = savedPw;
                        }
                    } catch {}
                }
            }

            // Try quick auth if still no access
            if (!canGoDeeper) {
                    const needsHeavy = HEAVY_AUTH_MODELS.has(details.modelId);
                    if (!needsHeavy) {
                        ns.print(`       🔐 Quick auth...`);
                        const pw = await quickAuth(ns, host, details);
                        if (pw !== null) {
                            ns.print(`       ✅ Authed: "${pw}"`);
                            try { ns.write(`dnet-pw-${host}.txt`, pw, 'w'); } catch {}
                            canGoDeeper = true;
                            record.hasAccess = true;
                            record.password  = pw;
                        }
                    }

                    // Hand off to heavy auth if: model requires it, OR quick auth failed
                    // and the model might benefit from heartbleed/packet (most do)
                    if (!canGoDeeper) {
                        const authScript = 'darknet-auth.js';
                        const homeHost   = 'home';
                        if (ns.fileExists(authScript, homeHost) &&
                            !ns.isRunning(authScript, homeHost, host)) {
                            ns.print(`       🔐 Launching heavy auth for ${host}...`);
                            ns.exec(authScript, homeHost, 1, host);
                        }

                        // Poll until password file appears or auth script finishes
                        const WAIT_POLL    = 3_000;
                        const WAIT_TIMEOUT = 120_000;
                        const deadline     = Date.now() + WAIT_TIMEOUT;
                        ns.print(`       ⏳ Waiting for auth (up to ${WAIT_TIMEOUT/1000}s)...`);

                        while (Date.now() < deadline) {
                            await ns.sleep(WAIT_POLL);

                            // Check if password file was written
                            const pw = loadPassword(ns, host);
                            if (pw) {
                                try {
                                    const r = await ns.dnet.authenticate(host, pw);
                                    if (r?.success) {
                                        ns.print(`       ✅ Heavy auth cracked: "${pw}"`);
                                        canGoDeeper = true;
                                        record.hasAccess = true;
                                        record.password  = pw;
                                        break;
                                    }
                                } catch {}
                            }

                            // Also check if server just got authed directly
                            try {
                                const d = ns.dnet.getServerAuthDetails(host);
                                if (d?.hasSession || d?.hasAdminRights) {
                                    ns.print(`       ✅ Server authed`);
                                    canGoDeeper = true;
                                    record.hasAccess = true;
                                    break;
                                }
                            } catch {}

                            // Stop waiting if auth script finished without cracking
                            if (!ns.isRunning(authScript, homeHost, host)) {
                                ns.print(`       ❌ Auth script finished without cracking ${host}`);
                                break;
                            }
                        }

                        if (!canGoDeeper) ns.print(`       ❌ Heavy auth failed or timed out`);
                    }
                }

            // Re-check files if we just gained access
            if (canGoDeeper && record.files.length === 0) {
                try {
                    record.files = ns.ls(host);
                    record.files.forEach(f => {
                        if (isInteresting(f) && !flags.includes(`file:${f}`)) {
                            flags.push(`file:${f}`);
                            if (!flagged.includes(record)) flagged.push(record);
                        }
                    });
                    if (record.files.length > 0)
                        ns.print(`       files: ${record.files.join(', ')}`);
                } catch {}
            }

            if (canGoDeeper) {
                visited.add(host);
                queue.push({ host, path: [...path, host] });
            }

            await ns.sleep(PROBE_DELAY);
        }

        // ── Return to start after each node ───────────────────────────────
        try { await ns.dnet.connectToSession(startHost); } catch {}
    }

    // ── Final report ──────────────────────────────────────────────────────────
    ns.print(`\n${sep()}`);
    ns.print(`  📊 SCOUT COMPLETE — ${found.length} servers mapped`);
    ns.print(sep());

    if (flagged.length === 0) {
        ns.print(`  Nothing flagged. Red pill may be behind heavy-auth nodes.`);
        ns.print(`  Blocked servers need: run darknet-auth.js [host]`);
    } else {
        ns.print(`  🚩 FLAGGED (${flagged.length}):`);
        for (const r of flagged) {
            ns.print(`  ${sep(40)}`);
            ns.print(`  Host:  ${r.host}`);
            ns.print(`  Model: ${r.modelName} (${r.modelId})`);
            if (r.hint)          ns.print(`  Hint:  ${r.hint}`);
            if (r.hintData)      ns.print(`  Data:  ${r.hintData}`);
            if (r.files?.length) ns.print(`  Files: ${r.files.join(', ')}`);
            ns.print(`  Flags: ${r.flags.join(', ')}`);
            if (r.password)      ns.print(`  Pass:  ${r.password}`);
        }
    }

    ns.print(sep());
    ns.tprint(`🔴 Scout done — ${found.length} mapped, ${flagged.length} flagged.`);
}