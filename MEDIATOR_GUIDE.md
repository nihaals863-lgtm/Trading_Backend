# Universal AI Mediator — Complete Guide

## Overview

The **Universal AI Mediator** is a powerful new system that sits between users and the database. It can understand **any command in any language** (Hindi, English, Hinglish) and autonomously execute the right database operations.

Unlike the previous smart-search system which only handled reads, the mediator:
- ✅ Reads data (db_read)
- ✅ Modifies data (db_write)
- ✅ Executes multi-step transactions (db_transaction)
- ✅ Supports multi-turn conversations with memory
- ✅ Uses OpenAI function calling with an agentic loop

---

## How It Works

### 1. User Sends a Command

```json
{
  "text": "rahul ko 1000 add karo aur ledger me note kar"
}
```

### 2. Mediator (AI) Analyzes

The mediator receives your message and:
- Understands the natural language intent
- Decides which tools (functions) are needed
- Generates parameterized SQL queries

### 3. Autonomous Execution (Agentic Loop)

The mediator calls tools in a loop:
- **Iteration 1**: Might call db_read to find "rahul"
- **Iteration 2**: Calls db_transaction to add funds AND log in ledger
- **Iteration 3+**: Continues if more steps needed

Each tool result is fed back to the AI to inform the next step.

### 4. Natural Language Response

```json
{
  "success": true,
  "message": "Successfully added ₹1000 to rahul's account. New balance: ₹26,000. Ledger entry created.",
  "iterations": 2,
  "toolResults": [...]
}
```

---

## Architecture

### Files Created/Modified

**New Files:**
- `src/services/aiMediator.js` — Main mediator logic with function calling
- `MEDIATOR_TESTS.md` — Test cases and examples
- `MEDIATOR_GUIDE.md` — This guide

**Modified Files:**
- `src/controllers/aiController.js` — Added mediatorCommand endpoint
- `src/routes/aiRoutes.js` — Added /mediate route

### Function Definitions

The mediator has **3 main tools** it can use:

#### 1. db_read
For SELECT queries. Example:
```json
{
  "name": "db_read",
  "sql": "SELECT id, name, balance FROM users WHERE name LIKE ?",
  "params": ["%rahul%"],
  "description": "Find user named rahul"
}
```

#### 2. db_write
For INSERT, UPDATE, DELETE. Example:
```json
{
  "name": "db_write",
  "sql": "UPDATE users SET balance = balance + ? WHERE id = ?",
  "params": [1000, 5],
  "description": "Add 1000 to user 5's balance"
}
```

#### 3. db_transaction
For multi-step operations that must all succeed or all rollback. Example:
```json
{
  "name": "db_transaction",
  "operations": [
    {
      "type": "write",
      "sql": "UPDATE users SET balance = balance + ? WHERE id = ?",
      "params": [1000, 5],
      "description": "Add funds to user 5"
    },
    {
      "type": "write",
      "sql": "INSERT INTO ledger (user_id, amount, type, balance_after) VALUES (?, ?, ?, ?)",
      "params": [5, 1000, "DEPOSIT", 26000],
      "description": "Log transaction in ledger"
    }
  ],
  "description": "Add 1000 to user 5 and log it"
}
```

---

## API Usage

### Endpoint

```
POST /api/ai/mediate
```

### Headers
```
Authorization: Bearer <jwt_token>
Content-Type: application/json
```

### Request Body

**Minimal:**
```json
{
  "text": "rahul ke trades dikhao"
}
```

**With Message History (for multi-turn):**
```json
{
  "text": "usko 5000 add kar do",
  "messageHistory": [
    { "role": "user", "content": "rahul ka balance kya hai" },
    { "role": "assistant", "content": "Rahul ke balance: ₹21,000" }
  ]
}
```

### Response

```json
{
  "success": true,
  "message": "Found 12 trades for rahul",
  "toolResults": [
    {
      "success": true,
      "rowCount": 12,
      "data": [...]
    }
  ],
  "iterations": 1,
  "messageHistory": [
    { "role": "user", "content": "rahul ke trades dikhao" },
    { "role": "assistant", "content": "..." }
  ]
}
```

---

## Example Conversations

### Example 1: Simple Query

**User:** "AKA ka balance dikhao"

**Mediator's Agentic Steps:**
1. Call db_read to find user named "AKA"
2. Return balance

**Response:** "AKA ke balance: ₹15,500"

---

### Example 2: Multi-Step Transaction

**User:** "ID 16 se 1000 nikaal ke ID 5 ko de do aur ledger me note kar"

**Mediator's Steps:**
1. Call db_transaction with 4 operations:
   - Deduct 1000 from user 16
   - Add 1000 to user 5
   - Log withdrawal for user 16
   - Log deposit for user 5
2. All succeed atomically or all rollback

**Response:** "Transfer successful. User 16's new balance: ₹24,000. User 5's new balance: ₹22,000"

---

### Example 3: Multi-Turn Conversation

**Turn 1:**
- **User:** "rahul ki saari details dikhao"
- **Mediator:** Finds rahul, returns name, email, balance, status, role
- **Response:** "Rahul (TRADER) | Balance: ₹21,000 | Status: Active | Email: rahul@example.com"

**Turn 2:**
- **User:** "usko block kar do" (him = rahul, from previous message)
- **Mediator:** Remembers rahul from history, blocks that user
- **Response:** "Rahul is now blocked"

---

## Comparison with Previous Systems

| Feature | Smart Search | Master Command | Mediator |
|---------|--------------|----------------|----------|
| **Read Operations** | ✅ | ✅ | ✅ |
| **Write Operations** | ❌ | ✅ | ✅ |
| **Transactions** | ❌ | ❌ | ✅ |
| **Multi-Turn Memory** | ❌ | ❌ | ✅ |
| **Language Support** | ✅ (Hindi/English) | ✅ | ✅ |
| **Tool Chaining** | ❌ | ❌ | ✅ |
| **Agentic Loop** | ❌ | ❌ | ✅ |

---

## Integration with Frontend

Currently, the mediator is implemented on the backend. To use it from the frontend:

### Option 1: Update Existing Search Component

Modify `src/services/searchController.js`:
```javascript
async function processMediatorCommand(text, messageHistory = []) {
  const response = await api.post('/api/ai/mediate', {
    text,
    messageHistory
  });
  return response.data;
}
```

### Option 2: Create New Mediator Hook

Create `src/hooks/useMediator.js`:
```javascript
import { useState } from 'react';
import api from '../utils/api';

export function useMediator() {
  const [messages, setMessages] = useState([]);

  const sendMessage = async (text) => {
    const response = await api.post('/api/ai/mediate', {
      text,
      messageHistory: messages
    });

    // Add to conversation history
    setMessages([
      ...messages,
      { role: 'user', content: text },
      { role: 'assistant', content: response.data.message }
    ]);

    return response.data;
  };

  return { messages, sendMessage };
}
```

---

## Error Handling

The mediator returns structured error responses:

```json
{
  "success": false,
  "message": "Could not find user named 'xyz'",
  "toolResults": [
    {
      "success": false,
      "error": "No results found"
    }
  ],
  "iterations": 1
}
```

---

## Performance Notes

- **Iterations**: Usually 1-3 iterations for complex operations
- **Response Time**: ~2-5 seconds (OpenAI call + DB operations)
- **Max Iterations**: Hard limit of 10 to prevent infinite loops
- **Token Usage**: ~500-1000 tokens per request to OpenAI

---

## Safety Features

✅ **Parameterized Queries**: All SQL uses ? placeholders (prevents SQL injection)
✅ **Transactions**: Multi-step operations either all succeed or all rollback
✅ **Auth Middleware**: All endpoints require JWT authentication
✅ **Max Iterations**: Prevents infinite loops
✅ **Error Recovery**: Tool errors are caught and reported, not thrown

---

## Testing Checklist

- [ ] Test simple read: "rahul ke trades dikhao"
- [ ] Test write: "user 5 ko block kar"
- [ ] Test transaction: "user 5 se 1000 nikaal ke user 10 ko de"
- [ ] Test multi-turn: Ask about user, then do operation on that user
- [ ] Test English: "Show user 5's balance"
- [ ] Test Hinglish: "user 5 ke balance dikhao"
- [ ] Test error: Send invalid command, verify error response

---

## Next Steps

1. **Test in Postman** — Use the example cURL requests
2. **Integrate into Frontend** — Add mediator hook to React components
3. **Add to Voice Commands** — Use mediator instead of separate parsers
4. **Monitor Logs** — Check backend console for iteration details
5. **Optimize Prompts** — Tweak DB_SCHEMA or system prompt if needed

---

## Support

For issues or questions:
1. Check the `MEDIATOR_TESTS.md` for example requests
2. Review backend console logs for detailed iteration steps
3. Verify JWT token is being sent correctly
4. Ensure DB_NAME and tables exist in MySQL

