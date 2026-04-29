import { sql, NOURIN_USER_ID } from '../db.ts';
import type { Tool } from './_registry.ts';

export const get_dashboard: Tool = {
  name: 'get_dashboard',
  description: 'Get a complete overview of all categories and projects with progress percentages and statuses. Use when the user asks "show me everything," "what am I working on," "give me the big picture," or any general status question. Returns categories with their projects nested; each project includes status, progress %, current/target values, milestone counts, and tags.',
  schema: { type: 'object', properties: {}, additionalProperties: false },
  async handler() {
    const cats = await sql`
      select id, name, sort_order
      from categories
      where user_id = ${NOURIN_USER_ID}
      order by sort_order
    `;
    const projs = await sql`
      select id, category_id, name, description, has_num, cur, tgt, unit,
             status, phase, target_date, tags, created_at, updated_at
      from projects
      where user_id = ${NOURIN_USER_ID} and deleted_at is null
      order by created_at
    `;
    const ms = await sql`
      select project_id,
             count(*) filter (where done) as done,
             count(*) as total
      from milestones
      where user_id = ${NOURIN_USER_ID} and deleted_at is null
      group by project_id
    `;
    const msMap = new Map(
      ms.map((r: { project_id: string; done: string | number; total: string | number }) => [
        r.project_id,
        { done: Number(r.done), total: Number(r.total) },
      ]),
    );

    return cats.map((c: { id: string; name: string }) => ({
      id: c.id,
      name: c.name,
      projects: projs
        .filter((p: { category_id: string }) => p.category_id === c.id)
        .map((p: Record<string, unknown>) => {
          const m = msMap.get(p.id as string) ?? { done: 0, total: 0 };
          const cur = Number(p.cur);
          const tgt = Number(p.tgt);
          const pct = p.has_num && tgt > 0
            ? Math.round((cur / tgt) * 100)
            : (m.total ? Math.round((m.done / m.total) * 100) : 0);
          return {
            id: p.id,
            name: p.name,
            description: p.description,
            status: p.status,
            has_num: p.has_num,
            cur,
            tgt,
            unit: p.unit,
            tags: p.tags,
            phase: p.phase,
            target_date: p.target_date,
            progress_pct: Math.min(100, pct),
            milestones: m,
          };
        }),
    }));
  },
};
