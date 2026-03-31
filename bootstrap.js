/** @param {NS} ns */
export async function main(ns) {

  // ─── Aliases window ───────────────────────────────────────────────────────
  ns.ui.openTail();
  ns.ui.setTailTitle('🚀 Bootstrap');

  ns.print('─── ALIASES ─────────────────────────────────────────────');
  ns.print('  alias -g sell="run stock-sell.js"');
  ns.print('  alias -g trader="run stock-trader.js"');
  ns.print('  alias -g autoroot="run autoroot.js"');
  ns.print('  alias -g backdoor="run back.js"');
  ns.print('  alias -g orch="run orchestrator.js"');
  ns.print('  alias -g buyer="run server-buyer.js"');
  ns.print('  alias -g upgrade="run home-upgrade.js"');
  ns.print('  alias -g dnet="run darknet-boot.js"');
  ns.print('  alias -g contracts="run contract-solver.js"');
  ns.print('  alias -g go="run ipvgo.js"');
  ns.print('  alias -g infil="run infiltration-advisor.js"');
  ns.print('  alias -g manip="run stock-manipulator.js"');
  ns.print('  alias -g tracker="run endgame-tracker.js"');
  ns.print('  alias -g gang="run gang-manager.js"');
  ns.print('  alias -g augmgr="run augment-manager.js"');
  ns.print('  alias -g advisor="run bitnode-advisor.js"');
  ns.print('  alias -g hacknet="run hacknet-manager.js"');
  ns.print('  alias -g share="run share.js"');
  ns.print('  alias -g stats="run stat-tracker.js"');
  ns.print('  alias -g intel="run intel-tracker.js"');
  ns.print('  alias -g fwork="run faction-worker.js"');
  ns.print('  alias -g resettimer="run reset-timer.js"');
  ns.print('  alias -g sleeves="run sleeve-manager.js"');
  ns.print('─────────────────────────────────────────────────────────');
  ns.print('  go: hacking | hacknet | crime | combat | reputation | hgw');
  ns.print('  infil: rep | money | time');
  ns.print('─────────────────────────────────────────────────────────');

  // ─── BN detection ─────────────────────────────────────────────────────────
  const bn = ns.getResetInfo().currentNode;
  const sfRaw = ns.singularity.getOwnedSourceFiles();
  const ownedSF = {};
  for (const sf of sfRaw) ownedSF[sf.n] = sf.lvl;

  const hasSF2 = (ownedSF[2] ?? 0) > 0;
  const inBN2 = bn === 2;
  const gangAvail = hasSF2 || inBN2;
  const hasSF10 = (ownedSF[10] ?? 0) > 0;
  const inBN10 = bn === 10;
  const sleevesAvail = hasSF10 || inBN10;

  // ─── One-time launch helper ───────────────────────────────────────────────
  function launch(script, ...args) {
    if (!ns.isRunning(script, 'home', ...args)) {
      const pid = ns.exec(script, 'home', 1, ...args);
      if (pid > 0) ns.tprint(`✅ Started ${script}${args.length ? ' ' + args.join(' ') : ''}`);
      else ns.tprint(`⚠ Failed: ${script} — missing file or not enough RAM`);
    } else {
      ns.tprint(`⏭ ${script} already running`);
    }
  }

  // ─── Autoroot watchdog ────────────────────────────────────────────────────
  function watchAutoroot() {
    if (!ns.isRunning('Autoroot.js', 'home')) {
      const pid = ns.exec('Autoroot.js', 'home', 1);
      if (pid > 0) ns.tprint('🔄 Autoroot.js restarted');
    }
  }

  // ─── Launch persistent scripts ────────────────────────────────────────────
  ns.tprint(`Starting persistent scripts... (BN${bn})`);

  // always launch
  launch('Autoroot.js');
  launch('stat-tracker.js');
  launch('orchestrator.js');
  launch('manual-hack.js');
  launch('stock-trader.js');
  launch('tor-manager.js');
  launch('server-buyer.js');
  launch('ipvgo.js', 'crime');
  launch('hacknet-manager.js');
  launch('faction-worker.js');
  launch('reset-timer.js');
  launch('share.js');
  launch('bitnode-advisor.js');

  // gang — only if SF2 owned or in BN2
  if (gangAvail) {
    launch('gang-manager.js');
  } else {
    ns.tprint(`⏭ gang-manager.js skipped — no SF2 and not BN2 (BN${bn})`);
  }

  // sleeves — only if SF10 owned or in BN10
  if (sleevesAvail) {
    launch('sleeve-manager.js');
  } else {
    ns.tprint(`⏭ sleeve-manager.js skipped — no SF10 and not BN10 (BN${bn})`);
  }

  // darknet — only if exe exists
  if (ns.fileExists('darknetscape.exe', 'home')) {
    launch('darknet-boot.js');
  } else {
    ns.tprint('⏭ darknetscape.exe not found — skipping darknet-boot.js');
  }

  ns.tprint('✅ All persistent scripts launched.');
  ns.tprint('Starting rotation: backdoor → contracts → home-upgrade');

  // ─── Rotation loop ────────────────────────────────────────────────────────
  while (true) {

    // watchdog — only autoroot gets auto-restarted
    watchAutoroot();

    // darknet trigger
    if (ns.fileExists('darknetscape.exe', 'home') && !ns.isRunning('darknet-boot.js', 'home')) {
      launch('darknet-boot.js');
    }

    // backdoor
    if (!ns.isRunning('back.js', 'home')) {
      ns.tprint('▶ Running back.js...');
      const pid = ns.exec('back.js', 'home', 1);
      if (pid > 0) {
        while (ns.isRunning(pid, 'home')) await ns.sleep(1000);
        ns.tprint('✅ back.js done');
      } else {
        ns.tprint('⚠ back.js failed to start');
      }
    } else {
      ns.tprint('⏭ back.js already running — skipping');
    }

    // contracts
    ns.tprint('▶ Running contract-solver.js...');
    const csPid = ns.exec('contract-solver.js', 'home', 1);
    if (csPid > 0) {
      while (ns.isRunning(csPid, 'home')) await ns.sleep(1000);
      ns.tprint('✅ contract-solver.js done');
    } else {
      ns.tprint('⚠ contract-solver.js failed to start');
    }

    // home upgrade
    ns.tprint('▶ Running home-upgrade.js...');
    const huPid = ns.exec('home-upgrade.js', 'home', 1);
    if (huPid > 0) {
      while (ns.isRunning(huPid, 'home')) await ns.sleep(1000);
      ns.tprint('✅ home-upgrade.js done');
    } else {
      ns.tprint('⚠ home-upgrade.js failed to start');
    }

    ns.tprint('⏳ Waiting 5 minutes...');
    await ns.sleep(5 * 60 * 1000);
  }
}