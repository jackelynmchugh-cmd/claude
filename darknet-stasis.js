/**
 * darknet-stasis.js — Set stasis link and exit
 *
 * Runs once, sets a stasis link on the current server if a slot is
 * available, then exits to free its RAM.
 *
 * RAM cost: ~13.65GB (dominated by dnet.setStasisLink at 12GB)
 * Run this only when you have a free slot and want to lock a server.
 *
 * Compatible with Bitburner 3.0 API.
 */

/** @param {NS} ns */
export async function main(ns) {
    ns.disableLog('ALL');

    const host = ns.getHostname();

    try {
        const linked = ns.dnet.getStasisLinkedServers?.() ?? [];
        const limit  = ns.dnet.getStasisLinkLimit?.()    ?? 0;

        if (linked.includes(host)) {
            ns.tprint(`INFO: ${host} already stasis linked.`);
            return;
        }
        if (linked.length >= limit) {
            ns.tprint(`INFO: Stasis link limit reached (${linked.length}/${limit}).`);
            return;
        }

        const res = await ns.dnet.setStasisLink();
        if (res?.success) {
            ns.tprint(`✅ Stasis link set on ${host}`);
        } else {
            ns.tprint(`⚠ Stasis link failed on ${host}: ${res?.message ?? 'unknown'}`);
        }
    } catch (e) {
        ns.tprint(`ERROR: ${e}`);
    }
}