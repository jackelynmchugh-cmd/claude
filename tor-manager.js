

/** @param {NS} ns **/
export async function main(ns) {
  ns.disableLog("ALL")

  if (!ns.singularity?.purchaseTor)
    ns.exit()

  const INTERVAL = 30000

  const programs = [
    "BruteSSH.exe","FTPCrack.exe","relaySMTP.exe",
    "HTTPWorm.exe","SQLInject.exe","ServerProfiler.exe",
    "DeepscanV1.exe","DeepscanV2.exe","AutoLink.exe",
    "DarkscapeNavigator.exe","Formulas.exe"
  ]

  while (true) {

    if (!ns.hasTorRouter()) {
      try { ns.singularity.purchaseTor() } catch {}
    }

    let allOwned = true

    for (const program of programs) {
      if (!ns.fileExists(program, "home")) {
        allOwned = false
        try { ns.singularity.purchaseProgram(program) } catch {}
      }
    }

    if (allOwned) {
      updateRegistry(ns, "tor", old => ({
        ...old,
        programsComplete: true,
        lastTick: Date.now()
      }))
      return
    }

    await ns.sleep(INTERVAL)
  }
}