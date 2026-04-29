import { sql, NOURIN_USER_ID } from '../db.ts';
import { logEvent } from '../events.ts';
import type { Tool } from './_registry.ts';

const ALLOWED_TABLES = new Set(['projects', 'milestones', 'log_entries', 'reflections']);

export const undo_last_write: Tool = {
  name: 'undo_last_write',
  description: "Reverse the most recent write performed by the MCP. Use when the user says 'undo,' 'wait, no,' 'I didn't mean that,' or 'take that back.' Reads the latest event from the audit log and replays its inverse. The undo itself is recorded as a new event, so undo-of-undo is just another step.",
  schema: { type: 'object', properties: {}, additionalProperties: false },
  async handler() {
    const [last] = await sql`
      select id, op, table_name, row_id, before, after, tool, at
      from events
      where user_id = ${NOURIN_USER_ID} and actor = 'mcp' and op != 'undo'
      order by at desc
      limit 1
    `;
    if (!last) return { undone: null, message: 'Nothing to undo.' };

    const t = last.table_name as string;
    const id = last.row_id as string | null;

    if (!id) {
      return { undone: null, message: `Cannot undo a batch event (event_id=${last.id}); manual intervention required.` };
    }
    if (!ALLOWED_TABLES.has(t)) {
      return { undone: null, message: `Cannot undo writes to table "${t}".` };
    }

    if (last.op === 'insert') {
      // Hard delete (the inserted row was new; there is no prior state to restore).
      await sql`delete from ${sql(t)} where id = ${id} and user_id = ${NOURIN_USER_ID}`;
      await logEvent({
        tool: 'undo_last_write', op: 'undo', table_name: t, row_id: id, before: last.after,
      });
      return { undone: { event_id: last.id, op: 'insert', table: t, row_id: id }, message: `Undid insert into ${t}.` };
    }

    if (last.op === 'update') {
      const before = last.before as Record<string, unknown> | null;
      if (!before) return { undone: null, message: 'No prior state recorded; cannot undo this update.' };
      // Strip system fields that should not be replayed
      const replay: Record<string, unknown> = { ...before };
      delete replay.id;
      delete replay.user_id;
      delete replay.created_at;
      await sql`update ${sql(t)} set ${sql(replay)} where id = ${id} and user_id = ${NOURIN_USER_ID}`;
      await logEvent({
        tool: 'undo_last_write', op: 'undo', table_name: t, row_id: id,
        before: last.after, after: before,
      });
      return { undone: { event_id: last.id, op: 'update', table: t, row_id: id }, message: `Reverted update on ${t}.` };
    }

    return { undone: null, message: `Op "${last.op}" is not yet supported by undo.` };
  },
};
