// Tool registry — each tool exports its definition; this file aggregates them.
export type Tool = {
  name: string;
  description: string;
  schema: Record<string, unknown>;
  handler: (args: Record<string, unknown>) => Promise<unknown>;
};

// Read tools
import { get_dashboard }   from './get_dashboard.ts';
import { get_project }     from './get_project.ts';
import { recent_activity } from './recent_activity.ts';
import { search }          from './search.ts';

// Write tools — create / upsert
import { upsert_project }       from './upsert_project.ts';
import { add_milestone }        from './add_milestone.ts';
import { log_entry }            from './log_entry.ts';
import { add_reflection }       from './add_reflection.ts';

// Write tools — edit
import { set_milestone_status } from './set_milestone_status.ts';
import { update_milestone }     from './update_milestone.ts';
import { update_log_entry }     from './update_log_entry.ts';

// Write tools — soft-delete
import { delete_project }   from './delete_project.ts';
import { delete_milestone } from './delete_milestone.ts';
import { delete_log_entry } from './delete_log_entry.ts';

// Recovery
import { undo_last_write } from './undo_last_write.ts';

export const tools: Tool[] = [
  // Read
  get_dashboard,
  get_project,
  recent_activity,
  search,
  // Create / upsert
  upsert_project,
  add_milestone,
  log_entry,
  add_reflection,
  // Edit
  set_milestone_status,
  update_milestone,
  update_log_entry,
  // Soft-delete
  delete_project,
  delete_milestone,
  delete_log_entry,
  // Recovery
  undo_last_write,
];
