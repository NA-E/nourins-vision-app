import { sql, NOURIN_USER_ID } from '../db.ts';
import { logEvent } from '../events.ts';
import { get_project } from './get_project.ts';
import type { Tool } from './_registry.ts';

export const update_log_entry: Tool = {
  name: 'update_log_entry',
  description: "Edit an existing log entry — fix a typo in the note, correct the value, or change the date. Use when the user says 'fix that last entry' or 'actually I logged the wrong amount.' Don't use for adding new entries — that's log_entry.",
  schema: {
    type: 'object',
    properties: {
      log_entry_id: { type: 'string' },
      note: { type: 'string', description: 'Updated note text.' },
      val: { description: 'Updated numeric value, or null to clear it.' },
      date: { type: 'string', description: 'Updated date, YYYY-MM-DD.' },
    },
    required: ['log_entry_id'],
  },
  async handler(args: Record<string, unknown>) {
    const log_entry_id = args.log_entry_id as string;

    if (!('note' in args) && !('val' in args) && !('date' in args)) {
      throw new Error('At least one of note, val, or date must be provided.');
    }

    const [before] = await sql`
      select * from log_entries
      where id = ${log_entry_id} and user_id = ${NOURIN_USER_ID}
    `;
    if (!before) throw new Error('Log entry not found');

    const fields: Record<string, unknown> = {};
    if ('note' in args) fields.note = args.note;
    if ('val' in args) fields.val = args.val ?? null;
    if ('date' in args) fields.date = args.date;

    const [after] = await sql`
      update log_entries set ${sql(fields)} where id = ${log_entry_id} returning *
    `;

    await logEvent({
      tool: 'update_log_entry',
      op: 'update',
      table_name: 'log_entries',
      row_id: log_entry_id,
      before,
      after,
    });

    return await get_project.handler({ id: before.project_id });
  },
};
