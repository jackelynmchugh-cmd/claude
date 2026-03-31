/**
 * endgame-tracker.js — Tracks lategame faction requirements and sleeve costs
 *
 * Usage: run endgame-tracker.js
 */

/** @param {NS} ns */
export async function main(ns) {
  ns.disableLog('ALL');
  ns.ui.openTail();
  ns.ui.setTailTitle('🎯 Endgame Tracker');

  const fmt = (n) => {
    if (Math.abs(n) >= 1e12) return `$${(n / 1e12).toFixed(2)}t`;
    if (Math.abs(n) >= 1e9) return `$${(n / 1e9).toFixed(2)}b`;
    if (Math.abs(n) >= 1e6) return `$${(n / 1e6).toFixed(2)}m`;
    if (Math.abs(n) >= 1e3) return `$${(n / 1e3).toFixed(2)}k`;
    return `$${n.toFixed(0)}`;
  };

  const pct = (val, req) => Math.min(100, (val / req) * 100).toFixed(1);
  const bar = (val, req, width = 16) => {
    const filled = Math.min(width, Math.floor((val / req) * width));
    const done = val >= req;
    return `[${'█'.repeat(filled)}${done ? '' : '░'.repeat(width - filled)}] ${done ? '✅' : pct(val, req) + '%'}`;
  };

  while (true) {
    const player = ns.getPlayer();
    const cash = player.money;
    const hacking = player.skills.hacking;
    const strength = player.skills.strength;
    const defense = player.skills.defense;
    const dexterity = player.skills.dexterity;
    const agility = player.skills.agility;
    const augs = ns.singularity.getOwnedAugmentations(false).length; // exclude NeuroFlux
    const minCombat = Math.min(strength, defense, dexterity, agility);

    // ── Faction requirements ──────────────────────────────────────────────
    const FACTIONS = [
      {
        name: 'The Covenant',
        emoji: '🔱',
        reqs: [
          { label: 'Augmentations', val: augs, need: 20, unit: '' },
          { label: 'Money', val: cash, need: 75e9, money: true },
          { label: 'Hacking', val: hacking, need: 850, unit: '' },
          { label: 'Min Combat', val: minCombat, need: 850, unit: '' },
        ],
      },
      {
        name: 'Illuminati',
        emoji: '👁',
        reqs: [
          { label: 'Augmentations', val: augs, need: 30, unit: '' },
          { label: 'Money', val: cash, need: 150e9, money: true },
          { label: 'Hacking', val: hacking, need: 1500, unit: '' },
          { label: 'Min Combat', val: minCombat, need: 1200, unit: '' },
        ],
      },
      {
        name: 'Daedalus',
        emoji: '🌀',
        reqs: [
          { label: 'Augmentations', val: augs, need: 30, unit: '' },
          { label: 'Money', val: cash, need: 100e9, money: true },
          { label: 'Hacking OR', val: hacking, need: 2500, unit: '', orNext: true },
          { label: 'Min Combat', val: minCombat, need: 1500, unit: '', orPrev: true },
        ],
      },
    ];

    // ── Sleeve info ───────────────────────────────────────────────────────
    let sleeveSection = [];
    try {
      const numSleeves = ns.sleeve.getNumSleeves();
      const nextSleeveNum = numSleeves; // next one to buy is current count + 1
      const nextCost = ns.sleeve.getSleeveCost();

      sleeveSection.push(`  Sleeves owned: ${numSleeves}`);

      if (nextCost === Infinity) {
        sleeveSection.push(`  Next sleeve:   MAX SLEEVES REACHED`);
      } else {
        const canAfford = cash >= nextCost;
        sleeveSection.push(`  Next sleeve:   ${fmt(nextCost)}  ${canAfford ? '✅ can afford' : '❌ need ' + fmt(nextCost - cash) + ' more'}`);

      }

      // show what each sleeve is doing
      sleeveSection.push(`  ─────────────────────────────────────────────`);
      for (let i = 0; i < numSleeves; i++) {
        try {
          const sleeve = ns.sleeve.getSleeve(i);
          const task = ns.sleeve.getTask(i);
          const hp = `${sleeve.hp.current}/${sleeve.hp.max}`;
          const shock = sleeve.shock.toFixed(0);
          const sync = sleeve.sync.toFixed(0);
          let taskStr = 'idle';

          if (task) {
            switch (task.type) {
              case 'CRIME': taskStr = `crime: ${task.crimeType}`; break;
              case 'FACTION': taskStr = `faction: ${task.factionName}`; break;
              case 'COMPANY': taskStr = `company: ${task.companyName}`; break;
              case 'TRAIN': taskStr = `train: ${task.stat}`; break;
              case 'BLADEBURNER': taskStr = `blade: ${task.actionName}`; break;
              case 'INFILTRATE': taskStr = `infiltrate`; break;
              case 'SUPPORT': taskStr = `support bladeburner`; break;
              case 'RECOVERY': taskStr = `recovering shock`; break;
              default: taskStr = task.type;
            }
          }

          sleeveSection.push(`  [${i}] shock:${shock}% sync:${sync}% hp:${hp}  — ${taskStr}`);
        } catch {
          sleeveSection.push(`  [${i}] (unavailable)`);
        }
      }
    } catch {
      sleeveSection.push('  Sleeves not available (need SF10)');
    }

    // ── Render ────────────────────────────────────────────────────────────
    ns.clearLog();
    ns.print(`🎯 ENDGAME TRACKER`);
    ns.print(`  Cash: ${fmt(cash)}  Hacking: ${hacking}  Min Combat: ${minCombat}  Augs: ${augs}`);

    for (const faction of FACTIONS) {
      const allMet = faction.reqs.every((r, i) => {
        if (r.orNext) return r.val >= r.need || faction.reqs[i + 1]?.val >= faction.reqs[i + 1]?.need;
        if (r.orPrev) return r.val >= r.need || faction.reqs[i - 1]?.val >= faction.reqs[i - 1]?.need;
        return r.val >= r.need;
      });

      // check if already in faction
      let joined = false;
      try {
        joined = ns.getPlayer().factions.includes(faction.name);
      } catch { }

      ns.print('─'.repeat(52));
      ns.print(`  ${faction.emoji} ${faction.name}  ${joined ? '✅ JOINED' : allMet ? '🟢 ELIGIBLE' : '🔴 NOT YET'}`);

      for (let i = 0; i < faction.reqs.length; i++) {
        const r = faction.reqs[i];
        const met = r.val >= r.need;
        const valStr = r.money ? fmt(r.val) : String(Math.floor(r.val));
        const needStr = r.money ? fmt(r.need) : String(r.need);
        const orLabel = r.orNext ? ' ┐' : r.orPrev ? ' ┘OR' : '  ';

        // for OR conditions check if the other side is met
        let effectiveMet = met;
        if (r.orNext && faction.reqs[i + 1]) effectiveMet = met || faction.reqs[i + 1].val >= faction.reqs[i + 1].need;
        if (r.orPrev && faction.reqs[i - 1]) effectiveMet = met || faction.reqs[i - 1].val >= faction.reqs[i - 1].need;

        ns.print(
          `  ${orLabel} ${r.label.padEnd(14)} ${valStr.padStart(10)} / ${needStr.padEnd(10)} ${bar(r.val, r.need, 12)}`
        );

        if (!met && !effectiveMet) {
          const remaining = r.money
            ? `need ${fmt(r.need - r.val)} more`
            : `need ${Math.ceil(r.need - r.val)} more levels`;
          ns.print(`       └ ${remaining}`);
        }
      }
    }

    // ── Sleeves ───────────────────────────────────────────────────────────
    ns.print('─'.repeat(52));
    ns.print(`🧬 SLEEVES`);
    for (const line of sleeveSection) ns.print(line);

    ns.print('─'.repeat(52));
    ns.print(`  Refreshes every 10s`);

    await ns.sleep(10_000);
  }
}

/// alias -g lgt="run lategame-track.js"