/**
 * darknet-solver.js — Password solver library
 * Imported by darknet-node.js and darknet-auth.js. No main().
 *
 * Contains all solving logic including ns-heavy strategies (NIL, heartbleed,
 * packet capture). RAM cost here doesn't matter — this file is never exec'd,
 * only imported as a reference library.
 *
 * New: password memory DB — passwords that have worked before are ranked
 * by frequency and tried first, with mutations, before falling back to
 * dictionaries or solving from hint data.
 */

// ─── Dictionaries — exact game source values ──────────────────────────────────

// FreshInstall_1.0 — source: defaultSettingsDictionary
export const DEFAULT_PASSWORDS = ['admin', 'password', '0000', '12345'];

// Laika4 — source: dogNameDictionary
export const DOG_NAMES = ['fido', 'spot', 'rover', 'max'];

// EuroZone Free — source: EUCountries (note: capitalised in game)
export const EU_COUNTRIES = [
    'Austria','Belgium','Bulgaria','Croatia','Republic of Cyprus','Czech Republic',
    'Denmark','Estonia','Finland','France','Germany','Greece','Hungary','Ireland',
    'Italy','Latvia','Lithuania','Luxembourg','Malta','Netherlands','Poland',
    'Portugal','Romania','Slovakia','Slovenia','Spain','Sweden',
];

// TopPass — source: commonPasswordDictionary (exact game list)
export const COMMON_PASSWORDS = [
    '123456','password','12345678','qwerty','123456789','12345','1234','111111',
    '1234567','dragon','123123','baseball','abc123','football','monkey','letmein',
    '696969','shadow','master','666666','qwertyuiop','123321','mustang','1234567890',
    'michael','654321','superman','1qaz2wsx','7777777','121212','0','qazwsx',
    '123qwe','trustno1','jordan','jennifer','zxcvbnm','asdfgh','hunter','buster',
    'soccer','harley','batman','andrew','tigger','sunshine','iloveyou','2000',
    'charlie','robert','thomas','hockey','ranger','daniel','starwars','112233',
    'george','computer','michelle','jessica','pepper','1111','zxcvbn','555555',
    '11111111','131313','freedom','777777','pass','maggie','159753','aaaaaa',
    'ginger','princess','joshua','cheese','amanda','summer','love','ashley',
    '6969','nicole','chelsea','biteme','matthew','access','yankees','987654321',
    'dallas','austin','thunder','taylor','matrix',
];

// ─── Password memory DB ───────────────────────────────────────────────────────
//
// Tracks which passwords have worked, per model and globally.
// Stored as JSON in dnet-passwords.txt on home.
// Format: { global: [{p, n}], models: { modelId: [{p, n}] } }

const PASSWORD_DB_FILE = 'dnet-passwords.txt';

export function loadPasswordDB(ns) {
    try {
        // Always prefer the copy on home — it's the master
        const src = ns.fileExists(PASSWORD_DB_FILE, 'home') ? 'home' : undefined;
        const raw = src ? ns.read(PASSWORD_DB_FILE) : ns.read(PASSWORD_DB_FILE);
        if (!raw) return { global: [], models: {} };
        const db = JSON.parse(raw);
        const fix = arr => (arr ?? []).map(p => typeof p === 'string' ? { p, n: 1 } : p);
        db.global = fix(db.global);
        for (const k in db.models) db.models[k] = fix(db.models[k]);
        return db;
    } catch { return { global: [], models: {} }; }
}

export function rememberPassword(ns, modelId, password, hostname) {
    if (!password) return;
    const db = loadPasswordDB(ns);
    function bump(list) {
        const f = list.find(x => x.p === password);
        if (f) f.n++; else list.push({ p: password, n: 1 });
    }
    bump(db.global);
    if (!db.models[modelId]) db.models[modelId] = [];
    bump(db.models[modelId]);
    const dbJson = JSON.stringify(db, null, 2);
    try { ns.write(PASSWORD_DB_FILE, dbJson, 'w'); } catch {}
    // Always mirror DB and per-host file to home so they survive restarts
    try { ns.scp(PASSWORD_DB_FILE, 'home'); } catch {}
    if (hostname) {
        const pwFile = `dnet-pw-${hostname}.txt`;
        try { ns.write(pwFile, password, 'w'); } catch {}
        try { ns.scp(pwFile, 'home'); } catch {}
    }
}

// ─── Mutation engine ──────────────────────────────────────────────────────────
//
// Generates common variations of a known password to catch slight differences
// across servers using the same base credential.

function mutatePassword(pw) {
    if (!pw) return [];
    return [
        pw,
        pw + '1',
        pw + '123',
        pw + '!',
        pw.toLowerCase(),
        pw.toUpperCase(),
        (pw[0]?.toUpperCase() ?? '') + pw.slice(1),
    ].filter(Boolean);
}

// ─── Candidate list builder ───────────────────────────────────────────────────
//
// Unified ranked candidate list:
//   1. Directly solved from hint/data (highest confidence)
//   2. Previously successful passwords for this model (ranked by frequency)
//   3. Previously successful passwords globally (ranked by frequency)
//   4. Dictionary candidates for this model
// All entries are passed through the mutation engine, deduped.

export function buildCandidateList(ns, details) {
    const db      = loadPasswordDB(ns);
    const modelId = details.modelId;

    const ranked = (arr) => (arr ?? []).sort((a, b) => b.n - a.n).map(x => x.p);
    const learnedModel  = ranked(db.models[modelId]);
    const learnedGlobal = ranked(db.global);

    const inferred = [];
    const solved = solvePassword(details);
    if (solved !== null) inferred.push(solved);

    const base = [
        ...inferred,
        ...learnedModel,
        ...learnedGlobal,
        ...(getDictionaryCandidates(modelId) ?? []),
    ];

    const seen = new Set();
    return base.flatMap(mutatePassword).filter(p => {
        if (!p || seen.has(p)) return false;
        seen.add(p);
        return true;
    });
}

// ─── Encoding helpers ─────────────────────────────────────────────────────────

function decodeRoman(str) {
    if (str.toLowerCase() === 'nulla') return 0;
    const map = { I:1,V:5,X:10,L:50,C:100,D:500,M:1000 };
    let total = 0, prev = 0;
    for (let i = str.length - 1; i >= 0; i--) {
        const val = map[str[i].toUpperCase()] ?? 0;
        if (val < prev) total -= val; else total += val;
        prev = val;
    }
    return total;
}

function largestPrimeFactor(n) {
    let largest = 1, num = n;
    for (let d = 2; d * d <= num; d++) {
        while (num % d === 0) { largest = d; num = Math.floor(num / d); }
    }
    return num > 1 ? num : largest;
}

function parseArithmetic(expr) {
    const clean = expr
        .replace(/ҳ/g,'*').replace(/÷/g,'/').replace(/➕/g,'+').replace(/➖/g,'-')
        .replace(/ns\.exit\(\),?/g,'').split(',')[0].trim();
    let pos = 0;
    const peek    = () => clean[pos];
    const consume = () => clean[pos++];
    function skipSpace() { while (pos < clean.length && clean[pos] === ' ') pos++; }
    function parseNumber() {
        skipSpace(); let neg = false;
        if (peek() === '-') { neg = true; consume(); }
        let num = '';
        while (pos < clean.length && /[\d.]/.test(peek())) num += consume();
        skipSpace();
        return neg ? -parseFloat(num) : parseFloat(num);
    }
    function parsePrimary() {
        skipSpace();
        if (peek() === '(') { consume(); const v = parseExpr(); if (peek()===')') consume(); return v; }
        return parseNumber();
    }
    function parseMulDiv() {
        let left = parsePrimary(); skipSpace();
        while (peek()==='*'||peek()==='/') { const op=consume(); skipSpace(); const r=parsePrimary(); left=op==='*'?left*r:left/r; skipSpace(); }
        return left;
    }
    function parseExpr() {
        let left = parseMulDiv(); skipSpace();
        while (peek()==='+'||peek()==='-') { const op=consume(); skipSpace(); const r=parseMulDiv(); left=op==='+'?left+r:left-r; skipSpace(); }
        return left;
    }
    try { return Math.round(parseExpr() * 1e9) / 1e9; } catch { return null; }
}

function decodeBinary(data) {
    return data.trim().split(' ').map(b => String.fromCharCode(parseInt(b, 2))).join('');
}

function decodeXor(data) {
    const [encrypted, masksStr] = data.split(';');
    if (!encrypted || !masksStr) return null;
    const masks = masksStr.trim().split(' ').map(m => parseInt(m, 2));
    let result = '';
    for (let i = 0; i < encrypted.length; i++)
        result += String.fromCharCode(encrypted.charCodeAt(i) ^ (masks[i] ?? 0));
    return result;
}

function convertFromBaseN(data) {
    const [baseStr, encoded] = data.split(',');
    if (!baseStr || !encoded) return null;
    const base = parseFloat(baseStr);
    const chars = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ';
    let result = 0;
    const parts = encoded.trim().split('.');
    let digit = parts[0].length - 1;
    for (const c of parts[0]) result += chars.indexOf(c.toUpperCase()) * Math.pow(base, digit--);
    let fracDigit = -1;
    for (const c of (parts[1] ?? '')) result += chars.indexOf(c.toUpperCase()) * Math.pow(base, fracDigit--);
    return Math.round(result).toString();
}

export function getPermutations(str) {
    if (str.length <= 1) return [str];
    const result = new Set();
    for (let i = 0; i < str.length; i++) {
        const rest = str.slice(0, i) + str.slice(i + 1);
        for (const perm of getPermutations(rest)) result.add(str[i] + perm);
    }
    return [...result];
}

// ─── CloudBlare extractor ─────────────────────────────────────────────────────

export function extractCloudBlareCode(hint, data) {
    for (const src of [hint, data].filter(Boolean)) {
        const symbolWrapped = src.match(/([^a-zA-Z0-9])\1*(\d+)\1+/g);
        if (symbolWrapped) {
            for (const match of symbolWrapped) {
                const digits = match.match(/\d+/);
                if (digits) return digits[0];
            }
        }
    }
    if (hint) {
        const patterns = [
            /(?:passcode|password|code|pin|key|token)\s+(?:is\s+)?[#*=@!_\-]*(\d+)/i,
            /(?:use|enter|type|provide)\s+(?:code\s+|pin\s+)?[#*=@!_\-]*(\d+)/i,
            /(?:pin|code|key)\s*[:=]\s*[#*=@!_\-]*(\d+)/i,
            /^\s*(\d+)\s*$/,
        ];
        for (const pat of patterns) {
            const m = hint.match(pat);
            if (m) return m[1];
        }
    }
    if (data) {
        const stripped = data.replace(/[^0-9]/g, '');
        if (stripped.length > 0) return stripped;
    }
    return null;
}

// ─── Known noise phrases from game source (packetSniffPhrases) ───────────────
// Used to strip noise before extracting real passwords from packet data.
const NOISE_PHRASES = [
    "we're trying to reach you about your car's extended warranty",
    "your package has been shipped",
    "your subscription has been renewed",
    "your account has been compromised",
    "congratulations! you've won",
    "your password has been reset. it is now set to",
    "your order has failed",
    "join the dark army",
    "upgrade to premium darknet",
    "breaking:",
    "search query:",
    "lorem ipsum",
    "dear diary",
    "error code 418",
    "darknet server rebooting",
    "the webstorm approaches",
];

function isNoiseLine(line) {
    const lower = line.toLowerCase();
    return NOISE_PHRASES.some(p => lower.includes(p));
}

// ─── Heartbleed / packet candidate extractor ──────────────────────────────────
//
// Patterns confirmed from game source (packetSniffing.ts):
//
// DIRECT LEAKS:
//   "Connecting to ${serverName}:${password} ..."       — log noise, low chance
//   "Authentication successful: ${password}"             — packetSniffer model only
//   "--${password}--"                                    — double-dash wrapped
//   "${noise}${password}${noise}"                        — raw in 124-char blob
//   "${noise} ${serverName}:${connectedPassword} ${noise}" — adjacent server pw
//
// HINT LEAKS (not the password directly, but useful info):
//   "There's definitely a X and a Y..."                  — chars in password
//   "I can see a X and a Y."                             — chars in password
//   "I must use X & Y!"                                  — chars in password
//   "Note to self: X and Y are important."               — chars in password
//   "The characters X, Y are in the right place."        — positional hint
//   "No characters are in the right place."              — all wrong

export function extractHeartbleedCandidates(logs, details) {
    const candidates = new Set();
    const charHints  = [];      // chars confirmed to be IN the password
    const posHints   = [];      // [char, position] confirmed correct

    for (const log of logs) {
        if (!log || typeof log !== 'string') continue;
        const line = log.trim();

        // Skip pure noise lines
        if (isNoiseLine(line)) continue;

        // ── Direct patterns ────────────────────────────────────────────────

        // "Authentication successful: PASSWORD" (packetSniffer model)
        const authSuccessMatch = line.match(/authentication successful:\s*(\S+)/i);
        if (authSuccessMatch) { candidates.add(authSuccessMatch[1]); continue; }

        // "Connecting to hostname:PASSWORD ..."
        const connectMatch = line.match(/connecting to [^:]+:(\S+)\s*\.\.\./i);
        if (connectMatch) { candidates.add(connectMatch[1]); continue; }

        // "--PASSWORD--" double-dash wrapped
        const dashMatch = line.match(/^--(.+)--$/);
        if (dashMatch) { candidates.add(dashMatch[1]); continue; }

        // "hostname:PASSWORD" anywhere (adjacent server leak)
        const colonPwMatch = line.match(/\b[\w\-^%;:&]+:([A-Za-z0-9!@#$%^&*_\-]{3,20})\b/g);
        if (colonPwMatch) {
            colonPwMatch.forEach(m => {
                const pw = m.split(':')[1];
                if (pw) candidates.add(pw);
            });
        }

        // "Your password has been reset. It is now set to X"
        const resetMatch = line.match(/it is now set to\s+(\S+)/i);
        if (resetMatch) { candidates.add(resetMatch[1]); continue; }

        // Standard "password: X" / "key: X" patterns
        const directMatch = line.match(/(?:password(?:\s+is)?|pass(?:word)?|pw|key|secret|token)\s*[:=]\s*["']?([^\s"']+)["']?/i);
        if (directMatch) { candidates.add(directMatch[1]); continue; }

        // ── Char hint patterns ─────────────────────────────────────────────

        // "There's definitely a X and a Y..." / "I can see a X and a Y." etc.
        const charHintMatch = line.match(
            /(?:there'?s? (?:definitely )?a|i can see a|i must use|note to self:|i think|i need to remember|theres a)\s+([A-Za-z0-9])\s+(?:and|'?n|with|&)\s+(?:a\s+)?([A-Za-z0-9])/i
        );
        if (charHintMatch) {
            charHints.push(charHintMatch[1], charHintMatch[2]);
            continue;
        }

        // "The characters X, Y are in the right place."
        const posHintMatch = line.match(/the characters?\s+([A-Za-z0-9])(?:,\s*([A-Za-z0-9]))?\s+are in the right place/i);
        if (posHintMatch) {
            if (posHintMatch[1]) posHints.push(posHintMatch[1]);
            if (posHintMatch[2]) posHints.push(posHintMatch[2]);
            continue;
        }

        // ── Encoded formats ────────────────────────────────────────────────

        if (/^[01]{8}( [01]{8})+$/.test(line)           ||
            /^.+;[01]+ [01]/.test(line)                  ||
            /^\d+(\.\d+)?,\s*[0-9A-Za-z.]+$/.test(line)  ||
            /^[IVXLCDM]+$/i.test(line)                   ||
            (/[+\-*/]/.test(line) && /\d/.test(line))) {
            const solved = solvePassword({ ...details, data: line });
            if (solved !== null) candidates.add(solved);
            continue;
        }

        // ── CloudBlare symbol-wrapped ──────────────────────────────────────
        const cbCode = extractCloudBlareCode('', line);
        if (cbCode) candidates.add(cbCode);

        // ── Bare number ───────────────────────────────────────────────────
        if (/^\d+$/.test(line)) { candidates.add(line); continue; }

        // ── Generic fallback — short tokens ───────────────────────────────
        (line.match(/\b([A-Za-z0-9!@#$%^&*_\-]{3,20})\b/g) ?? []).forEach(t => candidates.add(t));
    }

    // Add char hint combinations as candidates (useful for permutation models)
    if (charHints.length > 0) {
        candidates.add(charHints.join(''));
        candidates.add(charHints.reverse().join(''));
    }

    return [...candidates].filter(Boolean);
}

// ─── Packet data extractor ────────────────────────────────────────────────────
//
// Packet data is a 124-char noise blob with the password potentially embedded raw.
// We can't parse it the same way as heartbleed logs — we need to try substrings
// of the right length matching the password format.

export function extractPacketCandidates(packetData, details) {
    if (!packetData) return [];
    const candidates = new Set();
    const raw = packetData.trim();

    // "--PASSWORD--" pattern (random server leak)
    const dashMatch = raw.match(/--([A-Za-z0-9!@#$%^&*_\-]{2,20})--/);
    if (dashMatch) candidates.add(dashMatch[1]);

    // "hostname:PASSWORD" pattern (adjacent server leak)
    const colonMatches = raw.match(/\b[\w\-^%;:&]+:([A-Za-z0-9!@#$%^&*_\-]{2,20})\b/g) ?? [];
    colonMatches.forEach(m => { const pw = m.split(':').pop(); if (pw) candidates.add(pw); });

    // If we know the password length and format, extract substrings of exact length
    // that match the format — narrows down candidates dramatically
    const len    = details.passwordLength;
    const format = details.passwordFormat ?? 'alphanumeric';
    if (len && len > 0 && len <= raw.length) {
        const formatRegex = {
            'numeric':      new RegExp(`\\d{${len}}`,'g'),
            'alpha':        new RegExp(`[A-Za-z]{${len}}`,'g'),
            'alphanumeric': new RegExp(`[A-Za-z0-9]{${len}}`,'g'),
        }[format] ?? new RegExp(`[A-Za-z0-9]{${len}}`,'g');

        const matches = raw.match(formatRegex) ?? [];
        matches.forEach(m => candidates.add(m));
    }

    // Also run through the log extractor for labeled patterns
    extractHeartbleedCandidates([raw], details).forEach(c => candidates.add(c));

    return [...candidates].filter(Boolean);
}

// ─── NIL — Mastermind yes/yesn't solver ──────────────────────────────────────

const NIL_MAX_ATTEMPTS = 150;
const NIL_DELAY        = 300;

function nilBuildCharset(format) {
    const digits = '0123456789';
    const lower  = 'abcdefghijklmnopqrstuvwxyz';
    const upper  = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
    const fmt = (format ?? '').toLowerCase();
    if (fmt === 'numeric') return digits.split('');
    if (fmt === 'alpha')   return [...lower, ...upper];
    return [...digits, ...lower, ...upper];
}

function nilParseHint(hint) {
    const lenMatch = hint.match(/length\s*[:=]?\s*(\d+)|(\d+)\s*characters?/i);
    const fmtMatch = hint.match(/format\s*[:=]?\s*(alphanumeric|numeric|alpha)/i);
    return {
        length: lenMatch ? parseInt(lenMatch[1] ?? lenMatch[2]) : null,
        format: fmtMatch ? fmtMatch[1].toLowerCase() : 'alphanumeric',
    };
}

export async function runNilSolver(ns, target, details) {
    ns.print(`  🎯 NIL: ${target}`);

    // Try learned candidates before grinding the Mastermind loop
    const preList = buildCandidateList(ns, details);
    if (preList.length > 0) {
        ns.print(`  → Trying ${preList.length} learned/inferred candidates first`);
        for (const pw of preList) {
            try {
                const r = await ns.dnet.authenticate(target, pw);
                if (r?.success || r?.code === 200) {
                    rememberPassword(ns, details.modelId, pw, target);
                    ns.print(`  ✅ NIL pre-solved: "${pw}"`);
                    return pw;
                }
            } catch {}
            await ns.sleep(NIL_DELAY);
        }
    }

    // Read length and format directly from server details — no hint parsing needed
    const length = details.passwordLength ?? null;
    const format = details.passwordFormat ?? 'alphanumeric';

    if (!length || length < 1) {
        // Fallback: try to parse from hint text if server didn't provide length
        const hint = details.passwordHint ?? '';
        const lenMatch = hint.match(/length\s*[:=]?\s*(\d+)|(\d+)\s*characters?/i);
        if (!lenMatch) { ns.print(`  ⚠ NIL: could not determine password length`); return null; }
        const parsedLength = parseInt(lenMatch[1] ?? lenMatch[2]);
        ns.print(`  length=${parsedLength} (from hint) format=${format}`);
        return runNilLoop(ns, target, details, parsedLength, format);
    }

    ns.print(`  length=${length} format=${format}`);
    return runNilLoop(ns, target, details, length, format);
}

async function runNilLoop(ns, target, details, length, format) {
    const charset    = nilBuildCharset(format);
    const possible   = Array.from({ length }, () => new Set(charset));
    const locked     = new Array(length).fill(null);
    const globalElim = new Set();
    const tried      = new Set();

    function buildGuess() {
        return Array.from({ length }, (_, i) => {
            if (locked[i] !== null) return locked[i];
            for (const c of possible[i]) {
                if (!globalElim.has(c) || locked.some(l => l === c)) return c;
            }
            return [...possible[i]][0] ?? charset[0];
        }).join('');
    }

    function applyFeedback(guess, feedback) {
        for (let i = 0; i < feedback.length; i++) {
            if (feedback[i]) {
                locked[i] = guess[i];
                possible[i] = new Set([guess[i]]);
            } else {
                possible[i].delete(guess[i]);
                if (!locked.some(l => l === guess[i])) globalElim.add(guess[i]);
            }
        }
    }

    for (let attempt = 0; attempt < NIL_MAX_ATTEMPTS; attempt++) {
        const guess = buildGuess();
        if (tried.has(guess)) { ns.print(`  ⚠ NIL: duplicate guess, exhausted`); break; }
        tried.add(guess);

        const lockedStr = locked.map((l, i) => l ? `[${i}]${l}` : '').filter(Boolean).join(' ') || 'none';
        ns.print(`  → #${attempt + 1}: "${guess}" locked:${lockedStr}`);

        let res;
        try { res = await ns.dnet.authenticate(target, guess); }
        catch (e) { ns.print(`  ⚠ ${e}`); await ns.sleep(NIL_DELAY); continue; }

        if (res?.success || res?.code === 200) {
            rememberPassword(ns, details.modelId, guess, target);
            ns.print(`  ✅ NIL solved in ${attempt + 1} attempts: "${guess}"`);
            return guess;
        }

        const raw = res?.data ?? res?.message ?? '';
        const feedback = raw.split(',').map(s => s.trim().toLowerCase() === 'yes');
        if (feedback.length !== length) {
            ns.print(`  ⚠ bad feedback: "${raw}"`);
            await ns.sleep(NIL_DELAY); continue;
        }

        ns.print(`  → [${feedback.map(f => f ? '✓' : '✗').join('')}] ${feedback.filter(Boolean).length}/${length}`);
        applyFeedback(guess, feedback);
        await ns.sleep(NIL_DELAY);
    }

    ns.print(`  ❌ NIL exhausted`); return null;
}

// ─── DeepGreen — classic Mastermind solver ────────────────────────────────────
//
// Each authenticate() response data field: "exactMatches,wrongPlaceMatches"
//   exact      = chars correct value AND position
//   wrongPlace = chars in password but wrong position
//
// Strategy: maintain a pool of all possible passwords, filter after each guess.
// Each guess eliminates candidates that would not produce the same score.
// We pick the next guess that maximally partitions the remaining pool (minimax).

const DG_MAX_ATTEMPTS = 20;
const DG_DELAY        = 300;

export async function runDeepGreenSolver(ns, target, details) {
    ns.print(`  🟩 DeepGreen: ${target}`);

    // Try learned candidates first
    const preList = buildCandidateList(ns, details);
    if (preList.length > 0) {
        ns.print(`  → Trying ${preList.length} learned candidates first`);
        for (const pw of preList) {
            try {
                const r = await ns.dnet.authenticate(target, pw);
                if (r?.success || r?.code === 200) {
                    rememberPassword(ns, details.modelId, pw, target);
                    ns.print(`  ✅ DeepGreen pre-solved: "${pw}"`);
                    return pw;
                }
            } catch {}
            await ns.sleep(DG_DELAY);
        }
    }

    const length = details.passwordLength;
    const format = details.passwordFormat ?? 'alphanumeric';
    if (!length) { ns.print(`  ⚠ DeepGreen: no password length available`); return null; }
    ns.print(`  length=${length} format=${format}`);

    const charset = nilBuildCharset(format); // reuse NIL charset builder

    // Score a guess against a candidate — returns {exact, wrongPlace}
    function score(guess, candidate) {
        let exact = 0, wrongPlace = 0;
        const gArr = guess.split('');
        const cArr = candidate.split('');
        const gRem = [], cRem = [];
        for (let i = 0; i < gArr.length; i++) {
            if (gArr[i] === cArr[i]) exact++;
            else { gRem.push(gArr[i]); cRem.push(cArr[i]); }
        }
        for (const c of gRem) {
            const idx = cRem.indexOf(c);
            if (idx !== -1) { wrongPlace++; cRem.splice(idx, 1); }
        }
        return { exact, wrongPlace };
    }

    // Build initial pool of all possible passwords of given length/format
    // For short numeric passwords this is manageable; for alpha/alphanum we cap
    // the pool size and use a smarter first guess strategy
    function buildInitialPool() {
        if (format === 'numeric' && length <= 4) {
            const pool = [];
            const max = Math.pow(10, length);
            for (let i = 0; i < max; i++) pool.push(String(i).padStart(length, '0'));
            return pool;
        }
        // For larger spaces, start with an empty pool and grow from constraints
        return null; // signals constraint-only mode
    }

    // Parse data field: "exact,wrongPlace"
    function parseDGFeedback(data) {
        const m = (data ?? '').match(/(\d+)\s*,\s*(\d+)/);
        if (!m) return null;
        return { exact: parseInt(m[1]), wrongPlace: parseInt(m[2]) };
    }

    // Constraint-based mode: track what we know
    const confirmed   = new Array(length).fill(null); // confirmed[i] = char at position i
    const presentChars = new Set();  // chars known to be IN password
    const absentChars  = new Set();  // chars known to NOT be in password
    const wrongPos     = Array.from({ length }, () => new Set()); // wrongPos[i] = chars NOT at position i

    function applyDGFeedback(guess, exact, wrongPlace) {
        const gArr = guess.split('');
        const gRem = [], iRem = [];

        // First pass: find exact matches
        for (let i = 0; i < gArr.length; i++) {
            if (confirmed[i] === gArr[i]) continue; // already knew this
            // We can't know which positions are exact without positional feedback
            // so we track constraints globally
        }

        // If total matches = 0, all chars in guess are absent
        if (exact === 0 && wrongPlace === 0) {
            for (const c of gArr) {
                if (!presentChars.has(c)) absentChars.add(c);
            }
            return;
        }

        // If exact = length, we're done (caller handles success)
        // Track chars known present
        if (wrongPlace > 0 || exact > 0) {
            // chars that appear in guess are potentially present
            // We can't be more precise without positional data,
            // but we record the constraint
            for (const c of gArr) {
                if (!absentChars.has(c)) presentChars.add(c);
            }
        }
    }

    function buildConstrainedGuess(attempt) {
        // Build a guess that uses charset chars we haven't eliminated,
        // prioritising chars we know are present
        const available = charset.filter(c => !absentChars.has(c));
        if (available.length === 0) return null;

        // First few guesses: probe different char sets to maximise information
        if (attempt < 3) {
            const chunkSize = Math.ceil(charset.length / 4);
            const chunk = charset.slice(attempt * chunkSize, (attempt + 1) * chunkSize);
            const chars = chunk.filter(c => !absentChars.has(c));
            if (chars.length >= length) {
                return Array.from({ length }, (_, i) => chars[i % chars.length]).join('');
            }
        }

        // Later guesses: use available chars, prefer confirmed/present chars
        return Array.from({ length }, (_, i) => {
            if (confirmed[i]) return confirmed[i];
            const preferred = [...presentChars].filter(c => !absentChars.has(c) && !wrongPos[i].has(c));
            if (preferred.length > 0) return preferred[i % preferred.length];
            return available[i % available.length];
        }).join('');
    }

    // Use full pool filtering for small numeric spaces, constraint mode for larger
    const pool = buildInitialPool();
    const tried = new Set();

    for (let attempt = 0; attempt < DG_MAX_ATTEMPTS; attempt++) {
        let guess;

        if (pool) {
            // Pool mode: pick first remaining candidate
            const remaining = pool.filter(p => !tried.has(p));
            if (remaining.length === 0) { ns.print(`  ⚠ Pool exhausted`); break; }
            guess = remaining[0];
        } else {
            // Constraint mode
            guess = buildConstrainedGuess(attempt);
            if (!guess || tried.has(guess)) { ns.print(`  ⚠ No new guess available`); break; }
        }

        tried.add(guess);
        ns.print(`  → #${attempt + 1}: "${guess}"`);

        let res;
        try { res = await ns.dnet.authenticate(target, guess); }
        catch (e) { ns.print(`  ⚠ ${e}`); await ns.sleep(DG_DELAY); continue; }

        if (res?.success || res?.code === 200) {
            rememberPassword(ns, details.modelId, guess, target);
            ns.print(`  ✅ DeepGreen solved in ${attempt + 1} attempts: "${guess}"`);
            return guess;
        }

        const fb = parseDGFeedback(res?.data ?? '');
        if (!fb) { ns.print(`  ⚠ Bad feedback: "${res?.data}"`); await ns.sleep(DG_DELAY); continue; }

        ns.print(`  → exact:${fb.exact} wrongPlace:${fb.wrongPlace}`);

        if (pool) {
            // Filter pool: keep only candidates that would produce the same score
            const before = pool.length;
            for (let i = pool.length - 1; i >= 0; i--) {
                const s = score(guess, pool[i]);
                if (s.exact !== fb.exact || s.wrongPlace !== fb.wrongPlace) pool.splice(i, 1);
            }
            ns.print(`  → Pool: ${before} → ${pool.length} candidates`);
        } else {
            applyDGFeedback(guess, fb.exact, fb.wrongPlace);
        }

        await ns.sleep(DG_DELAY);
    }

    ns.print(`  ❌ DeepGreen exhausted`); return null;
}

// ─── 2G_cellular — sequential character oracle solver ────────────────────────
//
// Checks characters left to right, stops at first mismatch.
// Message reveals how many leading chars are correct: "...(N)"
//   (0) = first char wrong
//   (1) = first char correct, second wrong
//   (N) = first N chars correct
//
// Strategy: crack one position at a time — iterate charset at position N
// until the count increments to N+1, then lock and move on.

const TG_DELAY = 100;

export async function run2GCellularSolver(ns, target, details) {
    ns.print(`  📱 2G_cellular: ${target}`);

    // Try learned candidates first
    const preList = buildCandidateList(ns, details);
    if (preList.length > 0) {
        ns.print(`  → Trying ${preList.length} learned candidates first`);
        for (const pw of preList) {
            try {
                const r = await ns.dnet.authenticate(target, pw);
                if (r?.success || r?.code === 200) {
                    rememberPassword(ns, details.modelId, pw, target);
                    ns.print(`  ✅ 2G pre-solved: "${pw}"`);
                    return pw;
                }
            } catch {}
            await ns.sleep(TG_DELAY);
        }
    }

    const length = details.passwordLength;
    const format = details.passwordFormat ?? 'alphanumeric';
    if (!length) { ns.print(`  ⚠ 2G: no password length`); return null; }
    ns.print(`  length=${length} format=${format}`);

    const charset = nilBuildCharset(format);

    function parseCorrectCount(message) {
        const m = (message ?? '').match(/\((\d+)\)/);
        return m ? parseInt(m[1]) : 0;
    }

    const locked = new Array(length).fill(null);
    let correctSoFar = 0;

    for (let pos = 0; pos < length; pos++) {
        ns.print(`  → Cracking position ${pos}...`);
        let found = false;

        for (const c of charset) {
            const guess = Array.from({ length }, (_, i) => {
                if (i < pos)   return locked[i];
                if (i === pos) return c;
                return charset[0]; // filler
            }).join('');

            let res;
            try { res = await ns.dnet.authenticate(target, guess); }
            catch (e) { ns.print(`  ⚠ ${e}`); await ns.sleep(TG_DELAY); continue; }

            if (res?.success || res?.code === 200) {
                rememberPassword(ns, details.modelId, guess, target);
                ns.print(`  ✅ 2G solved: "${guess}"`);
                return guess;
            }

            const correct = parseCorrectCount(res?.message ?? '');
            ns.print(`  → pos:${pos} char:"${c}" correct:${correct}`);

            if (correct > correctSoFar) {
                locked[pos] = c;
                correctSoFar = correct;
                ns.print(`  🔒 pos ${pos} = "${c}"`);
                found = true;
                break;
            }

            await ns.sleep(TG_DELAY);
        }

        if (!found) {
            ns.print(`  ❌ 2G: no match found at position ${pos}`);
            return null;
        }
    }

    // All positions locked — final auth attempt
    const final = locked.join('');
    ns.print(`  → Final: "${final}"`);
    try {
        const r = await ns.dnet.authenticate(target, final);
        if (r?.success || r?.code === 200) {
            rememberPassword(ns, details.modelId, final, target);
            ns.print(`  ✅ 2G solved: "${final}"`);
            return final;
        }
    } catch {}

    ns.print(`  ❌ 2G failed on final attempt`);
    return null;
}


const HB_POLL   = 1_200;

export async function runHeartbleed(ns, target, details, tryCandidatesFn) {
    ns.print(`  🩸 Heartbleed: ${target}`);
    const seen = new Set();

    // Use logTrafficInterval if available — poll slightly faster than log generation
    // so we don't miss logs between rounds. Default to 1200ms.
    const pollInterval = details.logTrafficInterval > 0
        ? Math.max(details.logTrafficInterval * 0.8, 400)
        : HB_POLL;
    ns.print(`  → Poll interval: ${Math.round(pollInterval)}ms (logTrafficInterval: ${details.logTrafficInterval})`);

    // Try learned candidates before spending time on heartbleed rounds
    const preList = buildCandidateList(ns, details).filter(c => !seen.has(c));
    preList.forEach(c => seen.add(c));
    if (preList.length > 0) {
        const pw = await tryCandidatesFn(preList, 'hb-learned');
        if (pw !== null) return pw;
    }

    for (let round = 0; round < HB_ROUNDS; round++) {
        try {
            // Request max 8 logs per call (game hard cap)
            const hb   = await ns.dnet.heartbleed(target, { logsToCapture: 8 });
            const logs = hb?.logs ?? [];

            if (Array.isArray(logs) && logs.length > 0) {
                const fresh = extractHeartbleedCandidates(logs, details).filter(c => !seen.has(c));
                fresh.forEach(c => seen.add(c));
                ns.print(`  → HB round ${round + 1}: ${logs.length} logs, ${fresh.length} new candidates`);
                if (fresh.length > 0) {
                    const pw = await tryCandidatesFn(fresh, 'heartbleed');
                    if (pw !== null) return pw;
                }
            } else {
                ns.print(`  → HB round ${round + 1}: no data`);
            }
        } catch (e) { ns.print(`  ⚠ HB round ${round + 1}: ${e}`); }

        await ns.sleep(pollInterval);
    }

    ns.print(`  ❌ Heartbleed exhausted`); return null;
}

// ─── Packet capture strategy ──────────────────────────────────────────────────

const PACKET_TIMEOUT = 20_000;
const PACKET_POLL    =    800;

export async function runPacketCapture(ns, target, details, tryCandidatesFn) {
    ns.print(`  📡 Packet capture: ${target}`);
    const deadline = Date.now() + PACKET_TIMEOUT;
    const seen     = new Set();

    // Try learned candidates upfront
    const preList = buildCandidateList(ns, details).filter(c => !seen.has(c));
    preList.forEach(c => seen.add(c));
    if (preList.length > 0) {
        const pw = await tryCandidatesFn(preList, 'packet-learned');
        if (pw !== null) return pw;
    }

    while (Date.now() < deadline) {
        try {
            const cap = await ns.dnet.packetCapture(target);
            if (cap?.success && cap?.data) {
                const raw = cap.data?.trim();
                ns.print(`  → Captured: "${raw?.slice(0, 40)}..."`);

                // Use packet-specific extractor which knows the 124-char blob format
                const parsed = extractPacketCandidates(raw, details).filter(c => !seen.has(c));
                parsed.forEach(c => seen.add(c));
                if (parsed.length > 0) {
                    const pw = await tryCandidatesFn(parsed, 'packet');
                    if (pw !== null) return pw;
                }

                // Also try solver with raw data as hint data
                const solved = solvePassword({ ...details, data: raw });
                if (solved !== null && !seen.has(solved)) {
                    seen.add(solved);
                    const pw2 = await tryCandidatesFn([solved], 'packet+solver');
                    if (pw2 !== null) return pw2;
                }
            }
        } catch {}
        await ns.sleep(PACKET_POLL);
    }

    ns.print(`  ❌ Packet capture timeout`); return null;
}

// ─── Main solver ──────────────────────────────────────────────────────────────

export function solvePassword(details) {
    const hint = details.passwordHint     ?? '';
    const data = details.data ?? '';

    switch (details.modelId) {
        case 'ZeroLogon':    return '';
        case 'DeskMemo_3.1': {
            const keywords = ['The password is','The PIN is','Remember to use',"It's set to",'The key is','The secret is'];
            for (const kw of keywords) if (hint.startsWith(kw)) return hint.slice(kw.length).trim();
            const mid = hint.match(/(?:password|pin|code|key|secret)\s+(?:is\s+)?["']?([^\s"'.,]+)["']?/i);
            if (mid) return mid[1].trim();
            return null;
        }
        case 'PHP 5.4':        return null;
        case 'CloudBlare(tm)': return extractCloudBlareCode(hint, data);
        case 'BellaCuore': {
            if (!data) { const m = hint.match(/'([IVXLCDM]+)'/i); return m ? String(decodeRoman(m[1])) : null; }
            if (!data.includes(',')) return String(decodeRoman(data));
            return null;
        }
        case 'PrimeTime 2': {
            if (data) return String(largestPrimeFactor(parseInt(data)));
            if (hint) {
                const m = hint.match(/(?:largest prime factor of|factor[^0-9]*)\s*(\d+)/i)
                       ?? hint.match(/(\d{3,})/);
                if (m) return String(largestPrimeFactor(parseInt(m[1])));
            }
            return null;
        }
        case 'MathML': {
            if (!data) return null;
            const r = parseArithmetic(data);
            return r !== null ? String(Math.round(r)) : null;
        }
        case '110100100':  return data ? decodeBinary(data) : null;
        case 'OrdoXenos':  return data ? decodeXor(data) : null;
        case 'OctantVoxel': {
            if (data) return convertFromBaseN(data);
            if (hint) {
                const m = hint.match(/base\s+(\d+)\s+(?:number\s+)?([0-9A-Fa-f]+)/i);
                if (m) return convertFromBaseN(`${m[1]},${m[2]}`);
            }
            return null;
        }
        case 'NIL': return null;
        default: {
            if (hint) {
                const m = hint.match(/base\s+(\d+)\s+(?:number\s+)?([0-9A-Fa-f]+)/i);
                if (m) return convertFromBaseN(`${m[1]},${m[2]}`);
            }
            return null;
        }
    }
}

// ─── Dictionary candidates ────────────────────────────────────────────────────

export function getDictionaryCandidates(modelId) {
    switch (modelId) {
        case 'FreshInstall_1.0': return [...DEFAULT_PASSWORDS];
        case 'Laika4':           return [...DOG_NAMES];
        case 'TopPass':          return [...COMMON_PASSWORDS];
        case 'EuroZone Free':    return [...EU_COUNTRIES];
        default:                 return null;
    }
}

export function getModelName(modelId) {
    const names = {
        'ZeroLogon':'No Password','DeskMemo_3.1':'Echo Vuln','PHP 5.4':'Sorted Echo',
        'FreshInstall_1.0':'Default Pass','CloudBlare(tm)':'Symbol-Wrapped Code',
        'Laika4':'Dog Names','BellaCuore':'Roman Numerals','PrimeTime 2':'Largest Prime',
        'AccountsManager_4.2':'Guess Number','MathML':'Arithmetic','TopPass':'Common Passwords',
        'EuroZone Free':'EU Countries','DeepGreen':'Mastermind','2G_cellular':'Timing Attack',
        '110100100':'Binary Encoded','OrdoXenos':'XOR Encrypted','OctantVoxel':'Base Conversion',
        'Factori-Os':'Divisibility','BigMo%od':'Triple Modulo','NIL':"Mastermind (yes/yesn't)",
        'Pr0verFl0':'Buffer Overflow','RateMyPix.Auth':'Spice Level','KingOfTheHill':'Global Maxima',
        'OpenWebAccessPoint':'Packet Sniffer','th3_l4byr1nth':'Labyrinth',
    };
    return names[modelId] ?? modelId;
}