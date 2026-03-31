import { getAllServers } from "./utils.js"
import { updateRegistry, readRegistry } from "./registry.js"
import { solve } from "./contractSolvers.js"

const DEFAULT_INTERVAL = 60000

/** @param {NS} ns **/
export async function main(ns) {
  ns.disableLog("ALL")

  const interval = Number(ns.args[0] ?? DEFAULT_INTERVAL)
  const runOnce = ns.args.includes("--once")

  const seenFailures = new Set()

  const existing = readRegistry(ns)?.contracts ?? {}
  let totalSolved = existing.solved ?? 0
  let totalFailed = existing.failed ?? 0
  let totalUnsupported = existing.unsupported ?? 0

  let servers = []
  let lastScan = 0
  const SCAN_INTERVAL = 60000

  while (true) {
    const now = Date.now()

    if (servers.length === 0 || now - lastScan > SCAN_INTERVAL) {
      servers = getAllServers(ns)
      lastScan = now
    }

    const summary = scanAndSolve(ns, servers, seenFailures)

    if (summary.solved > 0 || summary.failed > 0 || summary.unsupported > 0) {
      totalSolved += summary.solved
      totalFailed += summary.failed
      totalUnsupported += summary.unsupported

      ns.tprint(`[contracts] solved=${summary.solved} failed=${summary.failed} unsupported=${summary.unsupported}`)

      updateRegistry(ns, "contracts", old => ({
        ...old,
        solved: totalSolved,
        failed: totalFailed,
        unsupported: totalUnsupported,
        lastTick: Date.now()
      }))
    }

    if (runOnce) return
    await ns.sleep(interval)
  }
}

function scanAndSolve(ns, servers, seenFailures) {
  let solved = 0
  let failed = 0
  let unsupported = 0

  for (const server of servers) {
    let files = []
    try { files = ns.ls(server, ".cct") } catch { continue }
    if (files.length === 0) continue

    for (const file of files) {
      let type, data
      try {
        type = ns.codingcontract.getContractType(file, server)
        data = ns.codingcontract.getData(file, server)
      } catch { continue }

      const answer = solve(type, data)
      const key = `${server}:${file}:${type}`

      if (answer === null || answer === undefined) {
        unsupported++
        if (!seenFailures.has(key)) {
          seenFailures.add(key)
          ns.tprint(`[contracts] UNSUPPORTED ${type} @ ${server}/${file}`)
        }
        continue
      }

      let reward = null
      try { reward = ns.codingcontract.attempt(answer, file, server) } catch { }

      if (reward) {
        solved++
        seenFailures.delete(key)
        ns.tprint(`[contracts] SOLVED ${type} @ ${server}/${file}`)
        ns.tprint(`[contracts] REWARD ${reward}`)
      } else {
        failed++
        if (!seenFailures.has(key)) {
          seenFailures.add(key)
          ns.tprint(`[contracts] FAILED ${type} @ ${server}/${file}`)
        }
      }
    }
  }

  return { solved, failed, unsupported }
}