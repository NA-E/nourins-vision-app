import { sql, NOURIN_USER_ID } from '../db.ts';
import { logEvent } from '../events.ts';
import { get_project } from './get_project.ts';
import type { Tool } from './_registry.ts';

export const delete_log_entry: Tool = {
  name: 'delete_log_entry',
  description: "Remove a log entry (soft-delete, recoverable). Use when the user logged something by mistake or wants to clean up an entry.",
  schema: {
    type: 'object',
    properties: {
      log_entry_id: { type: 'string' },
    },
    required: ['log_entry_id'],
  },
  async handler(args: Record<string, unknown>) {
    const log_entry_id = args.log_entry_id as string;

    const [before] = await sql`
      select * from log_entries
      where id = ${log_entry_id} and user_id = ${NOURIN_USER_ID} and deleted_at is null
    `;
    if (!before) throw new Error('Log entry not found or already deleted');

    const [after] = await sql`
      update log_entries set deleted_at = now()
      where id = ${log_entry_id} and user_id = ${NOURIN_USER_ID} and deleted_at is null
      returning deleted_at
    `;

    await logEvent({
      tool: 'delete_log_entry',
      op: 'soft_delete',
      table_name: 'log_entries',
      row_id: log_entry_id,
      before,
      after: { deleted_at: after.deleted_at },
    });

    return await get_project.handler({ id: before.project_id });
  },
};
