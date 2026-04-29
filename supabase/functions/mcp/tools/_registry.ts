// Tool registry — each tool exports its definition; this file aggregates them.
// Tools are added by subsequent tasks; this stub keeps the scaffold compilable.
export type Tool = {
  name: string;
  description: string;
  schema: Record<string, unknown>;
  handler: (args: Record<string, unknown>) => Promise<unknown>;
};

export const tools: Tool[] = [];
