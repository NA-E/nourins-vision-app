import { sql, NOURIN_USER_ID } from '../db.ts';
import type { Tool } from './_registry.ts';

export const recent_activity: Tool = {
  name: 'recent_activity',
  description: 'Get the most recent log entries and reflections across all projects. Use when the user asks "what have I been up to," "summarize my last week," "what did I log recently," or any time-based reflection question.',
  schema: {
    type: 'object',
    properties: {
      limit: { type: 'number', description: 'Max entries to return (default 20, max 100)' },
    },
  },
  async handler(args: Record<string, unknown>) {
    const limit = Math.min(Number(args.limit ?? 20) || 20, 100);
    const log = await sql`
      select 'log' as kind, l.id, l.date, l.note, l.val,
             l.project_id, p.name as project_name
      from log_entries l
      join projects p on p.id = l.project_id
      where l.user_id = ${NOURIN_USER_ID}
      order by l.date desc, l.created_at desc
      limit ${limit}
    `;
    const ref = await sql`
      select 'reflection' as kind, r.id, r.date, r.title, r.body, r.mood, r.tags,
             r.project_id, p.name as project_name
      from reflections r
      left join projects p on p.id = r.project_id
      where r.user_id = ${NOURIN_USER_ID}
      order by r.date desc
      limit ${limit}
    `;
    return [...log, ...ref]
      .sort((a: { date: string }, b: { date: string }) => (a.date < b.date ? 1 : -1))
      .slice(0, limit);
  },
};
