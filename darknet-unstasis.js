/**
 * darknet-unstasis.js — Remove stasis link from current server
 * Runs once and exits.
 * Compatible with Bitburner 3.0 API.
 */

/** @param {NS} ns */
export async function main(ns) {
    ns.disableLog('ALL');
    const host = ns.getHostname();
    try {
        const res = await ns.dnet.setStasisLink(false);
        if (res?.success) {
            ns.tprint(`🔓 Stasis link removed from ${host}`);
        } else {
            ns.tprint(`⚠ Unlink failed on ${host}: ${res?.message ?? 'unknown'}`);
        }
    } catch (e) {
        ns.tprint(`ERROR: ${e}`);
    }
}