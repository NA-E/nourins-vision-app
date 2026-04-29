import { sql, NOURIN_USER_ID } from '../db.ts';
import { logEvent } from '../events.ts';
import { get_project } from './get_project.ts';
import type { Tool } from './_registry.ts';

export const upsert_project: Tool = {
  name: 'upsert_project',
  description: 'Create a new project or edit an existing one. If `id` is provided and matches an existing project, only the fields you supply are updated; others are left untouched. If `id` is omitted, a new project is created — `category_id` and `name` are required for new projects. For numeric projects (savings, MRR, session counts), set `has_num: true` and provide `tgt` (target) and `unit`. Returns the full project state after the change.',
  schema: {
    type: 'object',
    properties: {
      id: { type: 'string' },
      category_id: { type: 'string', enum: ['spiritual', 'fitness', 'career', 'personal', 'travel'] },
      name: { type: 'string' },
      description: { type: 'string' },
      has_num: { type: 'boolean' },
      cur: { type: 'number' },
      tgt: { type: 'number' },
      unit: { type: 'string' },
      status: { type: 'string', enum: ['active', 'paused', 'completed'] },
      tags: { type: 'array', items: { type: 'string' } },
      phase: { type: 'string' },
      target_date: { type: 'string', description: 'ISO date YYYY-MM-DD' },
    },
  },
  async handler(args: Record<string, unknown>) {
    const id = (args.id as string | undefined) ?? crypto.randomUUID();
    const existing = args.id
      ? (await sql`select * from projects where id = ${id} and user_id = ${NOURIN_USER_ID}`)[0]
      : null;

    if (existing) {
      const fieldKeys = ['category_id', 'name', 'description', 'has_num', 'cur', 'tgt', 'unit', 'status', 'tags', 'phase', 'target_date'] as const;
      const fields: Record<string, unknown> = {};
      for (const k of fieldKeys) if (k in args) fields[k] = args[k];
      if (Object.keys(fields).length === 0) {
        return await get_project.handler({ id });
      }
      const [updated] = await sql`
        update projects set ${sql(fields)} where id = ${id} returning *
      `;
      await logEvent({ tool: 'upsert_project', op: 'update', table_name: 'projects', row_id: id, before: existing, after: updated });
      return await get_project.handler({ id });
    }

    if (!args.category_id || !args.name) {
      throw new Error('category_id and name required when creating a new project');
    }

    const [created] = await sql`
      insert into projects (
        id, category_id, name, description, has_num,
        cur, tgt, unit, status, tags, phase, target_date, user_id
      ) values (
        ${id},
        ${args.category_id as string},
        ${args.name as string},
        ${(args.description as string | undefined) ?? ''},
        ${(args.has_num as boolean | undefined) ?? false},
        ${(args.cur as number | undefined) ?? 0},
        ${(args.tgt as number | undefined) ?? 0},
        ${(args.unit as string | undefined) ?? ''},
        ${(args.status as string | undefined) ?? 'active'},
        ${(args.tags as string[] | undefined) ?? []},
        ${(args.phase as string | undefined) ?? null},
        ${(args.target_date as string | undefined) ?? null},
        ${NOURIN_USER_ID}
      )
      returning *
    `;
    await logEvent({ tool: 'upsert_project', op: 'insert', table_name: 'projects', row_id: id, after: created });
    return await get_project.handler({ id });
  },
};
