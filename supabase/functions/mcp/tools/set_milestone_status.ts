import { sql, NOURIN_USER_ID } from '../db.ts';
import { logEvent } from '../events.ts';
import { get_project } from './get_project.ts';
import type { Tool } from './_registry.ts';

export const set_milestone_status: Tool = {
  name: 'set_milestone_status',
  description: 'Mark a milestone as done or not done. Stamps done_at when flipping to true; clears it when flipping to false. Idempotent — calling with the current value is a safe no-op.',
  schema: {
    type: 'object',
    properties: {
      milestone_id: { type: 'string' },
      done: { type: 'boolean' },
    },
    required: ['milestone_id', 'done'],
  },
  async handler(args: Record<string, unknown>) {
    const milestone_id = args.milestone_id as string;
    const done = args.done as boolean;

    const [before] = await sql`
      select * from milestones
      where id = ${milestone_id} and user_id = ${NOURIN_USER_ID}
    `;
    if (!before) throw new Error('Milestone not found');

    const [after] = done
      ? await sql`update milestones set done = true,  done_at = now() where id = ${milestone_id} returning *`
      : await sql`update milestones set done = false, done_at = null  where id = ${milestone_id} returning *`;

    await logEvent({ tool: 'set_milestone_status', op: 'update', table_name: 'milestones', row_id: milestone_id, before, after });
    return await get_project.handler({ id: before.project_id });
  },
};
