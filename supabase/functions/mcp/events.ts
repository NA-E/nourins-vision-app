// Append-only audit log helper.
// Every write tool calls logEvent() so undo_last_write can reverse changes.
import { sql, NOURIN_USER_ID } from './db.ts';

export type EventOp = 'insert' | 'update' | 'delete' | 'soft_delete' | 'undo';

export async function logEvent(params: {
  tool: string;
  op: EventOp;
  table_name: string;
  row_id?: string;
  before?: unknown;
  after?: unknown;
}): Promise<void> {
  await sql`
    insert into events (actor, tool, op, table_name, row_id, before, after, user_id)
    values (
      'mcp',
      ${params.tool},
      ${params.op},
      ${params.table_name},
      ${params.row_id ?? null},
      ${params.before ? sql.json(params.before as object) : null},
      ${params.after  ? sql.json(params.after  as object) : null},
      ${NOURIN_USER_ID}
    )
  `;
}
