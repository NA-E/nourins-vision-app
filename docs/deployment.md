# Deployment recipe

End-to-end setup, ~25 minutes. Each step is roughly 2 minutes.

## 1. Create personal Supabase project
- Sign in at https://supabase.com (use your personal email, not a client account).
- Create new project. Region: closest to Bangladesh (e.g., `ap-southeast-1`). Free tier.
- Save the project URL and `anon` key; we'll need them for the web app.

## 2. Apply migrations
```bash
supabase link --project-ref <your-project-ref>
supabase db push
```
This creates all tables, indexes, RLS policies, and the `nourin_app` role.

## 3. Set the nourin_app password
In the Supabase SQL editor:
```sql
alter role nourin_app password '<long-random-string>';
```
Save the password — it's part of the Postgres connection string for the MCP function.

## 4. Configure Auth (UI)
Supabase Dashboard → Authentication → Settings:
- **Disable** new signups.
- **Magic link expiry:** 5 minutes.
- **Email enumeration protection:** ON.
- **OTP enabled:** ON (6-digit fallback for mobile Safari).

## 5. Sign in once
- Open the project → Authentication → Users.
- Add a user manually with your email, OR temporarily re-enable signups, sign in via the live web app, then disable signups again.
- Copy your `auth.users.id` UUID — needed for the MCP function env.

## 6-9. (filled in later phases)
