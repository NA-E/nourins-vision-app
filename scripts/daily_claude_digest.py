#!/usr/bin/env python3
"""
Daily Claude & Anthropic Email Digest
Reads Gmail for Claude/Anthropic newsletters, summarizes them with Claude,
and sends a formatted digest email from you to yourself.

Required env vars:
  ANTHROPIC_API_KEY       — your Anthropic API key
  GMAIL_CLIENT_ID         — OAuth client ID (from Google Cloud Console)
  GMAIL_CLIENT_SECRET     — OAuth client secret
  GMAIL_REFRESH_TOKEN     — OAuth refresh token (one-time setup via auth.py)
  DIGEST_EMAIL            — your Gmail address (sender and recipient)
"""

import os
import sys
import json
import base64
import re
import html
from datetime import datetime, timezone, timedelta
from email.mime.multipart import MIMEMultipart
from email.mime.text import MIMEText

import anthropic
import httpx


# ── Config ──────────────────────────────────────────────────────────────────

ANTHROPIC_API_KEY   = os.environ["ANTHROPIC_API_KEY"]
GMAIL_CLIENT_ID     = os.environ["GMAIL_CLIENT_ID"]
GMAIL_CLIENT_SECRET = os.environ["GMAIL_CLIENT_SECRET"]
GMAIL_REFRESH_TOKEN = os.environ["GMAIL_REFRESH_TOKEN"]
DIGEST_EMAIL        = os.environ["DIGEST_EMAIL"]

SEARCH_QUERY = (
    '(subject:(Claude OR Anthropic) OR from:(anthropic.com) '
    'OR (Claude AI OR "Claude model" OR "Claude Sonnet" OR "Claude Opus" '
    'OR "Claude Haiku" OR "Anthropic newsletter" OR "Claude Code")) '
    'newer_than:1d -in:sent -in:draft'
)

MAX_THREADS   = 15   # max emails to fetch
BODY_CHAR_CAP = 6000 # max chars of body to send to Claude per email


# ── Gmail OAuth ──────────────────────────────────────────────────────────────

def get_access_token() -> str:
    resp = httpx.post(
        "https://oauth2.googleapis.com/token",
        data={
            "client_id":     GMAIL_CLIENT_ID,
            "client_secret": GMAIL_CLIENT_SECRET,
            "refresh_token": GMAIL_REFRESH_TOKEN,
            "grant_type":    "refresh_token",
        },
    )
    resp.raise_for_status()
    return resp.json()["access_token"]


def gmail_get(token: str, path: str, **params) -> dict:
    r = httpx.get(
        f"https://gmail.googleapis.com/gmail/v1/users/me/{path}",
        headers={"Authorization": f"Bearer {token}"},
        params=params,
        timeout=30,
    )
    r.raise_for_status()
    return r.json()


def strip_html(text: str) -> str:
    text = html.unescape(text)
    text = re.sub(r"<style[^>]*>.*?</style>", " ", text, flags=re.DOTALL | re.IGNORECASE)
    text = re.sub(r"<script[^>]*>.*?</script>", " ", text, flags=re.DOTALL | re.IGNORECASE)
    text = re.sub(r"<[^>]+>", " ", text)
    return re.sub(r"\s+", " ", text).strip()


def decode_part(data: str) -> str:
    try:
        return base64.urlsafe_b64decode(data + "==").decode("utf-8", errors="replace")
    except Exception:
        return ""


def extract_body(payload: dict) -> str:
    """Recursively pull the plaintext (or stripped HTML) from a message payload."""
    mime = payload.get("mimeType", "")
    body_data = payload.get("body", {}).get("data", "")

    if mime == "text/plain" and body_data:
        return decode_part(body_data)
    if mime == "text/html" and body_data:
        return strip_html(decode_part(body_data))

    for part in payload.get("parts", []):
        result = extract_body(part)
        if result:
            return result
    return ""


# ── Fetch emails ─────────────────────────────────────────────────────────────

def fetch_relevant_emails(token: str) -> list[dict]:
    threads_resp = gmail_get(
        token, "threads",
        q=SEARCH_QUERY,
        maxResults=MAX_THREADS,
    )
    threads = threads_resp.get("threads", [])
    if not threads:
        return []

    emails = []
    for t in threads:
        try:
            msg_list = gmail_get(token, f"threads/{t['id']}", format="metadata",
                                 metadataHeaders="Subject,From,Date")
            first = msg_list["messages"][0]
            headers = {h["name"]: h["value"] for h in first.get("payload", {}).get("headers", [])}
            subject = headers.get("Subject", "(no subject)")
            sender  = headers.get("From", "")
            date    = headers.get("Date", "")

            # fetch full body
            full = gmail_get(token, f"messages/{first['id']}", format="full")
            body = extract_body(full.get("payload", {}))[:BODY_CHAR_CAP]

            emails.append({"subject": subject, "sender": sender, "date": date, "body": body})
        except Exception as e:
            print(f"  Warning: skipped thread {t['id']}: {e}", file=sys.stderr)

    return emails


# ── Summarise with Claude ─────────────────────────────────────────────────────

SYSTEM_PROMPT = """You are an expert newsletter curator. You will receive a batch of emails about Claude AI and Anthropic. Your job:

1. Discard pure promotional/sales emails (subscription upsells with no real content).
2. For each remaining email, write a tight summary block with:
   - A bold headline (rewritten to be punchy and specific)
   - Category label (Strategy | Inside Anthropic | Practical Guide | Workflow | Research | News)
   - 3-5 bullet points with concrete details (real names, numbers, quotes where available)
   - One-sentence "Why it matters" takeaway

Return your response as JSON: a list of objects, each with keys:
  category, headline, bullets (list of strings), why_it_matters

Only include emails with real informational content. Skip pure promos."""

def summarise_emails(emails: list[dict]) -> list[dict]:
    client = anthropic.Anthropic(api_key=ANTHROPIC_API_KEY)

    batch_text = ""
    for i, e in enumerate(emails, 1):
        batch_text += f"\n\n--- EMAIL {i} ---\n"
        batch_text += f"Subject: {e['subject']}\nFrom: {e['sender']}\nDate: {e['date']}\n\n"
        batch_text += e["body"][:BODY_CHAR_CAP]

    message = client.messages.create(
        model="claude-opus-4-7",
        max_tokens=4096,
        system=SYSTEM_PROMPT,
        messages=[{"role": "user", "content": batch_text}],
    )
    raw = message.content[0].text

    # extract JSON from response (Claude may wrap it in ```json ... ```)
    match = re.search(r"\[.*\]", raw, re.DOTALL)
    if not match:
        raise ValueError(f"No JSON list found in Claude response:\n{raw[:500]}")
    return json.loads(match.group())


# ── Build HTML email ──────────────────────────────────────────────────────────

CATEGORY_COLORS = {
    "Strategy":          ("#c9a84c", "#fff8e6"),
    "Inside Anthropic":  ("#9b59b6", "#f8f0ff"),
    "Practical Guide":   ("#2e7d6e", "#f0faf8"),
    "Workflow":          ("#c0392b", "#fff5f5"),
    "Research":          ("#2980b9", "#f0f7ff"),
    "News":              ("#7f8c8d", "#f8f8f8"),
}

def cat_color(category: str) -> tuple[str, str]:
    for k, v in CATEGORY_COLORS.items():
        if k.lower() in category.lower():
            return v
    return ("#888888", "#f8f8f8")


def build_html(stories: list[dict], date_str: str) -> str:
    story_count = len(stories)

    def story_block(s: dict) -> str:
        accent, bg = cat_color(s.get("category", ""))
        bullets_html = "".join(
            f'<li style="margin-bottom:6px">{b}</li>'
            for b in s.get("bullets", [])
        )
        return f"""
    <tr>
      <td style="background:#fff;padding:8px 36px 0">
        <table width="100%" cellpadding="0" cellspacing="0"><tr><td style="border-top:1px solid #ede8e0;padding-top:24px">
          <p style="margin:0 0 6px;font-size:10px;letter-spacing:2.5px;text-transform:uppercase;color:{accent};font-family:Arial,sans-serif">{s.get("category","")}</p>
          <h2 style="margin:0 0 4px;font-size:18px;font-weight:700;color:#1a0a2e;line-height:1.3">{s.get("headline","")}</h2>
          <table width="100%" cellpadding="0" cellspacing="0" style="background:{bg};border-left:3px solid {accent};border-radius:0 6px 6px 0;margin:14px 0 14px">
            <tr><td style="padding:16px 18px">
              <ul style="margin:0;padding-left:18px;font-size:14px;line-height:1.8;color:#333">{bullets_html}</ul>
            </td></tr>
          </table>
          <table cellpadding="0" cellspacing="0" style="background:#1a0a2e;border-radius:6px;margin-bottom:24px"><tr><td style="padding:10px 16px">
            <p style="margin:0;font-size:13px;font-family:Arial,sans-serif"><span style="color:{accent}"><strong>Why it matters →</strong></span> <span style="color:#f5f0eb">{s.get("why_it_matters","")}</span></p>
          </td></tr></table>
        </td></tr></table>
      </td>
    </tr>"""

    stories_html = "".join(story_block(s) for s in stories)

    return f"""<!DOCTYPE html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#f5f0eb;font-family:Georgia,serif;color:#1a1a1a">
<table width="100%" cellpadding="0" cellspacing="0" style="background:#f5f0eb"><tr><td align="center" style="padding:32px 16px">
<table width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%">

  <tr><td style="background:#1a0a2e;border-radius:12px 12px 0 0;padding:32px 36px 24px">
    <p style="margin:0 0 4px;font-size:11px;letter-spacing:3px;color:#c9a84c;text-transform:uppercase;font-family:Arial,sans-serif">Daily Intelligence Digest</p>
    <h1 style="margin:0 0 8px;font-size:26px;font-weight:700;color:#f5f0eb;line-height:1.2">Claude &amp; Anthropic</h1>
    <p style="margin:0;font-size:13px;color:#9b8bb0;font-family:Arial,sans-serif">{date_str} &nbsp;·&nbsp; {story_count} stories &nbsp;·&nbsp; ~{story_count * 45} sec read</p>
  </td></tr>

  <tr><td style="background:linear-gradient(90deg,#c9a84c,#9b59b6,#c9a84c);height:3px"></td></tr>
  <tr><td style="background:#fff;padding:24px 36px 16px">
    <p style="margin:0;font-size:15px;line-height:1.7;color:#444">Everything worth knowing from your Claude &amp; Anthropic newsletters — curated and condensed so you get the signal without the scroll.</p>
  </td></tr>

  {stories_html}

  <tr><td style="background:#1a0a2e;border-radius:0 0 12px 12px;padding:24px 36px">
    <table width="100%" cellpadding="0" cellspacing="0"><tr><td style="border-top:1px solid #3d2a5e;padding-top:20px">
      <p style="margin:0 0 6px;font-size:11px;letter-spacing:2px;text-transform:uppercase;color:#c9a84c;font-family:Arial,sans-serif">This digest</p>
      <p style="margin:0 0 16px;font-size:13px;color:#9b8bb0;line-height:1.6">Auto-curated from your Claude &amp; Anthropic newsletters · {story_count} sources · {date_str}</p>
      <p style="margin:0;font-size:12px;color:#5a4a6e;font-family:Arial,sans-serif;font-style:italic">"Building the next version of herself · year one of many."</p>
    </td></tr></table>
  </td></tr>

</table></td></tr></table>
</body></html>"""


# ── Send email via Gmail API ──────────────────────────────────────────────────

def send_email(token: str, to: str, subject: str, html_body: str) -> None:
    msg = MIMEMultipart("alternative")
    msg["From"]    = to
    msg["To"]      = to
    msg["Subject"] = subject
    msg.attach(MIMEText(html_body, "html"))

    raw = base64.urlsafe_b64encode(msg.as_bytes()).decode()
    r = httpx.post(
        "https://gmail.googleapis.com/gmail/v1/users/me/messages/send",
        headers={"Authorization": f"Bearer {token}", "Content-Type": "application/json"},
        json={"raw": raw},
        timeout=30,
    )
    r.raise_for_status()


# ── Main ─────────────────────────────────────────────────────────────────────

def main():
    today = datetime.now(timezone.utc)
    date_str = today.strftime("%-d %B %Y")  # e.g. "17 May 2026"
    day_name = today.strftime("%A")          # e.g. "Sunday"

    print(f"[digest] {day_name} {date_str} — fetching Gmail…")
    token = get_access_token()

    emails = fetch_relevant_emails(token)
    print(f"[digest] Found {len(emails)} relevant email(s).")

    if not emails:
        print("[digest] Nothing to report today. No digest sent.")
        return

    print("[digest] Summarising with Claude…")
    stories = summarise_emails(emails)
    print(f"[digest] {len(stories)} story/stories after filtering.")

    if not stories:
        print("[digest] All emails were promotional. No digest sent.")
        return

    subject = f"☕ Your Daily Claude & Anthropic Digest — {day_name} {date_str}"
    html_body = build_html(stories, f"{day_name}, {date_str}")

    print(f"[digest] Sending to {DIGEST_EMAIL}…")
    send_email(token, DIGEST_EMAIL, subject, html_body)
    print("[digest] Done. ✓")


if __name__ == "__main__":
    main()
