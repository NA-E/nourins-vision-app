// Tool registry — each tool exports its definition; this file aggregates them.
export type Tool = {
  name: string;
  description: string;
  schema: Record<string, unknown>;
  handler: (args: Record<string, unknown>) => Promise<unknown>;
};

import { get_dashboard }   from './get_dashboard.ts';
import { get_project }     from './get_project.ts';
import { recent_activity } from './recent_activity.ts';
import { search }          from './search.ts';

export const tools: Tool[] = [
  get_dashboard,
  get_project,
  recent_activity,
  search,
];
