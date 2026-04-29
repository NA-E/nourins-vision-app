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

// Write tools
import { upsert_project }       from './upsert_project.ts';
import { add_milestone }        from './add_milestone.ts';
import { set_milestone_status } from './set_milestone_status.ts';
import { log_entry }            from './log_entry.ts';
import { add_reflection }       from './add_reflection.ts';

// Recovery
import { undo_last_write } from './undo_last_write.ts';

export const tools: Tool[] = [
  get_dashboard,
  get_project,
  recent_activity,
  search,
  upsert_project,
  add_milestone,
  set_milestone_status,
  log_entry,
  add_reflection,
  undo_last_write,
];
