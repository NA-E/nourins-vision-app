// Postgres client wrapper.
// Connects as the scoped `nourin_app` role (no service-role key in this path).
// Every query in tool handlers must additionally filter by NOURIN_USER_ID
// — RLS would also enforce this if we were using JWTs, but `nourin_app` is
// a plain DB role so we filter explicitly in code.
import postgres from 'postgres';

const PG_URL = Deno.env.get('PG_URL');
const NOURIN_USER_ID = Deno.env.get('NOURIN_USER_ID');

if (!PG_URL) throw new Error('PG_URL env var required');
if (!NOURIN_USER_ID) throw new Error('NOURIN_USER_ID env var required');

export const sql = postgres(PG_URL, {
  max: 5,
  idle_timeout: 20,
  prepare: false,
});

export { NOURIN_USER_ID };
