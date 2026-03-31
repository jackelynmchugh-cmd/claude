/**
 * gang-manager.js — Gang management (full version)
 * 4-stage progressive mode system, color display,
 * vigilante hysteresis, task name fixes, one-at-a-time ascension
 *
 * Usage: run gang-manager.js
 */

/** @param {NS} ns */
export async function main(ns) {
    ns.disableLog('ALL');
    ns.ui.openTail();
    ns.ui.setTailTitle('🔫 Gang Manager');

    // ─── Stage thresholds ─────────────────────────────────────────────────────
    const STAGE_EARLY_MAX   = 0.25;  // below this = stage 1
    const STAGE_PREP_MAX    = 0.55;  // 25–55% = stage 2
    const STAGE_PUSH_MAX    = 0.85;  // 60–85% = stage 3
    // above 85% = stage 4

    // stage allocations (% of members)
    const STAGE1 = { territory: 0.00, money: 0.70, respect: 0.00, train: 0.30 };
    const STAGE2 = { territory: 0.25, money: 0.75, respect: 0.00, train: 0.00 };
    const STAGE3 = { territory: 0.50, money: 0.00, respect: 0.50, train: 0.00 };
    const STAGE4 = { territory: 0.30, money: 0.20, respect: 0.30, train: 0.20 };

    const WANTED_PENALTY_MIN   = 0.90;
    const WANTED_PENALTY_OK    = 0.995;
    const VIGILANTE_PCT        = 0.25;
    const VIGILANTE_MIN_TICKS  = 3;
    const WIN_CHANCE_MIN       = 0.55;  // threshold to enable clashes
    const ASCEND_THRESHOLD     = 2.0;
    const EQUIP_RESERVE_PCT    = 0.10;
    const STAT_BALANCE_RATIO   = 0.5;
    const MAX_MEMBERS          = 12;
    const MANUAL_TASK_FILE     = 'gang-manual-tasks.txt';

    const COMBAT_TRAIN = 'Train Combat';
    const HACK_TRAIN   = 'Train Hacking';
    const VIGILANTE    = 'Vigilante Justice';
    const TERRITORY    = 'Territory Warfare';
    const UNASSIGNED   = 'Unassigned';

    // ─── Color helpers ────────────────────────────────────────────────────────
    const C = {
        reset:   '\x1b[0m', bold:    '\x1b[1m', dim:     '\x1b[2m',
        red:     '\x1b[31m', green:   '\x1b[32m', yellow:  '\x1b[33m',
        blue:    '\x1b[34m', magenta: '\x1b[35m', cyan:    '\x1b[36m',
        white:   '\x1b[37m', bred:    '\x1b[91m', bgreen:  '\x1b[92m',
        byellow: '\x1b[93m', bblue:   '\x1b[94m', bcyan:   '\x1b[96m',
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

    // ─── Manual override tracking ─────────────────────────────────────────────
    let lastAssignedTasks = {};
    let manualOverrides   = {};
    const vigilanteTicks  = {};

    try {
        const saved = ns.read(MANUAL_TASK_FILE);
        if (saved) manualOverrides = JSON.parse(saved);
    } catch { }

    function saveManualOverrides() {
        ns.write(MANUAL_TASK_FILE, JSON.stringify(manualOverrides), 'w');
    }

    function detectManualOverrides(members) {
        for (const name of members) {
            const info        = ns.gang.getMemberInformation(name);
            const currentTask = info.task;
            const lastTask    = lastAssignedTasks[name];
            if (lastTask && currentTask !== lastTask && currentTask !== UNASSIGNED) {
                manualOverrides[name] = currentTask;
                saveManualOverrides();
            }
            if (currentTask === UNASSIGNED && manualOverrides[name]) {
                delete manualOverrides[name];
                saveManualOverrides();
            }
        }
    }

    // ─── Advisor ─────────────────────────────────────────────────────────────
    function readAdvisorState() {
        try {
            const advisorRunning = ns.ps('home').some(p => p.filename === 'bitnode-advisor.js');
            if (!advisorRunning) return null;
            const raw = ns.read('advisor-state.txt');
            if (!raw || raw === '') return null;
            const state = JSON.parse(raw);
            if (Date.now() - state.updatedAt > 5 * 60 * 1000) return null;
            return state;
        } catch { return null; }
    }

    function detectStageIndependent() {
        const player   = ns.getPlayer();
        const factions = player.factions ?? [];
        const inLate   = factions.includes('Daedalus') ||
                         factions.includes('The Covenant') ||
                         factions.includes('Illuminati');
        if (inLate || player.money >= 75e9 || player.skills.hacking >= 850) return 'lategame';
        if (player.money >= 1e9  || player.skills.hacking >= 300)           return 'midgame';
        return 'earlygame';
    }

    // ─── Gang stage detection ─────────────────────────────────────────────────
    function detectGangStage() {
        // get weakest win chance across all rivals
        let weakest = 0;
        try {
            const others = ns.gang.getOtherGangInformation();
            for (const gangName of Object.keys(others)) {
                if (gangName === ns.gang.getGangInformation().faction) continue;
                try {
                    const chance = ns.gang.getChanceToWinClash(gangName);
                    if (chance > weakest) weakest = chance;
                } catch { }
            }
            // weakest = lowest win chance (highest threat)
            weakest = 1; // reset and find actual minimum
            for (const gangName of Object.keys(others)) {
                if (gangName === ns.gang.getGangInformation().faction) continue;
                try {
                    const chance = ns.gang.getChanceToWinClash(gangName);
                    if (chance < weakest) weakest = chance;
                } catch { }
            }
        } catch { return 1; }

        if (weakest < STAGE_EARLY_MAX) return 1;
        if (weakest < STAGE_PREP_MAX)  return 2;
        if (weakest < STAGE_PUSH_MAX)  return 3;
        return 4;
    }

    function getStageAlloc(gangStage) {
        switch (gangStage) {
            case 1: return STAGE1;
            case 2: return STAGE2;
            case 3: return STAGE3;
            case 4: return STAGE4;
            default: return STAGE1;
        }
    }

    function getStageName(gangStage) {
        switch (gangStage) {
            case 1: return col(C.yellow,  '① EARLY');
            case 2: return col(C.byellow, '② PREP');
            case 3: return col(C.bcyan,   '③ PUSH');
            case 4: return col(C.bgreen,  '④ FUSION');
            default: return col(C.dim, '? UNKNOWN');
        }
    }

    function getStageDesc(gangStage) {
        switch (gangStage) {
            case 1: return 'Train, recruit, gear up — no territory yet';
            case 2: return 'Build power passively — 25% on warfare';
            case 3: return 'Territory push — 50% warfare, 50% rep grind';
            case 4: return 'Fusion — 30% terr / 30% rep / 20% money / 20% train';
            default: return '';
        }
    }

    // ─── Wanted level with hysteresis ─────────────────────────────────────────
    function getVigilanteSet(members, gangInfo) {
        const penalty      = gangInfo.wantedPenalty;
        const vigilanteSet = new Set();

        if (penalty >= WANTED_PENALTY_OK) {
            for (const name of members) {
                if (vigilanteTicks[name]) {
                    if (vigilanteTicks[name] < VIGILANTE_MIN_TICKS) {
                        vigilanteTicks[name]++;
                        vigilanteSet.add(name);
                    } else {
                        delete vigilanteTicks[name];
                    }
                }
            }
            return vigilanteSet;
        }

        if (penalty < WANTED_PENALTY_MIN) {
            const sorted = [...members].sort((a, b) => {
                const ai = ns.gang.getMemberInformation(a);
                const bi = ns.gang.getMemberInformation(b);
                return (bi.wantedLevelGain??0) - (ai.wantedLevelGain??0);
            });
            const count = Math.max(1, Math.floor(members.length * VIGILANTE_PCT));
            for (let i = 0; i < count && i < sorted.length; i++) {
                vigilanteSet.add(sorted[i]);
                if (!vigilanteTicks[sorted[i]]) vigilanteTicks[sorted[i]] = 1;
                else vigilanteTicks[sorted[i]]++;
            }
        } else {
            for (const name of members) {
                if (vigilanteTicks[name]) {
                    vigilanteTicks[name]++;
                    vigilanteSet.add(name);
                }
            }
        }
        return vigilanteSet;
    }

    // ─── Stat balance ─────────────────────────────────────────────────────────
    function getNeedsStat(info, isHacking) {
        if (isHacking) return null;
        const stats  = { str: info.str, def: info.def, dex: info.dex, agi: info.agi };
        const avg    = Object.values(stats).reduce((a,b) => a+b, 0) / 4;
        const minKey = Object.entries(stats).sort((a,b) => a[1]-b[1])[0];
        if (minKey[1] < avg * STAT_BALANCE_RATIO) return minKey[0];
        return null;
    }

    // get the best training task for a specific weak stat
    function getTrainTaskForStat(weakStat) {
        // all combat training tasks train all stats roughly equally
        // in this game Train Combat is the only option that targets combat stats
        return COMBAT_TRAIN;
    }

    // ─── Recruitment ─────────────────────────────────────────────────────────
    function tryRecruit(members) {
        if (members.length >= MAX_MEMBERS) return null;
        if (!ns.gang.getRecruitsAvailable()) return null;
        const names    = ['Razor','Ghost','Viper','Wraith','Cipher','Daemon','Neon',
                          'Flux','Byte','Glitch','Static','Pulse','Vector','Nexus',
                          'Shard','Prism','Sigma','Delta','Omega','Alpha'];
        const usedNames = new Set(members);
        const newName   = names.find(n => !usedNames.has(n)) ?? `Member${members.length+1}`;
        if (ns.gang.recruitMember(newName)) return newName;
        return null;
    }

    // ─── Ascension — one per cycle, highest gain first ────────────────────────
    function checkAscensions(members) {
        const ascended      = [];
        const allEquipCount = ns.gang.getEquipmentNames().length;

        const sortedByGain = [...members].sort((a, b) => {
            const ra = ns.gang.getAscensionResult(a);
            const rb = ns.gang.getAscensionResult(b);
            const ga = ra ? [ra.str??1,ra.def??1,ra.dex??1,ra.agi??1].reduce((x,y)=>x+y,0)/4 : 0;
            const gb = rb ? [rb.str??1,rb.def??1,rb.dex??1,rb.agi??1].reduce((x,y)=>x+y,0)/4 : 0;
            return gb - ga;
        });

        for (const name of sortedByGain) {
            const result = ns.gang.getAscensionResult(name);
            if (!result) continue;

            const info    = ns.gang.getMemberInformation(name);
            const gains   = [result.str??1, result.def??1, result.dex??1, result.agi??1];
            const avgGain = gains.reduce((a,b) => a+b, 0) / gains.length;

            let threshold = ASCEND_THRESHOLD;
            try {
                const installResult = ns.gang.getInstallResult(name);
                if (installResult) {
                    const minInstall = Math.min(
                        installResult.str??1, installResult.def??1,
                        installResult.dex??1, installResult.agi??1
                    );
                    if (minInstall < 1) threshold = ASCEND_THRESHOLD * 0.75;
                }
            } catch { }

            const upgradeCount = info.upgrades?.length ?? 0;
            const highGain     = avgGain >= ASCEND_THRESHOLD * 1.5;
            const fewUpgrades  = upgradeCount <= 2;
            const hasFullSet   = upgradeCount >= allEquipCount * 0.5;
            const shouldAscend = avgGain >= threshold && (highGain || fewUpgrades || hasFullSet);

            if (shouldAscend) {
                ns.gang.ascendMember(name);
                ascended.push(`${name} (+${avgGain.toFixed(2)}x)`);
                break;
            }
        }
        return ascended;
    }

    // ─── Equipment buying ─────────────────────────────────────────────────────
    function buyEquipment(members, gangInfo) {
        const cash      = ns.getPlayer().money;
        const budget    = cash * (1 - EQUIP_RESERVE_PCT);
        const isHacking = gangInfo.isHacking;
        const bought    = [];

        const allEquips = ns.gang.getEquipmentNames();
        const cheapest  = Math.min(...allEquips.map(e => ns.gang.getEquipmentCost(e)));
        if (budget < cheapest) return bought;

        const scored = allEquips.map(e => {
            const type = ns.gang.getEquipmentType(e);
            const cost = ns.gang.getEquipmentCost(e);
            let   roi  = 0;
            if (type === 'Augmentation')                                                     roi = 1e12 / cost;
            else if (isHacking && type === 'Rootkit')                                        roi = 1e9  / cost;
            else if (!isHacking && (type === 'Weapon' || type === 'Armor' || type === 'Vehicle')) roi = 1e9  / cost;
            return { name: e, type, cost, roi };
        })
        .filter(e => e.roi > 0)
        .sort((a, b) => b.roi - a.roi);

        const sortedMembers = [...members].sort((a, b) => {
            const ai = ns.gang.getMemberInformation(a);
            const bi = ns.gang.getMemberInformation(b);
            const as = (ai.str_asc_mult??1)+(ai.def_asc_mult??1)+(ai.dex_asc_mult??1)+(ai.agi_asc_mult??1);
            const bs = (bi.str_asc_mult??1)+(bi.def_asc_mult??1)+(bi.dex_asc_mult??1)+(bi.agi_asc_mult??1);
            return as - bs;
        });

        let spent = 0;
        for (const name of sortedMembers) {
            const info  = ns.gang.getMemberInformation(name);
            const owned = new Set([...(info.augmentations??[]), ...(info.upgrades??[])]);
            for (const equip of scored) {
                if (owned.has(equip.name)) continue;
                if (spent + equip.cost > budget) continue;
                if (ns.gang.purchaseEquipment(name, equip.name)) {
                    spent += equip.cost;
                    bought.push(`${name}: ${equip.name}`);
                    owned.add(equip.name);
                }
            }
        }
        return bought;
    }

    // ─── Task assignment ──────────────────────────────────────────────────────
    function assignTasks(members, gangInfo, vigilanteSet, gangStage) {
        const isHacking    = gangInfo.isHacking;
        const clashEnabled = gangInfo.territoryClashChance > 0;
        const assignments  = [];
        const alloc        = getStageAlloc(gangStage);

        // sort strongest first
        const sorted = [...members].sort((a, b) => {
            const ai = ns.gang.getMemberInformation(a);
            const bi = ns.gang.getMemberInformation(b);
            return ((bi.str+bi.def+bi.dex+bi.agi)/4) - ((ai.str+ai.def+ai.dex+ai.agi)/4);
        });

        // calculate slot counts from allocations
        // vigilante takes precedence and reduces available slots
        const vigilCount    = vigilanteSet.size;
        const available     = members.length - vigilCount;
        const terrCount     = Math.round(available * alloc.territory);
        const respectCount  = Math.round(available * alloc.respect);
        const moneyCount    = Math.round(available * alloc.money);
        // train gets the remainder (handles rounding)
        const trainCount    = Math.max(0, available - terrCount - respectCount - moneyCount);

        let terrAssigned    = 0;
        let respectAssigned = 0;
        let moneyAssigned   = 0;
        let trainAssigned   = 0;

        // track role assignments for display
        const roleMap = {};

        for (const name of sorted) {
            const info = ns.gang.getMemberInformation(name);

            // respect manual overrides
            if (manualOverrides[name]) {
                const overrideTask = manualOverrides[name];
                if (info.task !== overrideTask) {
                    ns.gang.setMemberTask(name, overrideTask);
                    lastAssignedTasks[name] = overrideTask;
                }
                roleMap[name] = 'manual';
                continue;
            }

            let task;
            let role;

            if (vigilanteSet.has(name)) {
                task = VIGILANTE;
                role = 'vigilante';

            } else if (terrAssigned < terrCount) {
                task = TERRITORY;
                role = 'territory';
                terrAssigned++;

            } else if (respectAssigned < respectCount) {
                task = getBestRespectTask(info, isHacking);
                role = 'respect';
                respectAssigned++;

            } else if (moneyAssigned < moneyCount) {
                task = getBestMoneyTask(info, isHacking);
                role = 'money';
                moneyAssigned++;

            } else if (trainAssigned < trainCount) {
                // train the weakest stat for this specific member
                const weakStat = getNeedsStat(info, isHacking);
                task = weakStat ? getTrainTaskForStat(weakStat) : COMBAT_TRAIN;
                role = 'train';
                trainAssigned++;

            } else {
                // overflow — assign best money task
                task = getBestMoneyTask(info, isHacking);
                role = 'money';
            }

            roleMap[name] = role;

            if (info.task !== task) {
                ns.gang.setMemberTask(name, task);
                assignments.push(`${name} → ${task}`);
            }
            lastAssignedTasks[name] = task;
        }

        return { assignments, roleMap, slots: { terrCount, respectCount, moneyCount, trainCount, vigilCount } };
    }

    function getBestRespectTask(info, isHacking) {
        if (isHacking) {
            if (info.hack >= 800) return 'Cyberterrorism';
            if (info.hack >= 500) return 'Ransomware';
            if (info.hack >= 300) return 'Phishing';
            return HACK_TRAIN;
        }
        const c = (info.str+info.def+info.dex+info.agi)/4;
        if (c >= 2000) return 'Terrorism';
        if (c >= 1000) return 'Traffick Illegal Arms';
        if (c >= 500)  return 'Armed Robbery';
        if (c >= 200)  return 'Run a Con';
        if (c >= 100)  return 'Mug People';
        return COMBAT_TRAIN;
    }

    function getBestMoneyTask(info, isHacking) {
        if (isHacking) {
            if (info.hack >= 800) return 'Cyberterrorism';
            if (info.hack >= 500) return 'Ransomware';
            if (info.hack >= 300) return 'Phishing';
            if (info.hack >= 200) return 'Identity Theft';
            if (info.hack >= 100) return 'Dox Celebrity';
            return HACK_TRAIN;
        }
        const c = (info.str+info.def+info.dex+info.agi)/4;
        if (c >= 2000) return 'Human Trafficking';
        if (c >= 1500) return 'Traffick Illegal Arms';
        if (c >= 1000) return 'Threaten & Blackmail';
        if (c >= 700)  return 'Armed Robbery';
        if (c >= 500)  return 'Deal Drugs';
        if (c >= 300)  return 'Run a Con';
        if (c >= 200)  return 'Strongarm Civilians';
        if (c >= 100)  return 'Mug People';
        return COMBAT_TRAIN;
    }

    // ─── Territory management ─────────────────────────────────────────────────
    function manageTerritory(gangInfo, gangStage) {
        const otherGangs   = ns.gang.getOtherGangInformation();
        const clashEnabled = gangInfo.territoryClashChance > 0;

        let lowestWinChance = 1;
        let weakestRival    = '';
        const rivalData     = [];

        for (const gangName of Object.keys(otherGangs)) {
            if (gangName === gangInfo.faction) continue;
            try {
                const chance = ns.gang.getChanceToWinClash(gangName);
                rivalData.push({ name: gangName, chance, power: otherGangs[gangName].power, territory: otherGangs[gangName].territory });
                if (chance < lowestWinChance) {
                    lowestWinChance = chance;
                    weakestRival    = gangName;
                }
            } catch { }
        }

        // only enable clashes from stage 2 onwards and above win threshold
        const shouldClash = gangStage >= 2 && lowestWinChance >= WIN_CHANCE_MIN;

        if (shouldClash && !clashEnabled) {
            ns.gang.setTerritoryWarfare(true);
            return { msg: `⚔ Warfare ON — worst: ${weakestRival} (${(lowestWinChance*100).toFixed(1)}%)`, rivalData, lowestWinChance };
        }
        if (!shouldClash && clashEnabled) {
            ns.gang.setTerritoryWarfare(false);
            return { msg: `🛡 Warfare OFF — ${weakestRival} (${(lowestWinChance*100).toFixed(1)}%)`, rivalData, lowestWinChance };
        }
        return { msg: null, rivalData, lowestWinChance };
    }

    let cycle = 0;

    // ─── Main loop ────────────────────────────────────────────────────────────
    while (true) {
        cycle++;

        if (!ns.gang.inGang()) {
            const karma = ns.heart.break();
            ns.clearLog();
            ns.print(header('🔫 GANG MANAGER'));
            ns.print(divider());
            ns.print(`  ${col(C.yellow, 'Not in a gang yet.')}`);
            ns.print(`  Karma: ${col(C.bwhite, karma.toFixed(0))} / -54000  (${(Math.abs(karma)/54000*100).toFixed(1)}%)`);
            if (karma <= -54000) {
                ns.print(`  ${col(C.bgreen, '✅ Karma ready — create gang via Factions tab')}`);
            } else {
                ns.print(`  Need ${col(C.bred, Math.ceil(54000-Math.abs(karma)).toString())} more karma`);
            }
            await ns.sleep(5_000);
            continue;
        }

        const advisorState  = readAdvisorState();
        const usingAdvisor  = advisorState !== null;
        const karma         = ns.heart.break();
        const playerStage   = usingAdvisor ? advisorState.stage : detectStageIndependent();
        const gangStage     = detectGangStage();

        const gangInfo = ns.gang.getGangInformation();
        const members  = ns.gang.getMemberNames();

        detectManualOverrides(members);

        const bonusTime   = ns.gang.getBonusTime();
        const vigilanteSet = getVigilanteSet(members, gangInfo);
        const recruited    = tryRecruit(members);
        const ascended     = checkAscensions(members);
        const bought       = buyEquipment(members, gangInfo);
        const { assignments, roleMap, slots } = assignTasks(members, gangInfo, vigilanteSet, gangStage);
        const { msg: terrMsg, rivalData, lowestWinChance } = manageTerritory(gangInfo, gangStage);

        const nextRespect   = ns.gang.respectForNextRecruit();
        const respPct       = members.length < MAX_MEMBERS
            ? (gangInfo.respect / nextRespect * 100).toFixed(1)
            : '—';
        const overrideCount = Object.keys(manualOverrides).length;
        const wantedColor   = gangInfo.wantedPenalty < WANTED_PENALTY_MIN ? C.bred
                            : gangInfo.wantedPenalty < WANTED_PENALTY_OK  ? C.byellow
                            : C.bgreen;
        const wantedLabel   = gangInfo.wantedPenalty < WANTED_PENALTY_MIN ? '🔴 HIGH'
                            : gangInfo.wantedPenalty < WANTED_PENALTY_OK  ? '🟡 ELEVATED'
                            : '🟢 OK';

        // ── Display ───────────────────────────────────────────────────────────
        ns.clearLog();

        // title
        const advisorTag = usingAdvisor ? col(C.bgreen, '🧭 advisor') : col(C.dim, '🔧 solo');
        const bonusTag   = bonusTime > 1000 ? col(C.byellow, `  ⚡ BONUS ${Math.floor(bonusTime/1000)}s`) : '';
        ns.print(`${header('🔫 GANG MANAGER')}  [${advisorTag}]${bonusTag}`);
        ns.print(divider());

        // stage banner
        ns.print(`  ${label('Gang Stage:')}  ${getStageName(gangStage)}  ${dim('—')}  ${dim(getStageDesc(gangStage))}`);
        ns.print(`  ${dim('Weakest win:')} ${col(lowestWinChance >= 0.85 ? C.bgreen : lowestWinChance >= 0.55 ? C.byellow : C.bred, (lowestWinChance*100).toFixed(1) + '%')}  ${dim('→ next stage at')} ${
            gangStage === 1 ? col(C.dim, '25%') :
            gangStage === 2 ? col(C.dim, '55%') :
            gangStage === 3 ? col(C.dim, '85%') :
            col(C.bgreen, 'MAX')
        }`);

        // slot breakdown
        const slotStr = [
            slots.terrCount    > 0 ? col(C.bcyan,   `⚔${slots.terrCount}`)    : '',
            slots.respectCount > 0 ? col(C.bblue,   `🏆${slots.respectCount}`) : '',
            slots.moneyCount   > 0 ? col(C.bgreen,  `💰${slots.moneyCount}`)   : '',
            slots.trainCount   > 0 ? col(C.blue,    `🏋${slots.trainCount}`)   : '',
            slots.vigilCount   > 0 ? col(C.yellow,  `🚔${slots.vigilCount}`)   : '',
        ].filter(Boolean).join('  ');
        ns.print(`  ${label('Slots:')}       ${slotStr}`);

        ns.print(divider());

        // gang overview
        ns.print(`  ${label('Gang:')}     ${col(C.bwhite, gangInfo.faction)}  ${dim(`(${gangInfo.isHacking ? 'Hacking' : 'Combat'})`)}`);
        ns.print(`  ${label('Members:')}  ${col(C.bwhite, String(members.length))}/${MAX_MEMBERS}  ${dim('Next recruit:')} ${respPct}%  ${dim('Cycle:')} ${cycle}`);
        ns.print(`  ${label('Respect:')}  ${fmt(gangInfo.respect)}  ${dim('Power:')} ${col(C.byellow, gangInfo.power.toFixed(2))}`);
        ns.print(`  ${label('Money/s:')}  ${col(C.bgreen, fmt(gangInfo.moneyGainRate) + '/s')}  ${dim('Territory:')} ${col(C.bcyan, (gangInfo.territory*100).toFixed(1) + '%')}`);
        ns.print(`  ${label('Wanted:')}   ${gangInfo.wantedLevel.toFixed(2)}  ${dim('Penalty:')} ${col(wantedColor, (gangInfo.wantedPenalty*100).toFixed(1) + '%')}  ${wantedLabel}`);
        ns.print(`  ${label('Clash:')}    ${gangInfo.territoryClashChance > 0 ? col(C.bred, '⚔ ON') : col(C.dim, '🛡 OFF')}  ${dim('Karma:')} ${karma.toFixed(0)}`);
        if (overrideCount > 0) ns.print(`  ${col(C.yellow, `⚠ ${overrideCount} manual override(s)`)}  ${dim('(set task to Unassigned to clear)')}`);

        if (usingAdvisor) {
            ns.print(divider());
            ns.print(`  ${header('📡 ADVISOR')}  BN${advisorState.bn} ${advisorState.bnName}`);
            ns.print(`  Crime$: ${col(C.bgreen, ((advisorState.mults?.crimeMoney??1)*100).toFixed(0) + '%')}  CrimeWin: ${col(C.bgreen, ((advisorState.mults?.crimeSuccess??1)*100).toFixed(0) + '%')}`);
        }

        // territory rivals
        ns.print(divider());
        ns.print(header('  ⚔ TERRITORY'));
        ns.print(`  ${dim('Our power:')} ${col(C.byellow, gangInfo.power.toFixed(2))}  ${dim('Territory:')} ${col(C.bcyan, (gangInfo.territory*100).toFixed(1) + '%')}`);
        if (rivalData.length > 0) {
            const sortedRivals = [...rivalData].sort((a,b) => b.power - a.power);
            for (const rival of sortedRivals) {
                const winPct   = (rival.chance * 100).toFixed(2);
                const winColor = rival.chance >= 0.85 ? C.bgreen
                               : rival.chance >= 0.55 ? C.byellow
                               : C.bred;
                const terrPct  = ((rival.territory ?? 0) * 100).toFixed(1);
                const terrColor = (rival.territory ?? 0) > 0 ? C.bcyan : C.dim;
                ns.print(
                    `  ${rival.name.padEnd(24)} ` +
                    `pwr: ${col(C.white, rival.power.toFixed(0)).padEnd(8)}  ` +
                    `terr: ${col(terrColor, terrPct + '%').padEnd(8)}  ` +
                    `win: ${col(winColor, winPct + '%')}`
                );
            }
        }
        if (terrMsg) ns.print(`  ${col(C.byellow, terrMsg)}`);

        // members table
        ns.print(divider());
        ns.print(header('  👥 MEMBERS'));
        ns.print(`  ${dim('Name'.padEnd(8))} ${dim('Role'.padEnd(8))} ${dim('Task'.padEnd(22))} ${dim('Combat'.padStart(7))} ${dim('Asc'.padStart(6))} ${dim('Eq')}`);
        ns.print(`  ${dim('─'.repeat(62))}`);

        for (const name of members) {
            const info     = ns.gang.getMemberInformation(name);
            const c        = Math.floor((info.str+info.def+info.dex+info.agi)/4);
            const task     = info.task ?? 'none';
            const ascMult  = Math.max(info.str_asc_mult??1,info.def_asc_mult??1,info.dex_asc_mult??1,info.agi_asc_mult??1);
            const augCount = info.augmentations?.length ?? 0;
            const upCount  = info.upgrades?.length ?? 0;
            const role     = roleMap[name] ?? 'money';

            // role color and label
            let roleColor, roleLabel;
            switch (role) {
                case 'territory': roleColor = C.bcyan;   roleLabel = '⚔ terr '; break;
                case 'respect':   roleColor = C.bblue;   roleLabel = '🏆 rep  '; break;
                case 'money':     roleColor = C.bgreen;  roleLabel = '💰 money'; break;
                case 'train':     roleColor = C.blue;    roleLabel = '🏋 train'; break;
                case 'vigilante': roleColor = C.yellow;  roleLabel = '🚔 vigi '; break;
                case 'manual':    roleColor = C.yellow;  roleLabel = '🖐 manul'; break;
                default:          roleColor = C.dim;     roleLabel = '? unk  ';
            }

            // task color
            let taskColor = C.white;
            if (task === VIGILANTE)                             taskColor = C.yellow;
            else if (task === TERRITORY)                        taskColor = C.bcyan;
            else if (task === COMBAT_TRAIN || task === HACK_TRAIN) taskColor = C.blue;
            else if (role === 'respect')                        taskColor = C.bblue;
            else if (role === 'money')                          taskColor = C.bgreen;

            const ascColor = ascMult >= 50 ? C.bgreen : ascMult >= 10 ? C.bgreen : C.dim;
            const balance  = getNeedsStat(info, gangInfo.isHacking);
            const balWarn  = balance ? col(C.bred, `⚠${balance}`) : '';

            ns.print(
                `  ${col(C.bwhite, name.padEnd(8))} ` +
                `${col(roleColor, roleLabel)}  ` +
                `${col(taskColor, task.padEnd(22))} ` +
                `${col(C.white, String(c).padStart(7))} ` +
                `${col(ascColor, ascMult.toFixed(1).padStart(5))}x ` +
                `${dim(String(upCount))}+${dim(String(augCount)+'a')} ` +
                `${balWarn}`
            );
        }

        // events
        const hasEvents = recruited || ascended.length > 0 || bought.length > 0 || terrMsg || assignments.length > 0;
        if (hasEvents) {
            ns.print(divider());
            ns.print(header('  📋 EVENTS'));
            if (recruited)           ns.print(`  ${col(C.bgreen,  '✅ Recruited:')} ${recruited}`);
            if (ascended.length > 0) ns.print(`  ${col(C.bcyan,   '⬆ Ascended:')}  ${ascended.join(', ')}`);
            if (bought.length > 0)   ns.print(`  ${col(C.byellow, '🛒 Bought:')}    ${bought.length} item(s)`);
            if (terrMsg)             ns.print(`  ${col(C.byellow, terrMsg)}`);
            if (assignments.length > 0) {
                ns.print(`  ${col(C.bblue, '→ Task changes:')}`);
                for (const a of assignments.slice(0, 6)) ns.print(`    ${dim(a)}`);
                if (assignments.length > 6) ns.print(`    ${dim(`...+${assignments.length-6} more`)}`);
            }
        }

        ns.print(divider());

        try {
            await ns.gang.nextUpdate();
        } catch {
            await ns.sleep(5_000);
        }
    }
}