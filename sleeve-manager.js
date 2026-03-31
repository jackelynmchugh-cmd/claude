/**
 * sleeve-manager.js — Automatic sleeve task manager
 * Handles both BN10 (buy sleeves, full rotation) and other BNs (work only)
 * Respects manual overrides, shock/sync thresholds, mirrors faction-worker targets
 *
 * Usage: run sleeve-manager.js
 */

/** @param {NS} ns */
export async function main(ns) {
    ns.disableLog('ALL');
    ns.ui.openTail();
    ns.ui.setTailTitle('🧬 Sleeve Manager');

    const LOOP_MS          = 10_000;
    const SHOCK_THRESHOLD  = 50;   // recover if shock above this
    const SYNC_THRESHOLD   = 75;   // synchronize if sync below this
    const MANUAL_FILE      = 'sleeve-manual-tasks.txt';
    const FACTION_FILE     = 'faction-worker-manual.txt'; // read faction targets

    // combat threshold — sleeve is considered "trained" above this avg
    const TRAINED_COMBAT   = 100;
    // karma needed for gang creation outside BN2
    const GANG_KARMA       = -54000;

    // stage thresholds for BN10 rotation
    const BN10_TRAIN_UNTIL = 200;  // train until avg combat hits this
    const BN10_CRIME_KARMA = -54000; // crime until karma threshold

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
    const divider = (n=62) => col(C.dim, '─'.repeat(n));
    const label   = (t)    => col(C.cyan, t);

    const fmt = (n) => {
        if (Math.abs(n) >= 1e12) return `$${(n/1e12).toFixed(2)}t`;
        if (Math.abs(n) >= 1e9)  return `$${(n/1e9).toFixed(2)}b`;
        if (Math.abs(n) >= 1e6)  return `$${(n/1e6).toFixed(2)}m`;
        if (Math.abs(n) >= 1e3)  return `$${(n/1e3).toFixed(2)}k`;
        return `$${n.toFixed(0)}`;
    };

    // ─── BN detection ─────────────────────────────────────────────────────────
    const bn    = ns.getResetInfo().currentNode;
    const inBN10 = bn === 10;

    // ─── Manual overrides ─────────────────────────────────────────────────────
    // format: JSON array of { index, task, faction? }
    // task can be: 'crime', 'faction', 'train_combat', 'train_hacking',
    //              'shock_recovery', 'synchronize', 'auto'
    let manualTasks = {};

    function loadManualTasks() {
        try {
            const raw = ns.read(MANUAL_FILE);
            if (raw && raw.trim()) {
                manualTasks = JSON.parse(raw);
            } else {
                manualTasks = {};
            }
        } catch { manualTasks = {}; }
    }

    function saveManualTasks() {
        try { ns.write(MANUAL_FILE, JSON.stringify(manualTasks), 'w'); } catch { }
    }

    // ─── Faction targets from faction-worker ──────────────────────────────────
    function getFactionTargets(factions, ownedAugs) {
        const ownedSet = new Set(ownedAugs);
        const targets  = [];

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
                if (rep >= repReq) continue;

                targets.push({ faction, aug, repReq, rep, gap: repReq - rep });
            }
        }

        // sort by smallest gap first
        targets.sort((a, b) => a.gap - b.gap);
        return targets;
    }

    // ─── Best work type for a faction ────────────────────────────────────────
    function getBestFactionWork(faction, sleeve) {
        const hackFactions = [
            'CyberSec','NiteSec','The Black Hand','BitRunners',
            'Daedalus','Illuminati','ECorp','MegaCorp','Blade Industries',
            'NWO','Clarke Incorporated','OmniTek Incorporated','Four Sigma',
            'KuaiGong International','Fulcrum Secret Technologies',
        ];
        const combatFactions = [
            'Slum Snakes','Tetrads','Speakers for the Dead',
            'The Dark Army','The Syndicate','Silhouette',
            'Tian Di Hui','The Covenant',
        ];

        const hk = sleeve.skills.hacking;
        const cb = Math.min(sleeve.skills.strength, sleeve.skills.defense,
                            sleeve.skills.dexterity, sleeve.skills.agility);

        if (hackFactions.includes(faction))   return 'hacking';
        if (combatFactions.includes(faction)) return cb >= hk ? 'field work' : 'security work';
        return hk >= 500 ? 'hacking' : 'field work';
    }

    // ─── Combat average for a sleeve ─────────────────────────────────────────
    function combatAvg(sleeve) {
        return (sleeve.skills.strength + sleeve.skills.defense +
                sleeve.skills.dexterity + sleeve.skills.agility) / 4;
    }

    // ─── Decide task for a sleeve ─────────────────────────────────────────────
    function decideTask(idx, sleeve, karma, factionTargets, numSleeves, inGang) {
        // 1. shock recovery always wins above threshold
        if (sleeve.shock > SHOCK_THRESHOLD) {
            return { type: 'shock_recovery', label: 'Shock Recovery', reason: `shock ${sleeve.shock.toFixed(0)}%` };
        }

        // 2. sync below threshold
        if (sleeve.sync < SYNC_THRESHOLD) {
            return { type: 'synchronize', label: 'Synchronize', reason: `sync ${sleeve.sync.toFixed(0)}%` };
        }

        if (inBN10) {
            return decideBN10Task(idx, sleeve, karma, factionTargets, numSleeves, inGang);
        } else {
            return decideStandardTask(idx, sleeve, karma, factionTargets, numSleeves, inGang);
        }
    }

    function decideBN10Task(idx, sleeve, karma, factionTargets, numSleeves, inGang) {
        const stage = getBN10Stage(sleeve, karma, inGang);

        switch (stage) {
            case 'train':
                return { type: 'train_combat', label: 'Train Combat', reason: `building stats (avg ${combatAvg(sleeve).toFixed(0)})` };

            case 'karma':
                return { type: 'crime', label: 'Homicide', reason: `karma farming (${karma.toFixed(0)} / ${GANG_KARMA})` };

            case 'faction': {
                const target = getFactionTargetForSleeve(idx, factionTargets, numSleeves);
                if (target) {
                    const workType = getBestFactionWork(target.faction, sleeve);
                    return { type: 'faction', label: `Work: ${target.faction}`, faction: target.faction, workType, reason: `rep for ${target.aug}` };
                }
                // fallback to crime if no faction target
                return { type: 'crime', label: 'Homicide', reason: 'no faction targets' };
            }

            default:
                return { type: 'crime', label: 'Homicide', reason: 'default' };
        }
    }

    function decideStandardTask(idx, sleeve, karma, factionTargets, numSleeves, inGang) {
        // priority order: shock → sync → faction work → crime → train

        // split sleeves intelligently based on index and stats
        // stronger sleeves (higher idx typically means older/stronger) → faction work
        // weaker sleeves → crime or train
        const isStrong = combatAvg(sleeve) >= TRAINED_COMBAT;

        // assign faction work to stronger sleeves that are past training
        if (isStrong && factionTargets.length > 0) {
            const target = getFactionTargetForSleeve(idx, factionTargets, numSleeves);
            if (target) {
                const workType = getBestFactionWork(target.faction, sleeve);
                return { type: 'faction', label: `Work: ${target.faction}`, faction: target.faction, workType, reason: `rep for ${target.aug}` };
            }
        }

        // weak sleeves or no faction target — crime for money and karma
        if (!isStrong) {
            // if stats are very low, train first
            if (combatAvg(sleeve) < 10) {
                return { type: 'train_combat', label: 'Train Combat', reason: 'stats too low for crime' };
            }
        }

        return { type: 'crime', label: 'Homicide', reason: isStrong ? 'no faction targets' : 'building karma + money' };
    }

    // ─── BN10 stage detection ─────────────────────────────────────────────────
    function getBN10Stage(sleeve, karma, inGang) {
        if (combatAvg(sleeve) < BN10_TRAIN_UNTIL) return 'train';
        if (!inGang && karma > GANG_KARMA)         return 'karma';
        return 'faction';
    }

    // ─── Distribute faction targets across sleeves ────────────────────────────
    // each sleeve gets a different faction target to maximize rep gain spread
    function getFactionTargetForSleeve(idx, factionTargets, numSleeves) {
        if (factionTargets.length === 0) return null;
        // distribute round-robin so each sleeve works a different faction
        const uniqueFactions = [];
        const seen           = new Set();
        for (const t of factionTargets) {
            if (!seen.has(t.faction)) {
                uniqueFactions.push(t);
                seen.add(t.faction);
            }
        }
        return uniqueFactions[idx % uniqueFactions.length] ?? null;
    }

    // ─── Apply task to sleeve ─────────────────────────────────────────────────
    function applyTask(idx, decision, currentTask) {
        // only switch if task has actually changed
        const sameType    = currentTask?.type    === decision.type;
        const sameFaction = currentTask?.faction === decision.faction;
        if (sameType && (decision.type !== 'faction' || sameFaction)) return false;

        try {
            switch (decision.type) {
                case 'shock_recovery':
                    ns.sleeve.setToShockRecovery(idx);
                    break;
                case 'synchronize':
                    ns.sleeve.setToSynchronize(idx);
                    break;
                case 'train_combat':
                    ns.sleeve.setToGymWorkout(idx, 'Powerhouse Gym', 'str');
                    break;
                case 'train_hacking':
                    ns.sleeve.setToUniversityCourse(idx, 'ZB Institute of Technology', 'Algorithms');
                    break;
                case 'crime':
                    ns.sleeve.setToCommitCrime(idx, 'Homicide');
                    break;
                case 'faction':
                    if (decision.faction && decision.workType) {
                        ns.sleeve.setToFactionWork(idx, decision.faction, decision.workType);
                    }
                    break;
            }
            return true;
        } catch (e) {
            return false;
        }
    }

    // ─── Buy sleeves in BN10 ──────────────────────────────────────────────────
    function tryBuySleeves(cash) {
        if (!inBN10) return 0;
        let bought = 0;
        try {
            while (true) {
                const cost = ns.sleeve.getSleeveUpgradeCost(ns.sleeve.getNumSleeves());
                if (!isFinite(cost) || cost === 0) break;
                if (cash < cost * 1.1) break; // keep 10% buffer
                if (ns.sleeve.purchaseSleeve()) {
                    cash -= cost;
                    bought++;
                } else break;
            }
        } catch { }
        return bought;
    }

    // ─── Buy sleeve augments ──────────────────────────────────────────────────
    function tryBuySleeveAugs(idx, cash) {
        const bought = [];
        try {
            const augs = ns.sleeve.getSleevePurchasableAugs(idx);
            // sort cheapest first for sleeves
            augs.sort((a, b) => a.cost - b.cost);
            for (const aug of augs) {
                if (cash - aug.cost < 1_000_000) break;
                if (ns.sleeve.purchaseSleeveAug(idx, aug.name)) {
                    cash -= aug.cost;
                    bought.push(aug.name);
                }
            }
        } catch { }
        return bought;
    }

    // track current tasks for change detection
    const currentTasks = {};
    let   cycle        = 0;
    let   lastBought   = 0;
    const augsBought   = {};

    // ─── Main loop ────────────────────────────────────────────────────────────
    while (true) {
        cycle++;

        loadManualTasks();

        const player   = ns.getPlayer();
        const karma    = ns.heart.break();
        const cash     = player.money;
        const factions = player.factions ?? [];

        // check gang status
        let inGang = false;
        try { inGang = ns.gang.inGang(); } catch { }

        // get owned augs for faction target calculation
        let ownedAugs = [];
        try { ownedAugs = ns.singularity.getOwnedAugmentations(true); } catch { }

        const factionTargets = getFactionTargets(factions, ownedAugs);

        // buy new sleeves if BN10
        if (inBN10) lastBought = tryBuySleeves(cash);

        const numSleeves = ns.sleeve.getNumSleeves();
        const sleeveData = [];

        for (let i = 0; i < numSleeves; i++) {
            try {
                const sleeve   = ns.sleeve.getSleeve(i);
                const manual   = manualTasks[i];

                let decision;

                if (manual && manual !== 'auto') {
                    // manual override — respect it
                    decision = {
                        type:    manual.type,
                        label:   manual.label ?? manual.type,
                        faction: manual.faction,
                        workType: manual.workType,
                        reason:  '🖐 manual',
                    };
                } else {
                    decision = decideTask(i, sleeve, karma, factionTargets, numSleeves, inGang);
                }

                // apply task — only switches after current cycle completes
                const changed = applyTask(i, decision, currentTasks[i]);
                if (changed) currentTasks[i] = decision;

                // try buying augs for this sleeve
                const bought = tryBuySleeveAugs(i, cash);
                if (bought.length > 0) augsBought[i] = bought;

                // get current task from game for display
                let currentTaskName = '?';
                try {
                    const task = ns.sleeve.getTask(i);
                    if (task) {
                        currentTaskName = task.type === 'FACTION'  ? `Work: ${task.factionName}`
                                        : task.type === 'CRIME'    ? task.crimeType
                                        : task.type === 'CLASS'    ? `Train: ${task.classType}`
                                        : task.type === 'RECOVERY' ? 'Shock Recovery'
                                        : task.type === 'SYNCHRO'  ? 'Synchronize'
                                        : task.type;
                    }
                } catch { }

                sleeveData.push({
                    idx:      i,
                    sleeve,
                    decision,
                    changed,
                    taskName: currentTaskName,
                    manual:   !!manual && manual !== 'auto',
                });
            } catch { }
        }

        // ── Display ───────────────────────────────────────────────────────────
        ns.clearLog();

        const modeTag = inBN10
            ? col(C.bgreen,  '🧬 BN10 MODE')
            : col(C.bcyan,   '🔧 STANDARD MODE');

        ns.print(`${header('🧬 SLEEVE MANAGER')}  [${modeTag}]  ${dim(`Cycle: ${cycle}`)}`);
        ns.print(divider());

        // overview
        ns.print(`  ${label('Sleeves:')}  ${col(C.bwhite, String(numSleeves))}`);
        ns.print(`  ${label('Karma:')}    ${col(karma <= GANG_KARMA ? C.bgreen : C.yellow, karma.toFixed(0))}`);
        ns.print(`  ${label('In gang:')}  ${inGang ? col(C.bgreen, '✅') : col(C.dim, 'no')}`);
        ns.print(`  ${label('Cash:')}     ${col(C.bwhite, fmt(cash))}`);

        if (inBN10 && lastBought > 0) {
            ns.print(`  ${col(C.bgreen, `✅ Bought ${lastBought} new sleeve(s)`)}`);
        }

        if (inBN10) {
            try {
                const nextCost = ns.sleeve.getSleeveUpgradeCost(numSleeves);
                if (isFinite(nextCost) && nextCost > 0) {
                    ns.print(`  ${label('Next sleeve:')} ${col(C.byellow, fmt(nextCost))}`);
                } else {
                    ns.print(`  ${label('Next sleeve:')} ${col(C.bgreen, 'max reached')}`);
                }
            } catch { }
        }

        // faction targets summary
        if (factionTargets.length > 0) {
            ns.print(divider());
            ns.print(header('  🎯 TOP FACTION TARGETS'));
            const uniqueFactions = [];
            const seen           = new Set();
            for (const t of factionTargets) {
                if (!seen.has(t.faction)) {
                    uniqueFactions.push(t);
                    seen.add(t.faction);
                    if (uniqueFactions.length >= 4) break;
                }
            }
            for (const t of uniqueFactions) {
                const pct      = (t.rep / t.repReq * 100).toFixed(1);
                const pctColor = Number(pct) >= 75 ? C.bgreen : Number(pct) >= 40 ? C.byellow : C.bred;
                ns.print(
                    `  ${col(C.bwhite, t.faction.padEnd(26))} ` +
                    `${col(pctColor, pct+'%').padStart(6)}  ` +
                    `${dim(t.aug.slice(0, 20))}`
                );
            }
        }

        // sleeve table
        ns.print(divider());
        ns.print(header('  👥 SLEEVES'));
        ns.print(`  ${dim('Idx')}  ${dim('Task'.padEnd(28))} ${dim('Shock'.padStart(6))} ${dim('Sync'.padStart(6))} ${dim('Combat'.padStart(7))} ${dim('Flags')}`);
        ns.print(`  ${dim('─'.repeat(62))}`);

        for (const { idx, sleeve, decision, taskName, manual } of sleeveData) {
            const shockColor = sleeve.shock > SHOCK_THRESHOLD ? C.bred
                             : sleeve.shock > 25              ? C.byellow
                             : C.bgreen;
            const syncColor  = sleeve.sync < SYNC_THRESHOLD   ? C.byellow
                             : sleeve.sync >= 90               ? C.bgreen
                             : C.white;

            // task color
            let taskColor = C.white;
            if (decision.type === 'shock_recovery') taskColor = C.bred;
            else if (decision.type === 'synchronize')   taskColor = C.yellow;
            else if (decision.type === 'faction')        taskColor = C.bblue;
            else if (decision.type === 'crime')          taskColor = C.bgreen;
            else if (decision.type.startsWith('train'))  taskColor = C.blue;

            const manualFlag = manual ? col(C.yellow, ' 🖐') : '';
            const augFlag    = augsBought[idx]?.length > 0 ? col(C.bgreen, ' 💊') : '';

            const combat = combatAvg(sleeve).toFixed(0);

            ns.print(
                `  ${col(C.bwhite, String(idx))}    ` +
                `${col(taskColor, (taskName ?? decision.label).slice(0,28).padEnd(28))} ` +
                `${col(shockColor, sleeve.shock.toFixed(0).padStart(5)+'%')} ` +
                `${col(syncColor,  sleeve.sync.toFixed(0).padStart(5)+'%')} ` +
                `${col(C.white,    combat.padStart(7))} ` +
                `${manualFlag}${augFlag}`
            );
            ns.print(`  ${dim('     reason: ' + decision.reason)}`);
        }

        // aug purchases this cycle
        const augEntries = Object.entries(augsBought);
        if (augEntries.length > 0) {
            ns.print(divider());
            ns.print(header('  💊 AUG PURCHASES'));
            for (const [idx, augs] of augEntries) {
                ns.print(`  Sleeve ${idx}: ${col(C.bgreen, augs.join(', '))}`);
            }
            // clear after display
            for (const k of Object.keys(augsBought)) delete augsBought[k];
        }

        ns.print(divider());
        ns.print(`  ${dim('Manual override: write JSON to ' + MANUAL_FILE)}`);
        ns.print(`  ${dim('Example: {"0":{"type":"crime","label":"Homicide"}}')}`);
        ns.print(`  ${dim('Set to "auto" to return to automatic: {"0":"auto"}')}`);
        ns.print(`  ${dim(`Refreshes every ${LOOP_MS/1000}s`)}`);

        await ns.sleep(LOOP_MS);
    }
}

///Add the alias — already in bootstrap:
///alias -g sleeves="run sleeve-manager.js"