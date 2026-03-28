/**
 * AI Command Parser Service
 * Supports: Hindi · Hinglish · English
 * Actions: ADD_FUND | CREATE_ADMIN | BLOCK_USER | UNBLOCK_USER | TRANSFER_FUND
 *
 * Provides two parsing engines:
 * 1. Rule-based (regex) — always available, fast
 * 2. OpenAI (gpt-4o-mini) — if OPENAI_API_KEY is valid, with automatic fallback
 */

// ─────────────────────────────────────────────────────────────────────────────
// DUMMY CREDENTIAL GENERATOR
// ─────────────────────────────────────────────────────────────────────────────

const makeDummy = () => {
    const adjectives = ['quick', 'smart', 'bold', 'swift', 'prime'];
    const nouns      = ['admin', 'trader', 'broker', 'agent', 'user'];
    const adj  = adjectives[Math.floor(Math.random() * adjectives.length)];
    const noun = nouns[Math.floor(Math.random() * nouns.length)];
    const num  = Math.floor(Math.random() * 900) + 100;
    return {
        name    : `${adj}_${noun}`,
        email   : `${adj}.${noun}${num}@example.com`,
        password: `Pass${num}@!`,
    };
};

// ─────────────────────────────────────────────────────────────────────────────
// RULE-BASED PARSER
// ─────────────────────────────────────────────────────────────────────────────

const parseWithRules = (rawText) => {
    const t  = rawText.trim();
    const tl = t.toLowerCase();

    // ── Helpers ───────────────────────────────────────────────────────────────

    const extractIdAfter = (str, keywordPattern) => {
        const re = new RegExp(keywordPattern.source + String.raw`\s*[:#]?\s*(\d+)`, 'i');
        const m  = str.match(re);
        return m ? { value: parseInt(m[1], 10), fullMatch: m[0] } : null;
    };

    const parseAmount = (str) => {
        const km = str.match(/(\d+)\s*k\b/i);
        if (km) return parseInt(km[1], 10) * 1000;
        const nm = str.match(/(\d[\d,]{2,})/);
        if (nm) return parseFloat(nm[1].replace(/,/g, ''));
        const sm = str.match(/(\d+)/);
        return sm ? parseFloat(sm[1]) : null;
    };

    // ── Intent signals ────────────────────────────────────────────────────────

    const isTransfer = /transfer|bhejo|send\s+to|se\s+.*?\s+(?:me|ko)|from\s+.*?\s+to/.test(tl)
                    && /(?:id|user)\s*[:#]?\s*\d+/.test(tl);

    const isCreateAdmin = /(?:new|naya|create|bana[ao]|add\s+a?n?\s*)\s*admin|admin\s+(?:banao|create|add|bana)|admin\s+with/.test(tl);

    const isBlock   = /(?<!un)\bblock\b|suspend|band\s*karo|\broko\b/.test(tl);
    const isUnblock = /unblock|activate|chalu\s*karo|kholo/.test(tl);
    const isAddWord = /\badd\b|deposit|jama|daalo|dalo|credit|bdhao|badhao/.test(tl);

    // ── Priority order: most specific → least specific ────────────────────────

    // 1. TRANSFER_FUND
    if (isTransfer) {
        const fromMatch = tl.match(/(?:id|user)\s*[:#]?\s*(\d+)\s+(?:se|from)/i)
                       || tl.match(/(?:se|from)\s+(?:id|user)?\s*[:#]?\s*(\d+)/i)
                       || tl.match(/(?:id|user)\s*[:#]?\s*(\d+)/i);
        const fromUserId = fromMatch ? parseInt(fromMatch[1], 10) : null;

        const allIds = [...tl.matchAll(/(?:id|user)\s*[:#]?\s*(\d+)/gi)].map(m => parseInt(m[1], 10));
        const toUserId = allIds.length >= 2 ? allIds[1] : null;

        let stripped = tl;
        for (const m of tl.matchAll(/(?:id|user)\s*[:#]?\s*\d+/gi)) stripped = stripped.replace(m[0], '');
        const amount = parseAmount(stripped) || 0;

        return {
            action     : 'TRANSFER_FUND',
            fromUserId : fromUserId || null,
            toUserId   : toUserId   || null,
            amount,
        };
    }

    // 2. CREATE_ADMIN
    if (isCreateAdmin) {
        const emailMatch = tl.match(/[a-z0-9._%+\-]+@[a-z0-9.\-]+\.[a-z]{2,}/i);
        const nameMatch  = t.match(/(?:naam|name)\s+([A-Za-z][A-Za-z\s]{1,30}?)(?:\s+email|\s+id|\s+pass|\s*$)/i);
        const passMatch  = t.match(/(?:password|pass|pwd)\s+([^\s]+)/i);

        const isDummy = /dummy|fake|test|sample|random/.test(tl);

        if (isDummy || (!nameMatch && !emailMatch)) {
            const d = makeDummy();
            return {
                action  : 'CREATE_ADMIN',
                name    : nameMatch ? nameMatch[1].trim() : d.name,
                email   : emailMatch ? emailMatch[0]      : d.email,
                password: passMatch  ? passMatch[1]       : d.password,
            };
        }

        return {
            action  : 'CREATE_ADMIN',
            name    : nameMatch  ? nameMatch[1].trim()    : 'admin',
            email   : emailMatch ? emailMatch[0]          : `admin${Date.now()}@example.com`,
            password: passMatch  ? passMatch[1]           : 'Admin@123',
        };
    }

    // 3. BLOCK_USER
    if (isBlock) {
        const userIdMatch = extractIdAfter(tl, /(?:user\s*id|user|id)/);
        return {
            action: 'BLOCK_USER',
            userId: userIdMatch ? userIdMatch.value : null,
        };
    }

    // 4. UNBLOCK_USER
    if (isUnblock) {
        const userIdMatch = extractIdAfter(tl, /(?:user\s*id|user|id)/);
        return {
            action: 'UNBLOCK_USER',
            userId: userIdMatch ? userIdMatch.value : null,
        };
    }

    // 5. ADD_FUND (flexible parsing - works with various formats)
    if (isAddWord) {
        const userIdMatch = extractIdAfter(tl, /(?:user\s*id|user|id)/);
        const textWithoutId = userIdMatch ? tl.replace(userIdMatch.fullMatch, '') : tl;
        const amount = parseAmount(textWithoutId);

        if (userIdMatch && amount !== null) {
            return {
                action: 'ADD_FUND',
                userId: userIdMatch.value,
                amount,
            };
        }

        // Fallback: if original logic didn't work, try extracting any numbers
        const allNumbers = [...tl.matchAll(/\b(\d+)\b/g)].map(m => parseInt(m[1], 10));
        if (allNumbers.length >= 2 && userIdMatch) {
            const userId = userIdMatch.value;
            const otherNum = allNumbers.find(n => n !== userId);
            if (otherNum) {
                return {
                    action: 'ADD_FUND',
                    userId,
                    amount: otherNum,
                };
            }
        }
    }

    // 6. UNKNOWN
    return { action: 'UNKNOWN', raw: rawText };
};

// ─────────────────────────────────────────────────────────────────────────────
// OPENAI PARSER
// ─────────────────────────────────────────────────────────────────────────────

const OPENAI_SYSTEM_PROMPT = `You are an AI command parser for a trading admin panel.
Users may give commands in Hindi, Hinglish, or English.
Your job is to detect INTENT first, then extract fields. Return structured JSON only — no extra text.

⚠️  IMPORTANT: Do NOT default to ADD_FUND. Detect the correct intent from the sentence.

Supported actions:
1. ADD_FUND      → requires userId + amount   → { "action": "ADD_FUND", "userId": <int>, "amount": <int> }
2. CREATE_ADMIN  → requires name + email      → { "action": "CREATE_ADMIN", "name": "<str>", "email": "<str>", "password": "<str>" }
3. BLOCK_USER    → requires userId            → { "action": "BLOCK_USER", "userId": <int> }
4. UNBLOCK_USER  → requires userId            → { "action": "UNBLOCK_USER", "userId": <int> }
5. TRANSFER_FUND → requires fromUserId + toUserId + amount → { "action": "TRANSFER_FUND", "fromUserId": <int>, "toUserId": <int>, "amount": <int> }

Examples:
Input : "ID 16 me 2000 add karo"
Output: { "action": "ADD_FUND", "userId": 16, "amount": 2000 }

Input : "add a admin with dummy credentials"
Output: { "action": "CREATE_ADMIN", "name": "dummy_admin", "email": "dummy@example.com", "password": "Admin@123" }

Input : "new admin banao naam Rahul email rahul@gmail.com"
Output: { "action": "CREATE_ADMIN", "name": "Rahul", "email": "rahul@gmail.com", "password": "Admin@123" }

Input : "user 10 block karo"
Output: { "action": "BLOCK_USER", "userId": 10 }

Input : "ID 12 ko unblock karo"
Output: { "action": "UNBLOCK_USER", "userId": 12 }

Input : "ID 10 se ID 20 me 500 transfer karo"
Output: { "action": "TRANSFER_FUND", "fromUserId": 10, "toUserId": 20, "amount": 500 }

Rules:
- Detect intent FIRST before extracting fields
- "add admin" / "create admin" / "admin banao" → always CREATE_ADMIN, never ADD_FUND
- ADD_FUND requires BOTH a numeric userId AND a numeric amount in the sentence
- If dummy/fake/test/sample is mentioned for admin → generate placeholder credentials
- Never return null — always use a meaningful default value
- Return valid JSON only, no extra text`;

const parseWithOpenAI = async (text) => {
    const OpenAI = require('openai');
    const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

    const completion = await openai.chat.completions.create({
        model: 'gpt-4o-mini',
        messages: [
            { role: 'system', content: OPENAI_SYSTEM_PROMPT },
            { role: 'user',   content: text },
        ],
        temperature: 0,
        response_format: { type: 'json_object' },
    });

    return JSON.parse(completion.choices[0].message.content);
};

// ─────────────────────────────────────────────────────────────────────────────
// MAIN PARSER ORCHESTRATOR
// ─────────────────────────────────────────────────────────────────────────────

/**
 * parseCommand(text) → structured JSON
 *
 * Orchestrates parsing:
 * 1. Try OpenAI if OPENAI_API_KEY is valid
 * 2. Fallback to rule-based parser if OpenAI fails or key is invalid
 * 3. Logs each step
 * 4. Rejects if action is UNKNOWN
 *
 * @param {string} text - Raw user input
 * @returns {Promise<object>} Parsed command: { action, ...fields }
 * @throws {Error} if action is UNKNOWN
 */
const parseCommand = async (text) => {
    const hasValidKey =
        process.env.OPENAI_API_KEY &&
        process.env.OPENAI_API_KEY.length > 30 &&
        !process.env.OPENAI_API_KEY.startsWith('sk-your') &&
        !process.env.OPENAI_API_KEY.includes('placeholder');

    let result;

    if (hasValidKey) {
        try {
            result = await parseWithOpenAI(text);
            console.log('[parseCommand] ✅ OpenAI parser success');
        } catch (err) {
            console.warn('[parseCommand] ⚠️  OpenAI parser failed:', err.message);
            console.log('[parseCommand] Falling back to rule-based parser');
            result = parseWithRules(text);
        }
    } else {
        console.log('[parseCommand] Using rule-based parser (no valid OPENAI_API_KEY)');
        result = parseWithRules(text);
    }

    // Check for unknown action
    if (result.action === 'UNKNOWN') {
        throw new Error('Command not understood. Try: "ID 16 me 5000 add karo" or "user 15 block karo"');
    }

    return result;
};

module.exports = { parseCommand };
