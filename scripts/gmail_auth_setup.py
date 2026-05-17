#!/usr/bin/env python3
"""
One-time Gmail OAuth setup — run this locally to get your refresh token.

Usage:
  pip install google-auth-oauthlib
  python scripts/gmail_auth_setup.py

Then copy the printed refresh token into your GitHub Actions secret GMAIL_REFRESH_TOKEN.
"""

from google_auth_oauthlib.flow import InstalledAppFlow

SCOPES = [
    "https://www.googleapis.com/auth/gmail.readonly",
    "https://www.googleapis.com/auth/gmail.send",
]

# Paste your OAuth client credentials here (download from Google Cloud Console)
CLIENT_CONFIG = {
    "installed": {
        "client_id":     "YOUR_CLIENT_ID",
        "client_secret": "YOUR_CLIENT_SECRET",
        "redirect_uris": ["urn:ietf:wg:oauth:2.0:oob", "http://localhost"],
        "auth_uri":      "https://accounts.google.com/o/oauth2/auth",
        "token_uri":     "https://oauth2.googleapis.com/token",
    }
}

flow = InstalledAppFlow.from_client_config(CLIENT_CONFIG, SCOPES)
creds = flow.run_local_server(port=0)

print("\n✓ Authentication successful!\n")
print(f"GMAIL_CLIENT_ID     = {CLIENT_CONFIG['installed']['client_id']}")
print(f"GMAIL_CLIENT_SECRET = {CLIENT_CONFIG['installed']['client_secret']}")
print(f"GMAIL_REFRESH_TOKEN = {creds.refresh_token}")
print("\nCopy these three values into your GitHub Actions repository secrets.")
