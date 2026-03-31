/**
 * corp-invest.js — Accept investor offer when threshold met, then exit
 *
 * RAM: ~41.6GB
 * acceptInvestmentOffer(20) + getCorporation(10) + getInvestmentOffer(10) + base(1.6)
 *
 * Args: targetRound minFunds
 * Usage: run corp-invest.js [round] [minFunds]
 */

/** @param {NS} ns */
export async function main(ns) {
    ns.disableLog('ALL');

    const targetRound = parseInt(ns.args[0]);
    const minFunds    = parseFloat(ns.args[1]);

    if (!targetRound || !minFunds) {
        ns.tprint('Usage: run corp-invest.js [round] [minFunds]');
        return;
    }

    while (true) {
        try {
            const corp = ns.corporation.getCorporation();
            if (corp.public) return; // no more investor rounds once public

            const offer = ns.corporation.getInvestmentOffer();

            if (offer.round !== targetRound) return; // round passed or not reached

            ns.print(`💰 Offer: $${ns.format.number(offer.funds)} / need $${ns.format.number(minFunds)} (round ${offer.round})`);

            if (offer.funds >= minFunds) {
                ns.corporation.acceptInvestmentOffer();
                ns.tprint(`✅ Round ${offer.round} accepted: $${ns.format.number(offer.funds)}`);
                return;
            }
        } catch (e) { ns.tprint(`⚠ invest: ${e}`); return; }

        await ns.sleep(10_000);
    }
}