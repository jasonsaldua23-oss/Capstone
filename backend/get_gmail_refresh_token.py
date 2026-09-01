"""
Helper script to generate a Google OAuth 2.0 Refresh Token with Gmail API send permissions.

Usage:
    python backend/get_gmail_refresh_token.py
"""
import os
import sys
import urllib.parse
from pathlib import Path
import requests
from dotenv import load_dotenv

BASE_DIR = Path(__file__).resolve().parent
REPO_ROOT = BASE_DIR.parent

load_dotenv(REPO_ROOT / ".env", override=True)
load_dotenv(BASE_DIR / ".env", override=True)

CLIENT_ID = os.getenv("GOOGLE_OAUTH_CLIENT_ID", "").strip()
CLIENT_SECRET = os.getenv("GOOGLE_OAUTH_CLIENT_SECRET", "").strip()
SCOPE = "https://www.googleapis.com/auth/gmail.send"
REDIRECT_URI = "https://developers.google.com/oauthplayground"


def main():
    print("=" * 60)
    print("  GMAIL API REFRESH TOKEN GENERATOR")
    print("=" * 60)

    client_id = CLIENT_ID
    client_secret = CLIENT_SECRET

    if not client_id or not client_secret:
        print("\nNo GOOGLE_OAUTH_CLIENT_ID / GOOGLE_OAUTH_CLIENT_SECRET found in .env.")
        client_id = input("Enter your Google Client ID: ").strip()
        client_secret = input("Enter your Google Client Secret: ").strip()

    if not client_id or not client_secret:
        print("Error: Client ID and Secret are required.")
        sys.exit(1)

    auth_params = {
        "client_id": client_id,
        "redirect_uri": REDIRECT_URI,
        "response_type": "code",
        "scope": SCOPE,
        "access_type": "offline",
        "prompt": "consent",
    }
    auth_url = f"https://accounts.google.com/o/oauth2/v2/auth?{urllib.parse.urlencode(auth_params)}"

    print("\n--- STEP 1 ---")
    print("Ensure 'https://developers.google.com/oauthplayground' is added to your")
    print("Authorized redirect URIs in Google Cloud Console Credentials.")
    print("\n--- STEP 2 ---")
    print("Open this URL in your browser and authorize the app with your Gmail account:\n")
    print(auth_url)
    print("\n--- STEP 3 ---")
    print("After authorizing, you will be redirected to OAuth Playground.")
    print("Copy the 'authorization code' (or copy the 'code=...' value from the address bar).")

    auth_code = input("\nEnter the Authorization Code here: ").strip()
    if not auth_code:
        print("No code provided. Exiting.")
        sys.exit(1)

    # In case user pasted the whole query string or URL
    if "code=" in auth_code:
        parsed = urllib.parse.urlparse(auth_code)
        qs = urllib.parse.parse_qs(parsed.query or parsed.fragment)
        if "code" in qs:
            auth_code = qs["code"][0]
        else:
            # Fallback regex search for code parameter
            import re
            m = re.search(r'code=([^&]+)', auth_code)
            if m:
                auth_code = m.group(1)

    # Decode if URL-encoded
    auth_code = urllib.parse.unquote(auth_code)

    # If the user accidentally missed the leading "4/", add it
    codes_to_try = [auth_code]
    if not auth_code.startswith("4/") and (auth_code.startswith("0A") or auth_code.startswith("1A")):
        codes_to_try.append(f"4/{auth_code}")
    elif auth_code.startswith("4/"):
        codes_to_try.append(auth_code[2:])

    print("\nExchanging code for tokens...")
    resp = None
    for candidate_code in codes_to_try:
        resp = requests.post(
            "https://oauth2.googleapis.com/token",
            data={
                "client_id": client_id,
                "client_secret": client_secret,
                "code": candidate_code,
                "grant_type": "authorization_code",
                "redirect_uri": REDIRECT_URI,
            },
            timeout=15,
        )
        if resp.status_code == 200:
            break

    if resp is None or resp.status_code != 200:
        # Fix: requests.Response is false for HTTP errors, so test against None
        # explicitly or useful Google error details are incorrectly hidden as N/A.
        print(f"\n[ERROR] Failed to obtain tokens (HTTP {resp.status_code if resp is not None else 'N/A'}):")
        if resp is not None:
            print(resp.text)
        sys.exit(1)

    data = resp.json()
    refresh_token = data.get("refresh_token")

    if not refresh_token:
        print("\n[WARNING] No refresh_token returned.")
        print("This happens if prompt=consent was not used or authorization was already granted.")
        print(f"Response: {data}")
        sys.exit(1)

    print("\n" + "=" * 60)
    print("  SUCCESS! REFRESH TOKEN GENERATED:")
    print("=" * 60)
    print(f"\nGMAIL_API_REFRESH_TOKEN=\"{refresh_token}\"\n")

    env_path = REPO_ROOT / ".env"
    if env_path.exists():
        save = input("Do you want to save this directly to your .env file? (y/N): ").strip().lower()
        if save in {"y", "yes"}:
            content = env_path.read_text(encoding="utf-8")
            if "GMAIL_API_REFRESH_TOKEN=" in content:
                import re
                content = re.sub(r'GMAIL_API_REFRESH_TOKEN=.*', f'GMAIL_API_REFRESH_TOKEN="{refresh_token}"', content)
            else:
                content += f'\nGMAIL_API_REFRESH_TOKEN="{refresh_token}"\n'
            env_path.write_text(content, encoding="utf-8")
            print("Saved to .env successfully!")


if __name__ == "__main__":
    main()
