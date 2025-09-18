# Splid MCP Server

A Model Context Protocol (MCP) server that exposes Splid (splid.app) via tools, powered by the reverse‑engineered `splid-js` client.

- Language/Runtime: Node.js (ESM) + TypeScript
- Transport: Streamable HTTP (and stdio for local inspector)
- License: MIT

## Quick start

1) Install

```bash
npm install
```

2) Configure env

Create a `.env` in project root:

```
CODE=YOUR_SPLID_INVITE_CODE
PORT=8000
```

3) Build and run

```bash
npm run build
npm run dev
```

4) Inspect locally

```bash
npm run inspect
```

Then connect to `http://localhost:8000/mcp` using "Streamable HTTP".

## Tools

All tools support an optional group selector to override the default from `CODE`:
- `groupId?: string`
- `groupCode?: string` (invite code)
- `groupName?: string` (reserved; not yet supported)

If none provided, the server uses the default group from `CODE`.

### health
- Purpose: connectivity check
- Output: `{ ok: true }`

### whoami
- Purpose: show the currently selected group and its members
- Input: none
- Output: JSON containing group info and members

### createExpense
- Purpose: create a new expense entry
- Input:
  - `title: string`
  - `amount: number > 0`
  - `currencyCode?: string` (defaults to the group default when omitted)
  - `payers: { userId?: string; name?: string; amount: number > 0 }[]` (at least 1)
  - `profiteers: { userId?: string; name?: string; share: number in (0,1] }[]` (at least 1)
  - Optional group selector fields
- Rules:
  - Names are case‑insensitive and resolved to member GlobalId; unknown names return a clear error.
  - The sum of all `share` values must equal 1 (±1e‑6).
- Example (names):
```json
{
  "title": "Dinner",
  "amount": 12.5,
  "payers": [{ "name": "Alice", "amount": 12.5 }],
  "profiteers": [{ "name": "Bob", "share": 0.6 }, { "name": "Alice", "share": 0.4 }]
}
```
- Example (userIds):
```json
{
  "title": "Dinner",
  "amount": 12.5,
  "payers": [{ "userId": "<GlobalId>", "amount": 12.5 }],
  "profiteers": [{ "userId": "<GlobalId>", "share": 1 }]
}
```

### listEntries
- Purpose: list recent entries in a group
- Input:
  - `limit?: number` (1..100, default 20)
  - Optional group selector fields
- Output: array of entries

### getGroupSummary
- Purpose: show balances/summary for a group
- Input:
  - Optional group selector fields
- Output: summary object (balances computed via Splid)

### Streamable HTTP
- URL: `http://localhost:8000/mcp`
- No auth headers required; use MCP Inspector to test.

## Troubleshooting
- "Bad Request: Server not initialized": refresh and reconnect; first POST must be `initialize`.
- 400 with share errors: ensure shares are in (0,1] and sum to 1.
- Unknown name: check exact member names in `whoami` output.

## Configuration
- Env variables:
  - `CODE`: Splid invite/join code for the default group
  - `PORT` (optional): default 8000

## Acknowledgements
- Splid JS client: https://github.com/LinusBolls/splid-js
- MCP Server template / docs: https://github.com/InteractionCo/mcp-server-template

## License
MIT
