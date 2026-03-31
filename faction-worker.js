/**
 * faction-worker.js — Automatic faction work manager
 * Rotates between factions based on missing aug priority,
 * auto-joins invited factions, travels for city factions,
 * respects manual overrides and activity lock
 *
 * Usage: run faction-worker.js
 */

/** @param {NS} ns */
export async function main(ns) {
    ns.disableLog('ALL');
    ns.ui.openTail();
    ns.ui.setTailTitle('🏛 Faction Worker');

    const LOOP_MS          = 5_000;
    const ROTATE_MS        = 5 * 60 * 1000; // switch faction every 5 min
    const ACTIVITY_PORT    = 1;
    const MANUAL_FILE      = 'faction-worker-manual.txt';

    // factions that require specific cities
    const CITY_FACTIONS = {
        'Tian Di Hui':    'Chongqing',
        'The Syndicate':  'Aevum',
        'Tetrads':        'Ishima',
        'NiteSec':        'Aevum',
        'The Black Hand': 'Volhaven',
        'Silhouette':     'Sector-12',
        'Bachman & Associates': 'Aevum',
        'Clarke Incorporated':  'Aevum',
        'OmniTek Incorporated': 'Volhaven',
        'Four Sigma':           'Sector-12',
        'KuaiGong International': 'Chongqing',
    };

    // best work type per faction category
    // returns the work type string the API accepts
    function getBestWorkType(faction, player) {
        // hacking factions
        const hackFactions = [
            'CyberSec','NiteSec','The Black Hand','BitRunners',
            'Daedalus','Illuminati','ECorp','MegaCorp','Blade Industries',
            'NWO','Clarke Incorporated','OmniTek Incorporated','Four Sigma',
            'KuaiGong International','Fulcrum Secret Technologies',
        ];
        // combat/crime factions
        const combatFactions = [
            'Slum Snakes','Tetrads','Speakers for the Dead',
            'The Dark Army','The Syndicate','Silhouette',
            'Tian Di Hui','The Covenant',
        ];

        const hk = player.skills.hacking;
        const cb = Math.min(
            player.skills.strength, player.skills.defense,
            player.skills.dexterity, player.skills.agility
        );

        if (hackFactions.includes(faction)) return 'hacking';
        if (combatFactions.includes(faction)) {
            // pick field work vs security based on stats
            return cb >= hk ? 'field work' : 'security work';
        }
        // default — try hacking first, fall back to field work
        return hk >= 500 ? 'hacking' : 'field work';
    }

    // ─── Color helpers ────────────────────────────────────────────────────────
    const C = {
        reset:   '\x1b[0m', bold:    '\x1b[1m', dim:     '\x1b[2m',
        red:     '\x1b[31m', green:   '\x1b[32m', yellow:  '\x1b[33m',
        cyan:    '\x1b[36m', white:   '\x1b[37m', bred:    '\x1b[91m',
        bgreen:  '\x1b[92m', byellow: '\x1b[93m', bcyan:   '\x1b[96m',
        bwhite:  '\x1b[97m',
    };

    const col     = (c, t) => `${c}${t}${C.reset}`;
    const bold    = (t)    => `${C.bold}${t}${C.reset}`;
    const dim     = (t)    => col(C.dim, t);
    const header  = (t)    => col(C.bcyan, bold(t));
    const divider = (n=60) => col(C.dim, '─'.repeat(n));
    const label   = (t)    => col(C.cyan, t);

    const fmt = (n) => {
        if (Math.abs(n) >= 1e12) return `$${(n/1e12).toFixed(2)}t`;
        if (Math.abs(n) >= 1e9)  return `$${(n/1e9).toFixed(2)}b`;
        if (Math.abs(n) >= 1e6)  return `$${(n/1e6).toFixed(2)}m`;
        if (Math.abs(n) >= 1e3)  return `$${(n/1e3).toFixed(2)}k`;
        return `$${n.toFixed(0)}`;
    };

    const fmtRep = (n) => {
        if (n >= 1e6) return `${(n/1e6).toFixed(2)}m`;
        if (n >= 1e3) return `${(n/1e3).toFixed(1)}k`;
        return n.toFixed(0);
    };

    const fmtTime = (s) => {
        if (!isFinite(s) || s <= 0) return '?';
        if (s < 60)    return `${s.toFixed(0)}s`;
        if (s < 3600)  return `${(s/60).toFixed(1)}m`;
        if (s < 86400) return `${(s/3600).toFixed(1)}h`;
        return `${(s/86400).toFixed(1)}d`;
    };

    // ─── Activity lock ────────────────────────────────────────────────────────
    function isActivityLocked() {
        try {
            const data = ns.peek(ACTIVITY_PORT);
            if (data === 'NULL PORT DATA') return false;
            return JSON.parse(data)?.reason === 'grafting';
        } catch { return false; }
    }

    // ─── Manual override ──────────────────────────────────────────────────────
    // write faction name to file to lock worker to that faction
    // write 'auto' or delete file to resume auto mode
    let manualFaction = null;

    function loadManualOverride() {
        try {
            const raw = ns.read(MANUAL_FILE);
            if (!raw || raw.trim() === '' || raw.trim().toLowerCase() === 'auto') {
                manualFaction = null;
            } else {
                manualFaction = raw.trim();
            }
        } catch { manualFaction = null; }
    }

    // ─── Aug catalog from augment manager ────────────────────────────────────
    // build list of factions we need rep from and how much
    function buildRepTargets(factions, ownedAugs) {
        const ownedSet = new Set(ownedAugs);
        const targets  = {}; // faction → { needed: repReq, current: rep, augs: [] }

        for (const faction of factions) {
            let factionAugs;
            try { factionAugs = ns.singularity.getAugmentationsFromFaction(faction); }
            catch { continue; }

            const rep = ns.singularity.getFactionRep(faction);

            for (const aug of factionAugs) {
                if (ownedSet.has(aug)) continue;
                let repReq;
                try { repReq = ns.singularity.getAugmentationRepReq(aug); }
                catch { continue; }

                if (rep >= repReq) continue; // already have rep

                if (!targets[faction]) {
                    targets[faction] = {
                        faction,
                        rep,
                        augs: [],
                        nextAugRep: repReq,
                        nextAugName: aug,
                    };
                }

                targets[faction].augs.push({ name: aug, repReq });

                // track the closest aug threshold
                if (repReq < targets[faction].nextAugRep) {
                    targets[faction].nextAugRep  = repReq;
                    targets[faction].nextAugName = aug;
                }
            }
        }

        // sort augs within each faction by rep requirement
        for (const t of Object.values(targets)) {
            t.augs.sort((a, b) => a.repReq - b.repReq);
            t.repGap = t.nextAugRep - t.rep;
            t.pct    = Math.min(100, (t.rep / t.nextAugRep * 100));
        }

        return Object.values(targets);
    }

    // ─── Rep rate tracking ────────────────────────────────────────────────────
    const repHistory = {}; // faction → [{ rep, time }]

    function sampleRep(faction) {
        try {
            const rep = ns.singularity.getFactionRep(faction);
            if (!repHistory[faction]) repHistory[faction] = [];
            repHistory[faction].push({ rep, time: Date.now() });
            // keep last 12 samples (1 min at 5s intervals)
            if (repHistory[faction].length > 12) repHistory[faction].shift();
        } catch { }
    }

    function getRepRate(faction) {
        const h = repHistory[faction];
        if (!h || h.length < 2) return 0;
        const oldest = h[0];
        const newest = h[h.length - 1];
        const deltaRep  = newest.rep  - oldest.rep;
        const deltaTime = (newest.time - oldest.time) / 1000; // seconds
        return deltaTime > 0 ? (deltaRep / deltaTime) * 3600 : 0; // per hour
    }

    // ─── Faction invite handling ──────────────────────────────────────────────
    function handleInvites() {
        const joined = [];
        try {
            const invites = ns.singularity.checkFactionInvitations();
            for (const faction of invites) {
                // skip gang factions — joining them manually is better
                const gangFactions = [
                    'Slum Snakes','Tetrads','The Syndicate','The Dark Army',
                    'NiteSec','The Black Hand','Speakers for the Dead',
                ];
                if (gangFactions.includes(faction)) continue;
                if (ns.singularity.joinFaction(faction)) {
                    joined.push(faction);
                }
            }
        } catch { }
        return joined;
    }

    // ─── City travel ─────────────────────────────────────────────────────────
    function travelIfNeeded(faction) {
        const city = CITY_FACTIONS[faction];
        if (!city) return true; // no travel needed
        try {
            const player = ns.getPlayer();
            if (player.city === city) return true;
            const success = ns.singularity.travelToCity(city);
            return success;
        } catch { return false; }
    }

    // ─── Work for faction ─────────────────────────────────────────────────────
    function startWork(faction, workType) {
        try {
            // check if already working for this faction with this type
            const current = ns.singularity.getCurrentWork();
            if (current?.type === 'FACTION' &&
                current?.factionName === faction) return true;

            return ns.singularity.workForFaction(faction, workType, false);
        } catch { return false; }
    }

    // ─── Priority queue ───────────────────────────────────────────────────────
    // sorts factions by closest aug threshold (smallest rep gap first)
    // rotates through them every ROTATE_MS
    let priorityQueue   = [];
    let queueIndex      = 0;
    let lastRotate      = 0;
    let currentFaction  = null;
    let currentWorkType = null;
    let lastJoined      = [];
    let cycle           = 0;
    let pausedReason    = null;

    // ─── Main loop ────────────────────────────────────────────────────────────
    while (true) {
        cycle++;
        const now    = Date.now();
        const player = ns.getPlayer();
        const factions = player.factions ?? [];

        loadManualOverride();

        // handle invites every cycle
        lastJoined = handleInvites();

        // get owned augs
        let ownedAugs = [];
        try { ownedAugs = ns.singularity.getOwnedAugmentations(true); } catch { }

        // build rep targets
        const targets = buildRepTargets(factions, ownedAugs);

        // sample rep for all target factions
        for (const t of targets) sampleRep(t.faction);
        if (currentFaction) sampleRep(currentFaction);

        // ── Pause check ───────────────────────────────────────────────────────
        const locked = isActivityLocked();
        if (locked) {
            pausedReason = 'grafting';
            // stop current work
            try { ns.singularity.stopAction(); } catch { }
        } else {
            pausedReason = null;
        }

        // ── Manual override ───────────────────────────────────────────────────
        if (!locked) {
            if (manualFaction) {
                // manual mode — work for specified faction
                if (currentFaction !== manualFaction) {
                    const workType = getBestWorkType(manualFaction, player);
                    travelIfNeeded(manualFaction);
                    if (startWork(manualFaction, workType)) {
                        currentFaction  = manualFaction;
                        currentWorkType = workType;
                    }
                }
            } else {
                // auto mode — rotate through priority queue
                const shouldRotate = now - lastRotate >= ROTATE_MS || priorityQueue.length === 0;

                if (shouldRotate) {
                    // rebuild priority queue sorted by rep gap (closest first)
                    priorityQueue = [...targets]
                        .filter(t => t.repGap > 0)
                        .sort((a, b) => a.repGap - b.repGap);
                    queueIndex = (queueIndex + 1) % Math.max(1, priorityQueue.length);
                    lastRotate = now;
                }

                const target = priorityQueue[queueIndex % Math.max(1, priorityQueue.length)];

                if (target && currentFaction !== target.faction) {
                    const workType = getBestWorkType(target.faction, player);
                    travelIfNeeded(target.faction);
                    if (startWork(target.faction, workType)) {
                        currentFaction  = target.faction;
                        currentWorkType = workType;
                    }
                }
            }
        }

        // ── Display ───────────────────────────────────────────────────────────
        ns.clearLog();

        ns.print(`${header('🏛 FACTION WORKER')}  ${dim(`Cycle: ${cycle}`)}`);
        ns.print(divider());

        // status
        if (pausedReason) {
            ns.print(`  ${col(C.bred, `🔒 PAUSED — ${pausedReason}`)}`);
        } else if (manualFaction) {
            ns.print(`  ${label('Mode:')}    ${col(C.byellow, '🖐 MANUAL')}  ${col(C.bwhite, manualFaction)}`);
            ns.print(`  ${dim(`To return to auto: ns.write('${MANUAL_FILE}', 'auto', 'w')`)}`);
        } else {
            ns.print(`  ${label('Mode:')}    ${col(C.bgreen, '🤖 AUTO')}`);
        }

        if (currentFaction && !pausedReason) {
            const timeUntilRotate = Math.max(0, ROTATE_MS - (now - lastRotate));
            ns.print(`  ${label('Working:')} ${col(C.bwhite, currentFaction)}`);
            ns.print(`  ${label('Type:')}    ${col(C.bcyan,  currentWorkType ?? '?')}`);
            ns.print(`  ${label('Rotates:')} ${dim(fmtTime(timeUntilRotate / 1000))}`);
        } else if (!pausedReason) {
            ns.print(`  ${col(C.yellow, '⚠ Not currently working')}`);
        }

        ns.print(`  ${label('City:')}    ${col(C.white, player.city)}`);

        if (lastJoined.length > 0) {
            ns.print(`  ${col(C.bgreen, `✅ Auto-joined: ${lastJoined.join(', ')}`)}`);
        }

        // rep targets
        if (targets.length > 0) {
            ns.print(divider());
            ns.print(header('  📊 REP TARGETS'));
            ns.print(`  ${dim('Faction'.padEnd(26))} ${dim('Next Aug'.padEnd(28))} ${dim('Progress'.padStart(8))} ${dim('ETA')}`);
            ns.print(`  ${dim('─'.repeat(72))}`);

            for (const t of targets.slice(0, 10)) {
                const rate     = getRepRate(t.faction);
                const eta      = rate > 0 ? (t.repGap / rate) * 3600 : Infinity;
                const pct      = t.pct.toFixed(1);
                const pctColor = t.pct >= 75 ? C.bgreen : t.pct >= 40 ? C.byellow : C.bred;
                const barFill  = Math.floor(t.pct / 5);
                const bar      = '█'.repeat(barFill) + '░'.repeat(20 - barFill);
                const isCurrent = t.faction === currentFaction;
                const marker   = isCurrent ? col(C.bgreen, '▶ ') : '  ';
                const etaStr   = isFinite(eta) ? col(rate > 0 ? C.bgreen : C.dim, fmtTime(eta)) : dim('?');

                ns.print(
                    `${marker}${col(C.bwhite, t.faction.padEnd(24))} ` +
                    `${col(C.white, t.nextAugName.slice(0,26).padEnd(28))} ` +
                    `${col(pctColor, pct.padStart(5)+'%')} ` +
                    `${etaStr.padStart(8)}`
                );
                ns.print(
                    `  ${dim('  rep:')} ${fmtRep(t.rep)} / ${fmtRep(t.nextAugRep)}  ` +
                    `[${col(pctColor, bar)}]  ` +
                    `${rate > 0 ? col(C.dim, '+' + fmtRep(rate) + '/hr') : dim('no data yet')}`
                );
            }

            if (targets.length > 10) {
                ns.print(`  ${dim(`...+${targets.length-10} more factions`)}`);
            }
        } else {
            ns.print(divider());
            ns.print(`  ${col(C.bgreen, '✅ No rep targets — all available augs have sufficient rep')}`);
        }

        // priority queue
        if (priorityQueue.length > 1 && !manualFaction) {
            ns.print(divider());
            ns.print(header('  🔄 ROTATION QUEUE'));
            for (let i = 0; i < Math.min(5, priorityQueue.length); i++) {
                const t       = priorityQueue[i];
                const current = i === queueIndex % priorityQueue.length;
                const marker  = current ? col(C.bgreen, '▶') : col(C.dim, ' ');
                ns.print(
                    `  ${marker} ${col(C.white, t.faction.padEnd(26))} ` +
                    `gap: ${col(C.byellow, fmtRep(t.repGap))}  ` +
                    `augs: ${col(C.bcyan, String(t.augs.length))}`
                );
            }
        }

        ns.print(divider());
        ns.print(`  ${dim('Manual override: write faction name to ' + MANUAL_FILE)}`);
        ns.print(`  ${dim(`Refreshes every ${LOOP_MS/1000}s — rotates every 5min`)}`);

        await ns.sleep(LOOP_MS);
    }
}