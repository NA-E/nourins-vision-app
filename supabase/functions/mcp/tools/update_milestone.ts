import { sql, NOURIN_USER_ID } from '../db.ts';
import { logEvent } from '../events.ts';
import { get_project } from './get_project.ts';
import type { Tool } from './_registry.ts';

export const update_milestone: Tool = {
  name: 'update_milestone',
  description: "Edit a milestone — change its title, mark it done/undone, or both. Use when the user wants to rename a milestone (typo, refinement) or both edit and toggle status in one step. For pure done/undone toggling, set_milestone_status is also fine but this is the unified tool.",
  schema: {
    type: 'object',
    properties: {
      milestone_id: { type: 'string' },
      title: { type: 'string', description: 'New milestone title.' },
      done: { type: 'boolean', description: 'Mark done (true) or undone (false).' },
    },
    required: ['milestone_id'],
  },
  async handler(args: Record<string, unknown>) {
    const milestone_id = args.milestone_id as string;

    if (!('title' in args) && !('done' in args)) {
      throw new Error('At least one of title or done must be provided.');
    }

    const [before] = await sql`
      select * from milestones
      where id = ${milestone_id} and user_id = ${NOURIN_USER_ID}
    `;
    if (!before) throw new Error('Milestone not found');

    const fields: Record<string, unknown> = {};
    if ('title' in args) fields.title = args.title;
    if ('done' in args) {
      const done = args.done as boolean;
      fields.done = done;
      fields.done_at = done ? new Date().toISOString() : null;
    }

    const [after] = await sql`
      update milestones set ${sql(fields)} where id = ${milestone_id} returning *
    `;

    await logEvent({
      tool: 'update_milestone',
      op: 'update',
      table_name: 'milestones',
      row_id: milestone_id,
      before,
      after,
    });

    return await get_project.handler({ id: before.project_id });
  },
};
