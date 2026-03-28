/**
 * AI Controller — Main API for the Smart AI-Driven System
 *
 * Endpoints:
 *   POST /api/ai/smart-command   → Full pipeline: parse → generate → execute → respond
 *   POST /api/ai/ai-command      → Legacy unified endpoint (backward compat)
 *   POST /api/ai/schema          → Get database schema summary
 *   POST /api/ai/parse-only      → Parse without executing (for preview)
 *
 * All legacy endpoints still work for backward compatibility.
 */

const db = require('../config/db');
const openai = require('../config/openai');
const { parseQuery } = require('../services/aiCommandParser');
const { generateQuery } = require('../services/aiQueryGenerator');
const { executeQuery } = require('../services/aiExecutor');
const { loadSchema, getSchemaSummary } = require('../services/aiSchemaLoader');
const { processMasterCommand } = require('../services/aiMasterPrompt');
const { executeMasterCommand } = require('../services/aiMasterExecutor');
const { mediate } = require('../services/aiMediator');

// Legacy imports (backward compat)
const { parseCommand: legacyParseCommand } = require('../services/aiService');
const { executeAction: legacyExecuteAction } = require('../services/dbService');

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/ai/smart-command
// THE MAIN ENDPOINT — Natural Language → Database Action Engine
// ─────────────────────────────────────────────────────────────────────────────

const smartCommand = async (req, res) => {
    const { text } = req.body;
    const reqUser = req.user || {};

    console.log('\n═══════════════════════════════════════════════════════════════');
    console.log('[smart-command] 📝 Input:', text);
    console.log('[smart-command] 👤 User:', reqUser.full_name || reqUser.id || 'anonymous');
    console.log('═══════════════════════════════════════════════════════════════');

    // ── Step 0: Validate ────────────────────────────────────────────────────
    if (!text || !text.trim()) {
        return res.status(400).json({
            type: 'error',
            message: 'text is required',
            data: [],
            meta: {},
        });
    }

    try {
        // ── Step 1: Load Schema (cached) ────────────────────────────────────
        console.log('[smart-command] 📊 Loading schema...');
        await loadSchema();

        // ── Step 2: Parse Command ───────────────────────────────────────────
        console.log('[smart-command] 🤖 Parsing command...');
        const parsed = await parseCommand(text.trim());
        console.log('[smart-command] ✅ Parsed:', JSON.stringify(parsed, null, 2));

        // ── Step 3: Generate Query ──────────────────────────────────────────
        console.log('[smart-command] 🔧 Generating query...');
        const query = await generateQuery(parsed);
        console.log('[smart-command] ✅ Query:', JSON.stringify({
            type: query.type,
            sql: query.sql || '(composite operation)',
            params: query.params,
        }));

        // ── Step 4: Execute ─────────────────────────────────────────────────
        console.log('[smart-command] ▶️  Executing...');
        const result = await executeQuery(query, parsed, reqUser);
        console.log('[smart-command] ✅ Result:', result.message);

        // ── Step 5: Return ──────────────────────────────────────────────────
        console.log('[smart-command] 🎉 Done');
        console.log('═══════════════════════════════════════════════════════════════\n');

        return res.json({
            success: result.type !== 'error',
            ...result,
            parsed: {
                module: parsed.module,
                operation: parsed.operation,
                filters: parsed.filters,
                route: parsed.route,
            },
        });

    } catch (err) {
        console.error('[smart-command] ❌ Error:', err.message);
        return res.status(500).json({
            type: 'error',
            message: err.message || 'AI command failed',
            data: [],
            meta: { module: 'system' },
        });
    }
};

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/ai/parse-only
// Parse without executing — for command preview / confirmation UI
// ─────────────────────────────────────────────────────────────────────────────

const parseOnly = async (req, res) => {
    const { text } = req.body;

    if (!text || !text.trim()) {
        return res.status(400).json({ success: false, message: 'text is required' });
    }

    try {
        await loadSchema();
        const parsed = await parseCommand(text.trim());
        const query = await generateQuery(parsed);

        return res.json({
            success: true,
            parsed,
            query: {
                type: query.type,
                sql: query.sql || null,
                table: query.table || null,
                error: query.error || null,
            },
        });
    } catch (err) {
        return res.status(500).json({ success: false, message: err.message });
    }
};

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/ai/schema
// Returns database schema summary (for debugging/admin tools)
// ─────────────────────────────────────────────────────────────────────────────

const getSchema = async (req, res) => {
    try {
        const summary = await getSchemaSummary();
        return res.json({ success: true, schema: summary });
    } catch (err) {
        return res.status(500).json({ success: false, message: err.message });
    }
};

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/ai/master-command
// ADVANCED: Uses comprehensive master prompt (single OpenAI call)
// Returns execution-ready JSON with SQL queries
// ─────────────────────────────────────────────────────────────────────────────

const masterCommand = async (req, res) => {
    const { text } = req.body;
    const reqUser = req.user || {};

    console.log('\n═══════════════════════════════════════════════════════════════');
    console.log('[master-command] 🧠 Input:', text);
    console.log('[master-command] 👤 User:', reqUser.full_name || reqUser.id || 'anonymous');
    console.log('═══════════════════════════════════════════════════════════════');

    if (!text || !text.trim()) {
        return res.status(400).json({
            success: false,
            message: 'text is required',
        });
    }

    try {
        // Step 1: Process through master prompt
        console.log('[master-command] 🧠 Processing through master AI...');
        const masterOutput = await processMasterCommand(text.trim(), {
            id: reqUser.id,
            role: reqUser.role,
            full_name: reqUser.full_name,
        });

        console.log('[master-command] ✅ Master output:', JSON.stringify({
            module: masterOutput.intent?.module,
            operation: masterOutput.intent?.operation,
            executionType: masterOutput.execution?.type,
        }));

        // Step 2: Execute the plan
        console.log('[master-command] ▶️  Executing...');
        const execResult = await executeMasterCommand(masterOutput, reqUser);

        console.log('[master-command] ✅ Execution result:', execResult.message);
        console.log('═══════════════════════════════════════════════════════════════\n');

        return res.json({
            success: execResult.success,
            ...execResult,
            intent: masterOutput.intent,
            ui: masterOutput.ui,
        });

    } catch (err) {
        console.error('[master-command] ❌ Error:', err.message);
        return res.status(500).json({
            success: false,
            message: err.message || 'Master command failed',
        });
    }
};

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/ai/mediate
// UNIVERSAL AI MEDIATOR — Handles ANY user input in ANY language
// Supports multi-turn conversations with message history
// ─────────────────────────────────────────────────────────────────────────────

const mediatorCommand = async (req, res) => {
    const { text, messageHistory = [] } = req.body;
    const reqUser = req.user || {};

    console.log('\n═══════════════════════════════════════════════════════════════');
    console.log('[mediator] 🤝 Input:', text);
    console.log('[mediator] 👤 User:', reqUser.full_name || reqUser.id || 'anonymous');
    console.log('[mediator] 📜 History length:', messageHistory.length);
    console.log('═══════════════════════════════════════════════════════════════');

    if (!text || !text.trim()) {
        return res.status(400).json({
            success: false,
            message: 'text is required',
        });
    }

    try {
        const result = await mediate(text.trim(), messageHistory);

        console.log('[mediator] ✅ Completed in', result.iterations, 'iterations');
        console.log('═══════════════════════════════════════════════════════════════\n');

        return res.json({
            success: result.success,
            message: result.message,
            toolResults: result.toolResults,
            iterations: result.iterations,
            messageHistory: result.messageHistory,
        });

    } catch (err) {
        console.error('[mediator] ❌ Error:', err.message);
        return res.status(500).json({
            success: false,
            message: err.message || 'Mediator failed',
        });
    }
};

// ─────────────────────────────────────────────────────────────────────────────
// LEGACY: POST /api/ai/ai-command (kept for backward compatibility)
// Routes through NEW system but returns OLD format
// ─────────────────────────────────────────────────────────────────────────────

const aiCommand = async (req, res) => {
    const { text } = req.body;

    console.log('\n═══════════════════════════════════════════════════════════════');
    console.log('[ai-command] 📝 User Input:', text);
    console.log('═══════════════════════════════════════════════════════════════');

    if (!text || !text.trim()) {
        return res.status(400).json({ success: false, message: 'text is required' });
    }

    try {
        // Try new smart system first
        await loadSchema();
        const parsed = await parseCommand(text.trim());
        const query = await generateQuery(parsed);
        const result = await executeQuery(query, parsed, req.user || {});

        return res.json({
            success: result.type !== 'error',
            action: `${parsed.operation}`.toUpperCase(),
            ...result,
        });
    } catch (err) {
        // Fallback to legacy system
        console.warn('[ai-command] Smart system failed, trying legacy:', err.message);
        try {
            const legacyParsed = await legacyParseCommand(text);
            const legacyResult = await legacyExecuteAction(legacyParsed);
            return res.json({ success: true, action: legacyParsed.action, ...legacyResult });
        } catch (legacyErr) {
            return res.status(500).json({ success: false, message: legacyErr.message });
        }
    }
};

// ─────────────────────────────────────────────────────────────────────────────
// LEGACY ENDPOINTS (unchanged for backward compatibility)
// ─────────────────────────────────────────────────────────────────────────────

const bcryptLib = require('bcryptjs');

const makeDummy = () => {
    const adj = ['quick', 'smart', 'bold', 'swift', 'prime'][Math.floor(Math.random() * 5)];
    const noun = ['admin', 'trader', 'broker', 'agent', 'user'][Math.floor(Math.random() * 5)];
    const num = Math.floor(Math.random() * 900) + 100;
    return { name: `${adj}_${noun}`, email: `${adj}.${noun}${num}@example.com`, password: `Pass${num}@!` };
};

// ── POST /api/ai/voice-command ──────────────────────────────────────────────

const processVoiceCommand = async (req, res) => {
    const { command } = req.body;
    try {
        let response = "I didn't quite catch that. Try 'Active trades' or 'My balance'.";
        if (command.toLowerCase().includes('balance')) {
            const [rows] = await db.execute('SELECT balance FROM users WHERE id = ?', [req.user.id]);
            response = `Your current balance is ${rows[0].balance}`;
        } else if (command.toLowerCase().includes('trades')) {
            const [rows] = await db.execute('SELECT COUNT(*) as count FROM trades WHERE user_id = ? AND status = "OPEN"', [req.user.id]);
            response = `You have ${rows[0].count} active trades.`;
        }
        res.json({ text: response });
    } catch (err) {
        res.status(500).send('AI Engine Error');
    }
};

// ── POST /api/ai/ai-parse (legacy) ─────────────────────────────────────────

const aiParse = async (req, res) => {
    const { text } = req.body;

    if (!text || !text.trim()) {
        return res.status(400).json({ message: 'text is required' });
    }

    try {
        // Use new parser
        const parsed = await parseCommand(text.trim());

        // Add backward-compatible fields so legacy UI (VoiceModulationPage) can display summary
        const compat = { ...parsed };
        if (!compat.action) {
            const opMap = {
                add_fund: 'ADD_FUND', withdraw: 'WITHDRAW', transfer: 'TRANSFER_FUND',
                block: 'BLOCK_USER', unblock: 'UNBLOCK_USER', create: 'CREATE_USER',
                read: 'READ', aggregate: 'AGGREGATE', update: 'UPDATE', delete: 'DELETE',
            };
            compat.action = opMap[parsed.operation] || parsed.operation?.toUpperCase() || 'READ';
        }
        if ((parsed.filters?.userId || parsed.filters?.id) && !compat.userId) compat.userId = parsed.filters.userId || parsed.filters.id;
        if (parsed.data?.amount && !compat.amount) compat.amount = parsed.data.amount;
        if (parsed.data?.fromUserId) compat.fromUserId = parsed.data.fromUserId;
        if (parsed.data?.toUserId) compat.toUserId = parsed.data.toUserId;
        if (parsed.data?.name) compat.name = parsed.data.name;
        if (parsed.data?.email) compat.email = parsed.data.email;

        return res.json(compat);
    } catch (err) {
        console.error('[aiParse] Error:', err.message);
        return res.status(422).json({
            message: 'Please rephrase your command',
            error: err.message,
            displayMessage: 'Please rephrase your command or explain it differently',
        });
    }
};

// ── POST /api/ai/smart-search — Smart search with AI parsing ─────────────────

const smartSearch = async (req, res) => {
    const q = req.body.query || req.body.text;

    try {
        if (!q || !q.toString().trim()) {
            return res.status(400).json({ success: false, message: 'Query is required' });
        }

        // --- Fast lexical shortcuts for simple trade queries (bypass AI) ---
        try {
            const lowerQ = q.toString().toLowerCase();
            if (lowerQ.includes('trade') || lowerQ.includes('trades')) {
                // closed trades
                if (lowerQ.includes('closed')) {
                    const [rows] = await db.execute("SELECT * FROM trades WHERE status = 'CLOSED' LIMIT 50");
                    return res.json({ success: true, data: rows, count: Array.isArray(rows) ? rows.length : 0, query: "SELECT * FROM trades WHERE status = 'CLOSED' LIMIT 50" });
                }
                // active trades (map to OPEN in DB)
                if (lowerQ.includes('active')) {
                    const [rows] = await db.execute("SELECT * FROM trades WHERE status = 'OPEN' LIMIT 50");
                    return res.json({ success: true, data: rows, count: Array.isArray(rows) ? rows.length : 0, query: "SELECT * FROM trades WHERE status = 'OPEN' LIMIT 50" });
                }
                // buy trades
                if (lowerQ.includes('buy')) {
                    const [rows] = await db.execute("SELECT * FROM trades WHERE type = 'BUY' LIMIT 50");
                    return res.json({ success: true, data: rows, count: Array.isArray(rows) ? rows.length : 0, query: "SELECT * FROM trades WHERE type = 'BUY' LIMIT 50" });
                }
                // sell trades
                if (lowerQ.includes('sell')) {
                    const [rows] = await db.execute("SELECT * FROM trades WHERE type = 'SELL' LIMIT 50");
                    return res.json({ success: true, data: rows, count: Array.isArray(rows) ? rows.length : 0, query: "SELECT * FROM trades WHERE type = 'SELL' LIMIT 50" });
                }
            }
        } catch (lexErr) {
            console.warn('[smartSearch] lexical shortcut error:', lexErr && lexErr.message ? lexErr.message : lexErr);
        }

                // Load DB schema and pass to parser so AI uses real columns
                let simpleSchema = {};
                try {
                    const fullSchema = await loadSchema();
                    for (const [tbl, info] of Object.entries(fullSchema || {})) {
                        if (info && info.columnNames) simpleSchema[tbl] = info.columnNames;
                        else if (Array.isArray(info)) simpleSchema[tbl] = info;
                        else if (info && info.columns) simpleSchema[tbl] = info.columns.map(c => c.name);
                        else simpleSchema[tbl] = Object.keys(info || {});
                    }
                } catch (e) {
                    console.warn('[smartSearch] Could not load schema for injection:', e.message || e);
                }

                // ✅ AI se direct SQL lo (also get raw AI output)
                const { sql: aiSql, raw } = await parseQuery(q.toString(), simpleSchema);

        console.log('AI RAW OUTPUT:', raw);

        // Clean: remove markdown fences (```sql, ```) and any leading/trailing text
        let source = (raw || aiSql || '').toString();
        source = source.replace(/```\s*sql/gi, '');
        source = source.replace(/```/g, '');
        source = source.trim();

        // Remove any leading text before the first SELECT
        let sql = source;
        const selectIndex = source.toLowerCase().indexOf('select');
        if (selectIndex !== -1) {
            sql = source.substring(selectIndex).trim();
        }

        console.log('AI SQL (cleaned):', sql);

        // --- Auto-fix common column/name mismatches before validation/execution ---
        try {
            // replace legacy or guessed names
            sql = sql.replace(/profit_loss/gi, 'pnl');
            sql = sql.replace(/\bbalance\b/gi, 'margin_used');

            // normalize status values to match DB (OPEN/CLOSED)
            sql = sql.replace(/'active'/gi, "'OPEN'");
            sql = sql.replace(/'closed'/gi, "'CLOSED'");

            // Ensure LIMIT 50
            if (!/\blimit\b/i.test(sql)) {
                sql = sql.replace(/;?\s*$/g, '');
                sql = sql + ' LIMIT 50';
            }
        } catch (fixErr) {
            console.warn('[smartSearch] sql auto-fix failed:', fixErr && fixErr.message ? fixErr.message : fixErr);
        }

        // 🔐 VALIDATION
        if (!sql.toLowerCase().startsWith('select')) {
            console.log('INVALID SQL FROM AI:', sql);
            return res.status(400).json({
                success: false,
                message: 'AI did not generate valid SELECT query',
                aiOutput: raw || aiSql || sql,
            });
        }

        const blocked = ['DROP', 'DELETE', 'UPDATE', 'INSERT'];
        for (let word of blocked) {
            if (sql.toUpperCase().includes(word)) {
                console.log('UNSAFE SQL DETECTED from AI:', sql);
                return res.status(400).json({ success: false, message: 'Unsafe query detected', aiOutput: raw || aiSql || sql });
            }
        }

        // ✅ EXECUTE QUERY (with SQL error handling)
        try {
            const [rows] = await db.execute(sql);
            return res.json({
                success: true,
                data: rows,
                count: Array.isArray(rows) ? rows.length : 0,
                query: sql,
            });
        } catch (execErr) {
            console.error('SQL EXECUTION ERROR:', execErr.message, 'SQL:', sql);
            return res.status(400).json({
                success: false,
                message: 'Invalid column or SQL error from AI-generated query',
                error: execErr.message,
                sql,
                aiOutput: raw || aiSql,
            });
        }
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// ── POST /api/ai/execute-command (legacy) ───────────────────────────────────

const executeVoiceCommand = async (req, res) => {
    const { action, userId, amount, fromUserId, toUserId, name, email, password } = req.body;

    // ── New format detection: if body has module+operation (from new parser), route through smart system
    const LEGACY_ACTIONS = ['ADD_FUND', 'BLOCK_USER', 'UNBLOCK_USER', 'CREATE_ADMIN', 'TRANSFER_FUND'];
    if (req.body.module && req.body.operation && (!action || !LEGACY_ACTIONS.includes(action))) {
        console.log('[execute-command] Detected new format, routing through smart system');
        try {
            await loadSchema();
            const query = await generateQuery(req.body);
            const result = await executeQuery(query, req.body, req.user || {});
            return res.json({ success: result.type !== 'error', ...result });
        } catch (err) {
            return res.status(500).json({ success: false, message: err.message });
        }
    }

    if (!action) {
        return res.status(400).json({ success: false, message: 'action is required' });
    }

    const connection = await db.getConnection();

    try {
        await connection.beginTransaction();

        if (action === 'ADD_FUND') {
            if (!userId || amount == null) {
                await connection.rollback();
                return res.status(400).json({ success: false, message: 'userId and amount are required' });
            }
            const amt = parseFloat(amount);
            if (isNaN(amt) || amt <= 0) {
                await connection.rollback();
                return res.status(400).json({ success: false, message: 'amount must be positive' });
            }
            const [rows] = await connection.execute('SELECT id, balance FROM users WHERE id = ?', [userId]);
            if (!rows.length) { await connection.rollback(); return res.status(404).json({ success: false, message: `User ${userId} not found` }); }
            const newBalance = parseFloat(rows[0].balance || 0) + amt;
            await connection.execute('UPDATE users SET balance = balance + ? WHERE id = ?', [amt, userId]);
            await connection.execute('INSERT INTO ledger (user_id, amount, type, balance_after, remarks) VALUES (?, ?, ?, ?, ?)', [userId, amt, 'DEPOSIT', newBalance, 'Voice command: ADD_FUND']);
            await connection.commit();
            return res.json({ success: true, message: 'Fund added successfully', userId, amountAdded: amt, newBalance });
        }

        if (action === 'BLOCK_USER') {
            if (!userId) { await connection.rollback(); return res.status(400).json({ success: false, message: 'userId is required' }); }
            const [rows] = await connection.execute('SELECT id FROM users WHERE id = ?', [userId]);
            if (!rows.length) { await connection.rollback(); return res.status(404).json({ success: false, message: `User ${userId} not found` }); }
            await connection.execute("UPDATE users SET status = 'Suspended' WHERE id = ?", [userId]);
            await connection.commit();
            return res.json({ success: true, message: `User ${userId} blocked successfully` });
        }

        if (action === 'UNBLOCK_USER') {
            if (!userId) { await connection.rollback(); return res.status(400).json({ success: false, message: 'userId is required' }); }
            const [rows] = await connection.execute('SELECT id FROM users WHERE id = ?', [userId]);
            if (!rows.length) { await connection.rollback(); return res.status(404).json({ success: false, message: `User ${userId} not found` }); }
            await connection.execute("UPDATE users SET status = 'Active' WHERE id = ?", [userId]);
            await connection.commit();
            return res.json({ success: true, message: `User ${userId} unblocked successfully` });
        }

        if (action === 'CREATE_ADMIN') {
            if (!name || !email) { await connection.rollback(); return res.status(400).json({ success: false, message: 'name and email required' }); }
            const username = `${name.toLowerCase().replace(/\s+/g, '_')}_${Date.now().toString().slice(-5)}`;
            const [dup] = await connection.execute('SELECT id FROM users WHERE email = ?', [email]);
            if (dup.length) { await connection.rollback(); return res.status(409).json({ success: false, message: `Email ${email} already exists` }); }
            const plainPass = password || `Admin@${Math.floor(Math.random() * 9000) + 1000}`;
            const hashed = await bcryptLib.hash(plainPass, 10);
            const [result] = await connection.execute(`INSERT INTO users (username, password, full_name, email, role, status, balance, credit_limit) VALUES (?, ?, ?, ?, 'ADMIN', 'Active', 0, 0)`, [username, hashed, name, email]);
            await connection.commit();
            return res.json({ success: true, message: 'Admin created', adminId: result.insertId, username, name, email, password: plainPass });
        }

        if (action === 'TRANSFER_FUND') {
            if (!fromUserId || !toUserId || amount == null) { await connection.rollback(); return res.status(400).json({ success: false, message: 'fromUserId, toUserId and amount required' }); }
            const amt = parseFloat(amount);
            const [fromRows] = await connection.execute('SELECT id, balance FROM users WHERE id = ? FOR UPDATE', [fromUserId]);
            if (!fromRows.length) { await connection.rollback(); return res.status(404).json({ success: false, message: `Source user ${fromUserId} not found` }); }
            const [toRows] = await connection.execute('SELECT id, balance FROM users WHERE id = ? FOR UPDATE', [toUserId]);
            if (!toRows.length) { await connection.rollback(); return res.status(404).json({ success: false, message: `Dest user ${toUserId} not found` }); }
            const fromBal = parseFloat(fromRows[0].balance || 0);
            if (fromBal < amt) { await connection.rollback(); return res.status(400).json({ success: false, message: `Insufficient balance` }); }
            const newFrom = fromBal - amt;
            const newTo = parseFloat(toRows[0].balance || 0) + amt;
            await connection.execute('UPDATE users SET balance = balance - ? WHERE id = ?', [amt, fromUserId]);
            await connection.execute('UPDATE users SET balance = balance + ? WHERE id = ?', [amt, toUserId]);
            await connection.execute('INSERT INTO ledger (user_id, amount, type, balance_after, remarks) VALUES (?, ?, ?, ?, ?)', [fromUserId, amt, 'WITHDRAW', newFrom, `Transfer to user ${toUserId}`]);
            await connection.execute('INSERT INTO ledger (user_id, amount, type, balance_after, remarks) VALUES (?, ?, ?, ?, ?)', [toUserId, amt, 'DEPOSIT', newTo, `Transfer from user ${fromUserId}`]);
            await connection.commit();
            return res.json({ success: true, message: `₹${amt} transferred`, fromUserId, toUserId, amount: amt, fromBalance: newFrom, toBalance: newTo });
        }

        await connection.rollback();
        return res.status(400).json({ success: false, message: `Unknown action: "${action}"` });

    } catch (err) {
        await connection.rollback();
        return res.status(500).json({ success: false, message: err.message });
    } finally {
        connection.release();
    }
};

// ── POST /api/ai/voice-execute (legacy) ─────────────────────────────────────

const voiceExecute = async (req, res) => {
    const { text } = req.body;

    if (!text || !text.trim()) {
        return res.status(400).json({ success: false, message: 'text is required' });
    }

    // Route through smart system
    req.body.text = text;
    return smartCommand(req, res);
};

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/ai/chat
// General AI Chat Endpoint — For conversational queries (not command execution)
// Uses OpenAI ChatGPT API for natural language responses
// ─────────────────────────────────────────────────────────────────────────────

const chatWithAI = async (req, res) => {
    const { message } = req.body;
    const reqUser = req.user || {};

    console.log('\n═══════════════════════════════════════════════════════════════');
    console.log('[chat] 💬 Input:', message);
    console.log('[chat] 👤 User:', reqUser.full_name || reqUser.id || 'anonymous');
    console.log('═══════════════════════════════════════════════════════════════');

    if (!message || !message.trim()) {
        return res.status(400).json({
            success: false,
            message: 'Message is required',
        });
    }

    try {
        // System prompt for trading app assistant with multilingual support
        const systemPrompt = `You are an AI Assistant for a stock trading mobile app called VTRKM.

🌍 LANGUAGE SUPPORT:
- English (English)
- Hindi (हिंदी)
- Hinglish (Mix of Hindi + English)
- Marathi (मराठी)

📱 APP FEATURES:
- Buy/Sell stocks
- View portfolio
- View trades
- Navigate pages (watchlist, trades, portfolio, account)
- Real-time market data

🤖 GUIDELINES:
1. **LANGUAGE DETECTION**: Identify the user's language automatically
2. **SAME LANGUAGE RESPONSE**: Always reply in the EXACT same language the user used
   - If they use English → respond in English
   - If they use Hindi → respond in Hindi (हिंदी)
   - If they use Hinglish → respond in Hinglish (English words + Hindi script)
   - If they use Marathi → respond in Marathi (मराठी)
3. **CONTENT QUALITY**:
   - Be helpful, concise, and friendly
   - Answer trading-related questions
   - Provide market insights and education
   - Suggest how to use app features
4. **IMPORTANT DISCLAIMER**:
   - Never give financial advice
   - Always remind users to do their own research
   - No guaranteed predictions
5. **TONE**: Encouraging, supportive, professional`;

        const response = await openai.chat.completions.create({
            model: 'gpt-4o-mini',
            messages: [
                {
                    role: 'system',
                    content: systemPrompt,
                },
                {
                    role: 'user',
                    content: message.trim(),
                },
            ],
            temperature: 0.7,
            max_tokens: 500,
        });

        const aiMessage = response.choices[0]?.message?.content || 'Sorry, I could not generate a response.';

        console.log('[chat] ✅ Response generated');
        console.log('═══════════════════════════════════════════════════════════════\n');

        return res.json({
            success: true,
            message: aiMessage,
            user: reqUser.full_name || reqUser.id || 'User',
        });

    } catch (err) {
        console.error('[chat] ❌ Error:', err.message);
        return res.status(500).json({
            success: false,
            message: err.message || 'Failed to get AI response',
        });
    }
};

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/ai/transcribe-voice — Convert voice audio to text using Whisper API
// ─────────────────────────────────────────────────────────────────────────────

const transcribeVoice = async (req, res) => {
    const reqUser = req.user || {};

    console.log('\n═══════════════════════════════════════════════════════════════');
    console.log('[transcribe-voice] 🎙️  Transcribing audio...');
    console.log('[transcribe-voice] 👤 User:', reqUser.full_name || reqUser.id || 'anonymous');
    console.log('═══════════════════════════════════════════════════════════════');

    if (!req.file) {
        return res.status(400).json({
            success: false,
            message: 'Audio file is required',
        });
    }

    try {
        const audioBuffer = req.file.buffer;
        const fileName = req.file.originalname || 'audio.wav';

        // Call OpenAI Whisper API to transcribe
        const transcript = await openai.audio.transcriptions.create({
            file: new File([audioBuffer], fileName, { type: 'audio/wav' }),
            model: 'whisper-1',
            language: 'en', // or auto-detect if needed
        });

        const transcribedText = transcript.text || '';

        console.log('[transcribe-voice] ✅ Transcript:', transcribedText);
        console.log('═══════════════════════════════════════════════════════════════\n');

        return res.json({
            success: true,
            transcript: transcribedText,
            language: 'en',
        });

    } catch (err) {
        console.error('[transcribe-voice] ❌ Error:', err.message);
        return res.status(500).json({
            success: false,
            message: err.message || 'Failed to transcribe audio',
        });
    }
};

module.exports = {
    smartCommand,
    masterCommand,
    mediatorCommand,
    parseOnly,
    getSchema,
    aiCommand,
    processVoiceCommand,
    aiParse,
    smartSearch,
    executeVoiceCommand,
    voiceExecute,
    chatWithAI,
    transcribeVoice,
};
