import asyncio
import json
import os
import sys
import time
import urllib.error
import urllib.request
from pathlib import Path

from playwright.async_api import async_playwright


LOCAL_ORIGIN = "http://127.0.0.1:5500"
DEFAULT_CAS_URL = "https://libyuyue.qlu.edu.cn/v4/login/cas"
PROFILE_DIR = Path(__file__).with_name(".cas-browser-profile")
CREDENTIALS_FILE = Path(__file__).with_name(".qlu-credentials.json")


def env_flag(name, default=False):
    value = os.environ.get(name)
    if value is None:
        return default
    return value.strip().lower() not in {"0", "false", "no", "off"}


def read_credentials():
    try:
        if CREDENTIALS_FILE.exists():
            data = json.loads(CREDENTIALS_FILE.read_text(encoding="utf-8"))
            username = str(data.get("username") or data.get("account") or data.get("student_id") or "").strip()
            password = str(data.get("password") or "")
            if username and password:
                return username, password, str(CREDENTIALS_FILE)
    except Exception as exc:
        print(f"Failed to read credentials file: {exc}")

    return "", "", ""


def api_json(path, payload=None, timeout=10):
    data = None
    headers = {"Content-Type": "application/json"}
    if payload is not None:
        data = json.dumps(payload).encode("utf-8")
    req = urllib.request.Request(f"{LOCAL_ORIGIN}{path}", data=data, headers=headers)
    with urllib.request.urlopen(req, timeout=timeout) as resp:
        return json.loads(resp.read().decode("utf-8"))


def local_server_ready():
    try:
        api_json("/api/status")
        return True
    except Exception:
        return False


def get_cas_url():
    try:
        config = api_json("/api/site-config").get("config") or {}
        return config.get("cas_url") or DEFAULT_CAS_URL
    except Exception:
        return DEFAULT_CAS_URL


async def read_token_from_page(page):
    try:
        if "libyuyue.qlu.edu.cn" not in page.url:
            return ""
        token = await page.evaluate("() => sessionStorage.getItem('token') || ''")
        return token.strip() if isinstance(token, str) else ""
    except Exception:
        return ""


async def visible_count(locator):
    try:
        return await locator.count()
    except Exception:
        return 0


async def auto_login(page, username, password):
    if not username or not password:
        return False

    try:
        username_input = page.locator("input[name='username']:visible").first
        password_input = page.locator("input[type='password']:visible").first
        if not await visible_count(page.locator("input[name='username']:visible")):
            return False
        if not await visible_count(page.locator("input[type='password']:visible")):
            return False

        await username_input.fill(username)
        await password_input.fill(password)

        submit_button = page.locator("button[type='submit']:visible, input[type='submit']:visible").first
        if await visible_count(page.locator("button[type='submit']:visible, input[type='submit']:visible")):
            await submit_button.click()
        else:
            await password_input.press("Enter")
        print("CAS credentials filled automatically.")
        return True
    except Exception as exc:
        print(f"Automatic CAS login failed: {exc}")
        return False


async def main():
    emit_token = "--emit-token" in sys.argv
    has_local_server = local_server_ready() and not emit_token
    cas_url = os.environ.get("QLU_CAS_URL") or get_cas_url()
    cas_username, cas_password, credential_source = read_credentials()
    auto_login_enabled = bool(cas_username and cas_password)
    headless = env_flag("QLU_CAS_HEADLESS", auto_login_enabled)

    print(f"Opening CAS login page: {cas_url}")
    if auto_login_enabled:
        print(f"CAS auto-login is enabled from {credential_source}.")
    else:
        print("Finish login in the browser window. This helper will wait for sessionStorage.token.")
    if has_local_server:
        print("Local web server detected. Token will be imported into the web helper.")
    else:
        print("No local web server detected. Token will be printed for the CMD helper.")

    async with async_playwright() as p:
        context = await p.chromium.launch_persistent_context(
            str(PROFILE_DIR),
            headless=headless,
            viewport={"width": 1280, "height": 860},
        )
        page = context.pages[0] if context.pages else await context.new_page()
        await page.goto(cas_url, wait_until="domcontentloaded")
        await auto_login(page, cas_username, cas_password)

        started = time.time()
        auto_login_attempts = 1 if auto_login_enabled else 0
        while time.time() - started < 300:
            for candidate in context.pages:
                token = await read_token_from_page(candidate)
                if token:
                    if emit_token:
                        print(f"__QLU_TOKEN__={token}", flush=True)
                    elif has_local_server:
                        result = api_json("/api/import-token", {"token": token})
                        print("Token imported into the web helper.")
                        if result.get("warning"):
                            print(result["warning"])
                    else:
                        print("")
                        print("Copy the full token line below into the CMD helper:")
                        print(token)
                    await context.close()
                    return 0
                if auto_login_enabled and auto_login_attempts < 3:
                    did_login = await auto_login(candidate, cas_username, cas_password)
                    if did_login:
                        auto_login_attempts += 1
            await asyncio.sleep(1)

        print("Timed out: token was not detected within 5 minutes.")
        print("After logging in, keep the browser on libyuyue.qlu.edu.cn and run this helper again.")
        await context.close()
        return 2


if __name__ == "__main__":
    try:
        raise SystemExit(asyncio.run(main()))
    except urllib.error.URLError as exc:
        print(f"Local helper request failed: {exc}")
        raise SystemExit(1)
    except KeyboardInterrupt:
        print("Cancelled.")
        raise SystemExit(130)
