/** @param {NS} ns **/
export async function main(ns) {

    const target = ns.args[0]

    if (!target) {
        ns.tprint("Usage: run connect.js <server>")
        return
    }

    const visited = new Set()
    const queue = [["home"]]

    while (queue.length > 0) {

        const path = queue.shift()
        const server = path[path.length - 1]

        if (visited.has(server)) continue
        visited.add(server)

        if (server === target) {

            for (const s of path) {
                ns.singularity.connect(s)
            }

            ns.tprint(`Connected to ${target}`)
            return
        }

        for (const next of ns.scan(server)) {
            if (!visited.has(next)) {
                queue.push([...path, next])
            }
        }
    }

    ns.tprint("Server not found.")
}

// w0r1d_d43m0n