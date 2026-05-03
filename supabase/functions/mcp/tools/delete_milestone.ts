import { sql, NOURIN_USER_ID } from '../db.ts';
import { logEvent } from '../events.ts';
import { get_project } from './get_project.ts';
import type { Tool } from './_registry.ts';

export const delete_milestone: Tool = {
  name: 'delete_milestone',
  description: "Remove a milestone (soft-delete, recoverable). Use when the user wants to drop a milestone — maybe it no longer fits the project's plan or was a duplicate.",
  schema: {
    type: 'object',
    properties: {
      milestone_id: { type: 'string' },
    },
    required: ['milestone_id'],
  },
  async handler(args: Record<string, unknown>) {
    const milestone_id = args.milestone_id as string;

    const [before] = await sql`
      select * from milestones
      where id = ${milestone_id} and user_id = ${NOURIN_USER_ID} and deleted_at is null
    `;
    if (!before) throw new Error('Milestone not found or already deleted');

    const [after] = await sql`
      update milestones set deleted_at = now()
      where id = ${milestone_id} and user_id = ${NOURIN_USER_ID} and deleted_at is null
      returning deleted_at
    `;

    await logEvent({
      tool: 'delete_milestone',
      op: 'soft_delete',
      table_name: 'milestones',
      row_id: milestone_id,
      before,
      after: { deleted_at: after.deleted_at },
    });

    return await get_project.handler({ id: before.project_id });
  },
};
