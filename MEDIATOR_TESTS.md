# Universal AI Mediator — Test Cases

The `/api/ai/mediate` endpoint accepts any user input in any language and uses OpenAI's function calling to autonomously execute database operations.

## Key Features

✅ **Multi-Language Support**: Hindi, English, Hinglish all work
✅ **Function Calling**: Uses OpenAI tools (db_read, db_write, db_transaction)
✅ **Agentic Loop**: Autonomously calls tools until task is complete
✅ **Multi-Turn Conversations**: Optional messageHistory for context
✅ **Parameterized Queries**: All SQL uses ? placeholders
✅ **Transaction Support**: Multi-step operations with rollback

---

## Test Case 1: Simple Read Query

**Request:**
```json
{
  "text": "rahul ke trades dikhao"
}
```

**Flow:**
1. Mediator calls db_read to find user with name "rahul"
2. Gets userId from result
3. Calls db_read to fetch trades for that userId
4. Returns natural language response

**Response:**
```json
{
  "success": true,
  "message": "Found 5 trades for rahul: ...",
  "toolResults": [...],
  "iterations": 2,
  "messageHistory": [...]
}
```

---

## Test Case 2: Fund Addition with Transaction

**Request:**
```json
{
  "text": "user 16 ke balance me 5000 add karo"
}
```

**Flow:**
1. Mediator calls db_transaction with 2 operations:
   - UPDATE users balance
   - INSERT into ledger
2. Both operations execute atomically
3. Returns confirmation with new balance

**Response:**
```json
{
  "success": true,
  "message": "Successfully added 5000 to user 16. New balance: 25000",
  "toolResults": [...],
  "iterations": 1,
  "messageHistory": [...]
}
```

---

## Test Case 3: User Blocking

**Request:**
```json
{
  "text": "ID 5 ko block kar do"
}
```

**Flow:**
1. Mediator calls db_write to update user status
2. Returns success message

---

## Test Case 4: Multi-Turn Conversation

**Request 1:**
```json
{
  "text": "rahul ka balance kya hai",
  "messageHistory": []
}
```

**Response 1:**
```json
{
  "success": true,
  "message": "Rahul ke balance: ₹15,000",
  "messageHistory": [
    { "role": "user", "content": "rahul ka balance kya hai" },
    { "role": "assistant", "content": "..." }
  ]
}
```

**Request 2 (with history):**
```json
{
  "text": "usko 2000 add kar do",
  "messageHistory": [
    { "role": "user", "content": "rahul ka balance kya hai" },
    { "role": "assistant", "content": "..." }
  ]
}
```

The mediator remembers "rahul" from the previous message and adds 2000 to his balance.

---

## Test Case 5: Complex Multi-Step Operation

**Request:**
```json
{
  "text": "user 5 se 1000 nikaal ke user 10 ke liye add kar do"
}
```

**Flow:**
1. Mediator calls db_transaction with 4 operations:
   - Deduct from user 5 balance
   - Add to user 10 balance
   - Insert withdrawal ledger for user 5
   - Insert deposit ledger for user 10
2. All 4 operations succeed atomically or all rollback
3. Returns transfer confirmation

---

## API Endpoint

**POST** `/api/ai/mediate`

**Headers:**
```
Authorization: Bearer <token>
Content-Type: application/json
```

**Body:**
```json
{
  "text": "Your command in any language",
  "messageHistory": [
    { "role": "user", "content": "previous question" },
    { "role": "assistant", "content": "previous response" }
  ]
}
```

**Response Format:**
```json
{
  "success": true|false,
  "message": "Natural language response",
  "toolResults": [
    {
      "success": true,
      "rowCount": 5,
      "data": [...]
    }
  ],
  "iterations": 1,
  "messageHistory": [...]
}
```

---

## Example cURL Requests

```bash
# Simple query
curl -X POST http://localhost:5000/api/ai/mediate \
  -H "Authorization: Bearer YOUR_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "text": "rahul ke trades dikhao"
  }'

# Add funds
curl -X POST http://localhost:5000/api/ai/mediate \
  -H "Authorization: Bearer YOUR_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "text": "user 16 me 5000 add karo"
  }'

# Block user
curl -X POST http://localhost:5000/api/ai/mediate \
  -H "Authorization: Bearer YOUR_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "text": "ID 5 ko block kar do"
  }'
```

---

## Notes

- **Message History**: Optional. Include previous messages for multi-turn context.
- **Max Iterations**: Mediator runs max 10 iterations to prevent infinite loops.
- **Tool Results**: Each tool call's result is added to the conversation so AI can see what happened.
- **Errors**: If any tool fails, the error is returned in the response.
- **Language**: Works with Hindi, English, Hinglish, or any mix.

