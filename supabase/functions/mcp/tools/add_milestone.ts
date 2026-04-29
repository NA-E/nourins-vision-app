import { sql, NOURIN_USER_ID } from '../db.ts';
import { logEvent } from '../events.ts';
import { get_project } from './get_project.ts';
import type { Tool } from './_registry.ts';

export const add_milestone: Tool = {
  name: 'add_milestone',
  description: 'Append a milestone to a project. Milestones are concrete checkpoints ("First 10 ayahs," "$1,575 — 25%," "Pass driving test"). Sort order is preserved automatically.',
  schema: {
    type: 'object',
    properties: {
      project_id: { type: 'string' },
      title: { type: 'string' },
    },
    required: ['project_id', 'title'],
  },
  async handler(args: Record<string, unknown>) {
    const project_id = args.project_id as string;
    const title = args.title as string;
    const id = crypto.randomUUID();

    const [{ max_order }] = await sql`
      select coalesce(max(sort_order), 0) as max_order
      from milestones where project_id = ${project_id}
    `;

    const [m] = await sql`
      insert into milestones (id, project_id, title, sort_order, user_id)
      values (${id}, ${project_id}, ${title}, ${Number(max_order) + 1}, ${NOURIN_USER_ID})
      returning *
    `;
    await logEvent({ tool: 'add_milestone', op: 'insert', table_name: 'milestones', row_id: id, after: m });
    return await get_project.handler({ id: project_id });
  },
};
