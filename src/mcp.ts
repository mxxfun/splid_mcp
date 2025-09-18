import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';

export interface SplidApi {
  getDefaultGroup(): Promise<{ id: string; currencyCode?: string }>;
  resolveGroup(input: { groupId?: string; groupCode?: string; groupName?: string }): Promise<{ id: string; currencyCode?: string }>;
  listMembers(groupId: string): Promise<any>;
  createExpense(input: {
    groupId: string;
    title: string;
    amount: number;
    currencyCode?: string;
    payers: Array<{ userId: string; amount: number }>;
    profiteers: Array<{ userId: string; share: number }>;
  }): Promise<unknown>;
  listEntries(input: { groupId: string; limit?: number }): Promise<unknown[]>;
  getGroupSummary(groupId: string): Promise<unknown>;
}

export function buildMcpServer(splid: SplidApi) {
  const server = new McpServer({ name: 'splid-mcp', version: '0.1.0' }, { capabilities: { logging: {} } });

  server.registerTool('health', { title: 'Health', description: 'Basic connectivity check' }, async () => ({
    content: [{ type: 'text', text: 'ok' }],
  }));

  server.registerTool(
    'whoami',
    { title: 'Who Am I', description: 'Return current group and members resolved from CODE' },
    async () => {
      const group = await splid.getDefaultGroup();
      const members = await splid.listMembers(group.id);
      return { content: [{ type: 'text', text: JSON.stringify({ group, members }) }] };
    },
  );

  const GroupSelector = z.object({
    groupId: z.string().optional(),
    groupCode: z.string().optional(),
    groupName: z.string().optional(),
  }).partial();

  const PayerLoose = z.object({
    userId: z.string().optional(),
    name: z.string().optional(),
    amount: z.number().positive(),
  }).refine(v => !!v.userId || !!v.name, { message: 'Either userId or name required for payer' });

  const ProfiteerLoose = z.object({
    userId: z.string().optional(),
    name: z.string().optional(),
    share: z.number().gt(0).lte(1),
  }).refine(v => !!v.userId || !!v.name, { message: 'Either userId or name required for profiteer' });

  const CreateExpenseInput = GroupSelector.extend({
    title: z.string(),
    amount: z.number().positive(),
    currencyCode: z.string().optional(),
    payers: z.array(PayerLoose).min(1),
    profiteers: z.array(ProfiteerLoose).min(1),
  });

  type CreateExpenseArgs = z.infer<typeof CreateExpenseInput>;

  async function resolveUserIdsByName(groupId: string, names: string[]): Promise<Record<string, string>> {
    const members = await splid.listMembers(groupId);
    const list: Array<{ objectId?: string; name: string; GlobalId?: string }> = members.result?.results ?? members;
    const nameToGlobalId: Record<string, string> = {};
    for (const m of list) {
      if (m && typeof m.name === 'string' && typeof m.GlobalId === 'string') {
        nameToGlobalId[m.name.toLowerCase()] = m.GlobalId;
      }
    }
    const resolved: Record<string, string> = {};
    for (const n of names) {
      const key = n.toLowerCase();
      if (!nameToGlobalId[key]) throw new Error(`Unknown member name: ${n}`);
      resolved[n] = nameToGlobalId[key];
    }
    return resolved;
  }

  server.registerTool(
    'createExpense',
    {
      title: 'Create Expense',
      description: 'Create an expense in the selected or default group',
      inputSchema: CreateExpenseInput.shape,
    },
    async ({ title, amount, currencyCode, payers, profiteers, groupId, groupCode, groupName }: CreateExpenseArgs) => {
      const group = (groupId || groupCode || groupName)
        ? await splid.resolveGroup({ groupId, groupCode, groupName })
        : await splid.getDefaultGroup();
      const currency = currencyCode ?? group.currencyCode ?? 'EUR';

      const sum = profiteers.reduce((s, p) => s + p.share, 0);
      const epsilon = 1e-6;
      if (Math.abs(sum - 1) > epsilon) {
        return { content: [{ type: 'text', text: `Shares must sum to 1. Current sum: ${sum}` }], isError: true } as any;
      }

      const missingPayerNames = payers.filter(p => !p.userId && p.name).map(p => p.name as string);
      const missingProfiteerNames = profiteers.filter(p => !p.userId && p.name).map(p => p.name as string);
      const namesToResolve = Array.from(new Set([...missingPayerNames, ...missingProfiteerNames]));
      let nameToId: Record<string, string> = {};
      if (namesToResolve.length > 0) {
        nameToId = await resolveUserIdsByName(group.id, namesToResolve);
      }

      const normalizedPayers = payers.map(p => ({ userId: p.userId ?? nameToId[p.name as string], amount: p.amount }));
      const normalizedProfiteers = profiteers.map(p => ({ userId: p.userId ?? nameToId[p.name as string], share: p.share }));

      if (normalizedPayers.some(p => !p.userId) || normalizedProfiteers.some(p => !p.userId)) {
        return { content: [{ type: 'text', text: 'Failed to resolve all user names to IDs' }], isError: true } as any;
      }

      const result = await splid.createExpense({
        groupId: group.id,
        title,
        amount,
        currencyCode: currency,
        payers: normalizedPayers as any,
        profiteers: normalizedProfiteers as any,
      });
      return { content: [{ type: 'text', text: JSON.stringify(result) }] };
    },
  );

  const ListEntriesInput = GroupSelector.extend({ limit: z.number().int().min(1).max(100).default(20) }).partial();
  type ListEntriesArgs = z.infer<typeof ListEntriesInput>;

  server.registerTool(
    'listEntries',
    { title: 'List Entries', description: 'List recent entries in the selected or default group', inputSchema: ListEntriesInput.shape },
    async ({ limit, groupId, groupCode, groupName }: ListEntriesArgs) => {
      const group = (groupId || groupCode || groupName)
        ? await splid.resolveGroup({ groupId, groupCode, groupName })
        : await splid.getDefaultGroup();
      const entries = await splid.listEntries({ groupId: group.id, limit: limit ?? 20 });
      return { content: [{ type: 'text', text: JSON.stringify(entries) }] };
    },
  );

  const SummarySelector = GroupSelector;
  type SummarySelectorArgs = z.infer<typeof SummarySelector>;

  server.registerTool(
    'getGroupSummary',
    { title: 'Group Summary', description: 'Balances/summary for the selected or default group', inputSchema: SummarySelector.shape },
    async ({ groupId, groupCode, groupName }: SummarySelectorArgs = {}) => {
      const group = (groupId || groupCode || groupName)
        ? await splid.resolveGroup({ groupId, groupCode, groupName })
        : await splid.getDefaultGroup();
      const summary = await splid.getGroupSummary(group.id);
      return { content: [{ type: 'text', text: JSON.stringify(summary) }] };
    },
  );

  return server;
}
