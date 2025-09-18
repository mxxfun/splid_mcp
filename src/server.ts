import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import { randomUUID } from 'node:crypto';
import { SplidClient } from 'splid-js';
import { buildMcpServer, type SplidApi } from './mcp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { isInitializeRequest } from '@modelcontextprotocol/sdk/types.js';

const PORT = Number(process.env.PORT ?? 8000);
const CODE = process.env.CODE;

if (!CODE) {
  console.error('Missing CODE env');
  process.exit(1);
}

const splidClient = new SplidClient({ code: CODE });

const splidApi: SplidApi = {
  async getDefaultGroup() {
    const joined = await splidClient.group.getByInviteCode(CODE as string);
    const groupId = joined.result.objectId;
    const info = await splidClient.groupInfo.getOneByGroup(groupId);
    return { id: groupId, currencyCode: info.defaultCurrencyCode };
  },
  async resolveGroup(input: { groupId?: string; groupCode?: string; groupName?: string }) {
    if (input.groupId) {
      const info = await splidClient.groupInfo.getOneByGroup(input.groupId);
      return { id: input.groupId, currencyCode: info.defaultCurrencyCode };
    }
    if (input.groupCode) {
      const joined = await splidClient.group.getByInviteCode(input.groupCode);
      const groupId = joined.result.objectId;
      const info = await splidClient.groupInfo.getOneByGroup(groupId);
      return { id: groupId, currencyCode: info.defaultCurrencyCode };
    }
    if (input.groupName) {
      throw new Error('Group selection by name is not supported yet');
    }
    return this.getDefaultGroup();
  },
  async listMembers(groupId: string) {
    return splidClient.person.getByGroup(groupId);
  },
  async createExpense(input) {
    const options = {
      groupId: input.groupId,
      title: input.title,
      payers: input.payers.map(p => ({ id: p.userId, amount: p.amount })),
      currencyCode: input.currencyCode,
    } as any;
    const items = {
      amount: input.amount,
      profiteers: input.profiteers.map(p => ({ id: p.userId, share: p.share })),
    } as any;
    return splidClient.entry.expense.create(options, items);
  },
  async listEntries(input) {
    return splidClient.entry.getByGroup(input.groupId, 0, input.limit ?? 20);
  },
  async getGroupSummary(groupId: string) {
    const members = await splidClient.person.getByGroup(groupId);
    const entries = await splidClient.entry.getByGroup(groupId, 0, 100);
    const groupInfo = await splidClient.groupInfo.getOneByGroup(groupId);
    const balance = SplidClient.getBalance(members.result.results, entries.result.results, groupInfo.result);
    return { balance };
  },
};

const app = express();
app.use(express.json());
app.use(cors({ origin: '*', exposedHeaders: ['Mcp-Session-Id'] }));

// Health
app.get('/health', (_req: any, res: any) => res.json({ ok: true }));

// Session transports map for resiliency
const transports: Record<string, StreamableHTTPServerTransport> = {};

// POST /mcp
app.post('/mcp', async (req: any, res: any) => {
  const sessionId = req.headers['mcp-session-id'];
  try {
    if (sessionId && typeof sessionId === 'string') {
      const existing = transports[sessionId];
      if (!existing) {
        res.status(400).json({ jsonrpc: '2.0', error: { code: -32000, message: 'Bad Request: No valid session ID provided' }, id: null });
        return;
      }
      await existing.handleRequest(req, res, req.body);
      return;
    }

    // No session header: only accept initialization requests to start a new session
    if (!isInitializeRequest(req.body)) {
      res.status(400).json({ jsonrpc: '2.0', error: { code: -32000, message: 'Bad Request: No valid session ID provided' }, id: null });
      return;
    }

    const server = buildMcpServer(splidApi);
    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: () => randomUUID(),
      onsessioninitialized: (sid: string) => {
        transports[sid] = transport;
      },
    });
    transport.onclose = () => {
      const sid = transport.sessionId as string | undefined;
      if (sid && transports[sid]) delete transports[sid];
    };

    await server.connect(transport);
    await transport.handleRequest(req, res, req.body);
  } catch (err) {
    console.error(err);
    if (!res.headersSent) res.status(500).json({ error: 'Internal error' });
  }
});

// GET /mcp for SSE
app.get('/mcp', async (req: any, res: any) => {
  const sessionId = req.headers['mcp-session-id'];
  if (!sessionId || Array.isArray(sessionId) || !transports[sessionId]) {
    res.status(400).send('Invalid or missing session ID');
    return;
  }
  await transports[sessionId].handleRequest(req, res);
});

// DELETE /mcp to close session
app.delete('/mcp', async (req: any, res: any) => {
  const sessionId = req.headers['mcp-session-id'];
  if (!sessionId || Array.isArray(sessionId) || !transports[sessionId]) {
    res.status(400).send('Invalid or missing session ID');
    return;
  }
  await transports[sessionId].handleRequest(req, res);
});

app.listen(PORT, () => {
  console.log(`MCP Streamable HTTP listening at http://localhost:${PORT}/mcp`);
});
