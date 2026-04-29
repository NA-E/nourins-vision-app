import { sql, NOURIN_USER_ID } from '../db.ts';
import type { Tool } from './_registry.ts';

export const search: Tool = {
  name: 'search',
  description: 'Full-text search across project names/descriptions, milestone titles, log entry notes, and reflection bodies. Use when the user asks "what did I write about X," "find that note where I mentioned Y," "anything about Ibrahim," etc.',
  schema: {
    type: 'object',
    properties: {
      query: { type: 'string', description: 'Search query (1-3 keywords work best)' },
    },
    required: ['query'],
  },
  async handler(args: Record<string, unknown>) {
    const q = String(args.query ?? '').trim();
    if (!q) return { projects: [], milestones: [], log_entries: [], reflections: [] };

    const projects = await sql`
      select id, name, description, 'project' as kind
      from projects
      where user_id = ${NOURIN_USER_ID}
        and deleted_at is null
        and to_tsvector('english', name || ' ' || coalesce(description,'')) @@ plainto_tsquery('english', ${q})
      limit 10
    `;
    const milestones = await sql`
      select id, title, project_id, 'milestone' as kind
      from milestones
      where user_id = ${NOURIN_USER_ID}
        and deleted_at is null
        and to_tsvector('english', title) @@ plainto_tsquery('english', ${q})
      limit 10
    `;
    const log_entries = await sql`
      select id, date, note, project_id, 'log' as kind
      from log_entries
      where user_id = ${NOURIN_USER_ID}
        and to_tsvector('english', note) @@ plainto_tsquery('english', ${q})
      order by date desc
      limit 20
    `;
    const reflections = await sql`
      select id, date, title, body, project_id, 'reflection' as kind
      from reflections
      where user_id = ${NOURIN_USER_ID}
        and to_tsvector('english', coalesce(title,'') || ' ' || body) @@ plainto_tsquery('english', ${q})
      order by date desc
      limit 10
    `;
    return { projects, milestones, log_entries, reflections };
  },
};
