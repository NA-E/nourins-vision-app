import { sql, NOURIN_USER_ID } from '../db.ts';
import { logEvent } from '../events.ts';
import type { Tool } from './_registry.ts';

export const delete_project: Tool = {
  name: 'delete_project',
  description: "Hide a project from the dashboard (soft-delete — recoverable via undo_last_write). Use when the user wants to remove a project they no longer want to track, or that they created by mistake. The project's milestones and log entries stay in the database; only the project itself is hidden.",
  schema: {
    type: 'object',
    properties: {
      project_id: { type: 'string' },
    },
    required: ['project_id'],
  },
  async handler(args: Record<string, unknown>) {
    const project_id = args.project_id as string;

    const [before] = await sql`
      select * from projects
      where id = ${project_id} and user_id = ${NOURIN_USER_ID} and deleted_at is null
    `;
    if (!before) throw new Error('Project not found or already deleted');

    const [after] = await sql`
      update projects set deleted_at = now()
      where id = ${project_id} and user_id = ${NOURIN_USER_ID} and deleted_at is null
      returning deleted_at
    `;

    await logEvent({
      tool: 'delete_project',
      op: 'soft_delete',
      table_name: 'projects',
      row_id: project_id,
      before,
      after: { deleted_at: after.deleted_at },
    });

    return { deleted: true, project_id, restorable_via: 'undo_last_write' };
  },
};
