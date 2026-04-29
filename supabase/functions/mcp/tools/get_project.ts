import { sql, NOURIN_USER_ID } from '../db.ts';
import type { Tool } from './_registry.ts';

export const get_project: Tool = {
  name: 'get_project',
  description: 'Get full details for one project: description, all milestones, last 20 log entries, last 5 reflections. Use when the user asks about a specific goal/project ("how is my Hajj savings going?", "what milestones do I have for Arabic?"). Match by id when known, otherwise by exact name.',
  schema: {
    type: 'object',
    properties: {
      id: { type: 'string', description: 'Project ID (e.g., "baqarah", "umrahsave")' },
      name: { type: 'string', description: 'Project name (used if id not given)' },
    },
  },
  async handler(args: Record<string, unknown>) {
    const id = args.id as string | undefined;
    const name = args.name as string | undefined;

    let project;
    if (id) {
      const rows = await sql`
        select * from projects
        where user_id = ${NOURIN_USER_ID} and id = ${id} and deleted_at is null
      `;
      project = rows[0];
    } else if (name) {
      const rows = await sql`
        select * from projects
        where user_id = ${NOURIN_USER_ID} and name ilike ${name} and deleted_at is null
        limit 1
      `;
      project = rows[0];
    } else {
      throw new Error('Provide id or name');
    }
    if (!project) throw new Error('Project not found');

    const milestones = await sql`
      select id, title, done, done_at, sort_order
      from milestones
      where project_id = ${project.id} and deleted_at is null
      order by sort_order, created_at
    `;
    const log = await sql`
      select id, date, note, val
      from log_entries
      where project_id = ${project.id}
      order by date desc, created_at desc
      limit 20
    `;
    const reflections = await sql`
      select id, date, title, body, mood, tags
      from reflections
      where project_id = ${project.id}
      order by date desc
      limit 5
    `;

    return {
      ...project,
      cur: Number(project.cur),
      tgt: Number(project.tgt),
      milestones,
      log_entries: log,
      reflections,
    };
  },
};
