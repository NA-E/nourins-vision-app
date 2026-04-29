import { sql, NOURIN_USER_ID } from '../db.ts';
import { logEvent } from '../events.ts';
import { get_project } from './get_project.ts';
import type { Tool } from './_registry.ts';

export const log_entry: Tool = {
  name: 'log_entry',
  description: 'Add a dated log entry to a project. Use when the user describes something concrete they did, observed, or measured — a workout, a saving, a session, a moment from a trip. Always store the date (default to today if not specified) and the note in their own words. For numeric projects (savings totals, MRR, session counts), include `val` and the project\'s current value will also be updated to that number.',
  schema: {
    type: 'object',
    properties: {
      project_id: { type: 'string' },
      date: { type: 'string', description: 'YYYY-MM-DD; defaults to today if omitted' },
      note: { type: 'string' },
      val: { type: 'number', description: "Optional. New current value for numeric projects." },
    },
    required: ['project_id', 'note'],
  },
  async handler(args: Record<string, unknown>) {
    const project_id = args.project_id as string;
    const note = args.note as string;
    const val = args.val as number | undefined;
    const date = (args.date as string | undefined) ?? new Date().toISOString().slice(0, 10);
    const id = crypto.randomUUID();

    const [entry] = await sql`
      insert into log_entries (id, project_id, date, note, val, user_id)
      values (${id}, ${project_id}, ${date}, ${note}, ${val ?? null}, ${NOURIN_USER_ID})
      returning *
    `;
    await logEvent({ tool: 'log_entry', op: 'insert', table_name: 'log_entries', row_id: id, after: entry });

    if (val != null) {
      const [pBefore] = await sql`select cur from projects where id = ${project_id}`;
      const [pAfter] = await sql`update projects set cur = ${val} where id = ${project_id} returning cur`;
      await logEvent({
        tool: 'log_entry',
        op: 'update',
        table_name: 'projects',
        row_id: project_id,
        before: pBefore,
        after: pAfter,
      });
    }
    return await get_project.handler({ id: project_id });
  },
};
