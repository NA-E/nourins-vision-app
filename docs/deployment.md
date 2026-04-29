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

## 6. Configure web app + deploy to GitHub Pages

In `index.html`, replace placeholders near the top of the `<script>` tag:
- `SUPABASE_URL = 'https://YOURPROJECT.supabase.co'` → your real URL
- `SUPABASE_ANON_KEY = 'PLACEHOLDER_ANON_KEY'` → your real anon key

In the `<meta http-equiv="Content-Security-Policy">` tag near the top, replace `YOURPROJECT.supabase.co` with your real subdomain (both `https://` and `wss://` lines).

Verify the SRI hash on the pinned Supabase SDK script tag matches the published file (regenerate if you bump the version):
```bash
curl -s https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.46.1/dist/umd/supabase.min.js \
  | openssl dgst -sha384 -binary | openssl base64 -A
```

Push to GitHub:
```bash
git push -u origin master
```

In repo Settings → Pages: source = `master` branch, folder = `/` (root). Wait ~1 min for the green check.

## 7. Deploy MCP Edge Function

```bash
supabase functions deploy mcp --no-verify-jwt
```
(`--no-verify-jwt` because we authenticate via our own bearer token, not Supabase's JWT.)

Generate a strong bearer token:
```bash
openssl rand -hex 32
```

Set the function's secrets:
```bash
supabase secrets set \
  PG_URL='postgres://nourin_app:<password-from-step-3>@aws-0-<your-region>.pooler.supabase.com:5432/postgres?sslmode=require' \
  NOURIN_USER_ID='<your-auth-uid-from-step-5>' \
  MCP_BEARER_TOKEN='<your-generated-bearer-token>'
```

The `PG_URL` host comes from your Supabase project's connection string (Dashboard → Project Settings → Database → "Connection string"). Use the **Session pooler** connection string and substitute the `nourin_app` user + password you set in step 3.

Test the function with a health check:
```bash
curl -i https://<your-project-ref>.supabase.co/functions/v1/mcp \
  -H 'Authorization: Bearer <your-bearer-token>'
# → 200 {"status":"ok","name":"vision-app-mcp","version":"1.0.0"}
```

## 8. Connect Claude (Code or Desktop)

> **Note:** claude.ai web/mobile **does not** support bearer-token custom connectors today — only OAuth ([GitHub issue #112](https://github.com/anthropics/claude-ai-mcp/issues/112)). Use Claude Code or Claude Desktop, both of which support custom HTTP headers natively. To unlock claude.ai web/mobile, an OAuth layer can be added on top of the MCP server (separate phase of work).

### Claude Code (in this repo)

```bash
claude mcp add --transport http vision-app \
  https://<your-project-ref>.supabase.co/functions/v1/mcp \
  --header "Authorization: Bearer <your-bearer-token>"
```

Restart Claude Code; from any conversation in this directory, ask "show my vision dashboard" and the tools become available.

### Claude Desktop

Edit `~/Library/Application Support/Claude/claude_desktop_config.json` (Mac) or `%APPDATA%/Claude/claude_desktop_config.json` (Windows):

```json
{
  "mcpServers": {
    "vision-app": {
      "transport": "http",
      "url": "https://<your-project-ref>.supabase.co/functions/v1/mcp",
      "headers": {
        "Authorization": "Bearer <your-bearer-token>"
      }
    }
  }
}
```

Restart Claude Desktop.

## 9. Restore your data

1. Open the legacy backup at `E:/1.Claude Code/_vision-app-legacy-backup/index (4).html` in your browser. (The file was kept out of the public repo for privacy. If your Chrome session still has the original tab open from before deployment, you can use that instead — same localStorage origin.)
2. Open DevTools console (F12), run:
   ```js
   copy(localStorage.getItem('nourin_dashboard_v1'))
   ```
   The full JSON is now on your clipboard.
3. Open the live web app at your GitHub Pages URL. Sign in via magic link (or 6-digit OTP).
4. Click the gear icon at the bottom-left of the sidebar → "Restore my data" → paste → Import.
5. Verify all projects, milestones, and log entries appear correctly.
6. From any device, sign in with the same email — same data appears.

You're done. Use the app on phone, laptop, claude.ai web/mobile, Claude Code, Claude desktop — all sharing the same data.

Once you've confirmed the import worked end-to-end, you can delete the local backup:
```bash
rm -rf "E:/1.Claude Code/_vision-app-legacy-backup/"
```

