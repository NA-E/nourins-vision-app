import { sql, NOURIN_USER_ID } from '../db.ts';
import { logEvent } from '../events.ts';
import type { Tool } from './_registry.ts';

export const add_reflection: Tool = {
  name: 'add_reflection',
  description: 'Add a reflection — open-ended thought, weekly/monthly framing, mood, lesson, intention. Different from log entries (which are concrete acts). Use when the user is reflecting, journaling, processing, or observing patterns. Reflections can optionally be tied to a project.',
  schema: {
    type: 'object',
    properties: {
      date: { type: 'string', description: 'YYYY-MM-DD; defaults to today' },
      body: { type: 'string' },
      project_id: { type: 'string', description: 'Optional. Tie reflection to one project.' },
      title: { type: 'string' },
      mood: { type: 'string' },
      tags: { type: 'array', items: { type: 'string' } },
    },
    required: ['body'],
  },
  async handler(args: Record<string, unknown>) {
    const body = args.body as string;
    const date = (args.date as string | undefined) ?? new Date().toISOString().slice(0, 10);
    const project_id = (args.project_id as string | undefined) ?? null;
    const title = (args.title as string | undefined) ?? null;
    const mood = (args.mood as string | undefined) ?? null;
    const tags = (args.tags as string[] | undefined) ?? [];
    const id = crypto.randomUUID();

    const [r] = await sql`
      insert into reflections (id, project_id, date, title, body, mood, tags, user_id)
      values (${id}, ${project_id}, ${date}, ${title}, ${body}, ${mood}, ${tags}, ${NOURIN_USER_ID})
      returning *
    `;
    await logEvent({ tool: 'add_reflection', op: 'insert', table_name: 'reflections', row_id: id, after: r });
    return r;
  },
};
