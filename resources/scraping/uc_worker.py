"""Python 3, uc_worker.py, Chrome/Chromium, undetected-chromedriver + Selenium.

JSONL worker used by Codebrain's MCP scraping tools.  One process owns one
browser, which keeps WebDriver state isolated and makes forced cleanup cheap.
"""

from __future__ import annotations

import contextlib
import json
import os
import sys
import time
import traceback
from typing import Any
from urllib.parse import urlparse


driver = None

CHALLENGE_MARKERS = (
    "cf-mitigated",
    "challenge-platform",
    "cf_chl_opt",
    "cf-turnstile",
    "just a moment",
    "checking your browser",
    "attention required! | cloudflare",
    "enable javascript and cookies to continue",
    "verify you are human",
)


def emit(payload: dict[str, Any]) -> None:
    # stdout is a JSONL machine protocol. Windows child processes may inherit
    # cp1252, so ASCII escapes keep arbitrary page content from killing a call.
    sys.stdout.write(json.dumps(payload, ensure_ascii=True, default=str) + "\n")
    sys.stdout.flush()


def challenge_state() -> dict[str, Any]:
    if driver is None:
        return {"detected": False, "type": None, "markers": []}
    try:
        title = (driver.title or "").lower()
        source = (driver.page_source or "")[:20_000].lower()
        url = (driver.current_url or "").lower()
        found = [marker for marker in CHALLENGE_MARKERS if marker in title or marker in source or marker in url]
        challenge_type = None
        if found:
            challenge_type = "cloudflare" if any("cf-" in marker or "cloudflare" in marker for marker in found) else "browser_challenge"
        return {"detected": bool(found), "type": challenge_type, "markers": found[:5]}
    except Exception as exc:
        return {"detected": False, "type": None, "markers": [], "error": str(exc)}


def page_state() -> dict[str, Any]:
    if driver is None:
        return {"running": False}
    try:
        ready_state = driver.execute_script("return document.readyState")
    except Exception:
        ready_state = None
    return {
        "running": True,
        "url": driver.current_url,
        "title": driver.title,
        "ready_state": ready_state,
        "challenge": challenge_state(),
        "window_handles": len(driver.window_handles),
    }


def start_browser(args: dict[str, Any]) -> dict[str, Any]:
    global driver
    if driver is not None:
        raise RuntimeError("browser already started in this worker")

    try:
        with contextlib.redirect_stdout(sys.stderr):
            import undetected_chromedriver as uc
    except Exception as exc:
        raise RuntimeError(
            "undetected-chromedriver is not installed; run: "
            "python -m pip install undetected-chromedriver selenium"
        ) from exc

    options = uc.ChromeOptions()
    options.page_load_strategy = "eager"
    width = int(args.get("window_width") or 1920)
    height = int(args.get("window_height") or 1080)
    options.add_argument(f"--window-size={width},{height}")
    options.add_argument("--no-sandbox")
    options.add_argument("--disable-dev-shm-usage")
    options.add_argument("--js-flags=--expose-gc")

    browser_binary = args.get("browser_binary")
    if browser_binary:
        options.binary_location = os.path.abspath(browser_binary)

    profile_directory = args.get("profile_directory")
    if profile_directory:
        options.add_argument(f"--profile-directory={profile_directory}")

    if args.get("block_images"):
        options.add_experimental_option(
            "prefs",
            {
                "profile.managed_default_content_settings.images": 2,
                "profile.default_content_setting_values.fonts": 2,
            },
        )

    chrome_kwargs: dict[str, Any] = {
        "options": options,
        "headless": bool(args.get("headless")),
        "use_subprocess": True,
    }
    profile_path = args.get("profile_path")
    if profile_path:
        chrome_kwargs["user_data_dir"] = os.path.abspath(profile_path)
    if browser_binary:
        chrome_kwargs["browser_executable_path"] = os.path.abspath(browser_binary)
    if args.get("version_main") is not None:
        chrome_kwargs["version_main"] = int(args["version_main"])

    with contextlib.redirect_stdout(sys.stderr):
        driver = uc.Chrome(**chrome_kwargs)
    timeout_seconds = max(5, int(args.get("page_load_timeout_ms", 90_000)) // 1000)
    driver.set_page_load_timeout(timeout_seconds)
    driver.set_script_timeout(120)
    driver.implicitly_wait(2)
    debugger_address = (
        driver.capabilities.get("goog:chromeOptions", {}).get("debuggerAddress")
    )
    return {
        "browser": driver.capabilities.get("browserName"),
        "browser_version": driver.capabilities.get("browserVersion"),
        "headless": bool(args.get("headless")),
        "profile_path": os.path.abspath(profile_path) if profile_path else None,
        # The Node MCP bridge attaches a CDP client to this exact UC Chrome
        # instance for network capture and request interception.
        "debugger_address": debugger_address,
    }


def navigate(args: dict[str, Any]) -> dict[str, Any]:
    url = str(args.get("url") or "")
    parsed = urlparse(url)
    if parsed.scheme not in ("http", "https"):
        raise ValueError("url must use http or https")

    timeout_ms = max(5_000, min(300_000, int(args.get("timeout_ms") or 90_000)))
    driver.set_page_load_timeout(max(5, timeout_ms // 1000))
    started = time.monotonic()
    driver.get(url)

    deadline = time.monotonic() + timeout_ms / 1000
    while time.monotonic() < deadline:
        try:
            if driver.execute_script("return document.readyState") in ("interactive", "complete"):
                break
        except Exception:
            pass
        time.sleep(0.1)

    challenge_wait_ms = max(0, min(300_000, int(args.get("challenge_wait_ms") or 0)))
    if challenge_wait_ms:
        challenge_deadline = time.monotonic() + challenge_wait_ms / 1000
        while time.monotonic() < challenge_deadline and challenge_state()["detected"]:
            time.sleep(0.5)

    return {**page_state(), "elapsed_ms": round((time.monotonic() - started) * 1000)}


def wait_for(args: dict[str, Any]) -> dict[str, Any]:
    selector = args.get("selector")
    text = args.get("text")
    challenge_clear = bool(args.get("challenge_clear"))
    timeout_ms = max(100, min(300_000, int(args.get("timeout_ms") or 30_000)))
    poll_ms = max(50, min(2_000, int(args.get("poll_ms") or 250)))
    deadline = time.monotonic() + timeout_ms / 1000

    while time.monotonic() < deadline:
        matched = True
        if selector:
            matched = bool(driver.execute_script("return Boolean(document.querySelector(arguments[0]))", selector))
        if matched and text:
            matched = bool(driver.execute_script(
                "return (document.body?.innerText || '').includes(arguments[0])", text
            ))
        if matched and challenge_clear:
            matched = not challenge_state()["detected"]
        if matched:
            return {"matched": True, **page_state()}
        time.sleep(poll_ms / 1000)
    return {"matched": False, "timed_out": True, **page_state()}


def evaluate(args: dict[str, Any]) -> dict[str, Any]:
    script = str(args.get("script") or "")
    if not script:
        raise ValueError("script is required")
    if len(script) > 100_000:
        raise ValueError("script exceeds 100000 characters")
    values = args.get("args") or []
    timeout_ms = max(100, min(300_000, int(args.get("timeout_ms") or 30_000)))
    driver.set_script_timeout(max(1, timeout_ms // 1000))

    if args.get("await_promise", True):
        wrapper = """
const __values = arguments[0];
const __done = arguments[arguments.length - 1];
(async () => {
  try {
    const __fn = new Function('args', '"use strict"; return (async () => {\\n' + arguments[1] + '\\n})();');
    __done({ok: true, value: await __fn(__values)});
  } catch (error) {
    __done({ok: false, error: String(error && error.stack || error)});
  }
})();
"""
        result = driver.execute_async_script(wrapper, values, script)
        if not result.get("ok"):
            raise RuntimeError(result.get("error") or "JavaScript evaluation failed")
        return {"value": result.get("value")}

    return {"value": driver.execute_script(script, *values)}


EXTRACT_SCRIPT = r"""
const config = arguments[0];
const roots = config.item_selector
  ? Array.from(document.querySelectorAll(config.item_selector))
  : [config.root_selector ? document.querySelector(config.root_selector) : document];

function readOne(node, field) {
  if (!node) return null;
  if (field.attribute === 'html') return node.innerHTML;
  if (field.attribute === 'outerHTML') return node.outerHTML;
  if (field.attribute) return node.getAttribute(field.attribute);
  return node.textContent;
}

function clean(value, trim) {
  return typeof value === 'string' && trim !== false ? value.trim() : value;
}

return roots.filter(Boolean).map((root) => {
  const row = {};
  for (const field of config.fields) {
    if (field.multiple) {
      row[field.name] = Array.from(root.querySelectorAll(field.selector)).map((node) => clean(readOne(node, field), field.trim));
    } else {
      row[field.name] = clean(readOne(root.querySelector(field.selector), field), field.trim);
    }
  }
  return row;
});
"""


def extract(args: dict[str, Any]) -> dict[str, Any]:
    fields = args.get("fields") or []
    if not fields:
        raise ValueError("fields must be a non-empty array")
    result = driver.execute_script(
        EXTRACT_SCRIPT,
        {
            "root_selector": args.get("root_selector"),
            "item_selector": args.get("item_selector"),
            "fields": fields,
        },
    )
    return {"count": len(result), "data": result}


FETCH_BATCH_SCRIPT = r"""
const payload = arguments[0];
const done = arguments[arguments.length - 1];

function challenge(body, headers, status) {
  const sample = (body || '').slice(0, 10000).toLowerCase();
  const server = (headers.server || '').toLowerCase();
  const markers = ['cf-mitigated', 'challenge-platform', 'cf_chl_opt', 'cf-turnstile', 'just a moment', 'checking your browser', 'verify you are human'];
  return ((status === 403 || status === 503) && server.includes('cloudflare')) || markers.some((marker) => sample.includes(marker));
}

async function fetchOne(rawUrl) {
  let url;
  try { url = new URL(rawUrl, location.href); }
  catch (error) { return {url: rawUrl, ok: false, error: 'invalid_url'}; }
  if (!['http:', 'https:'].includes(url.protocol)) return {url: rawUrl, ok: false, error: 'unsupported_protocol'};
  if (payload.same_origin && url.origin !== location.origin) return {url: url.href, ok: false, error: 'cross_origin_blocked'};

  for (let attempt = 0; attempt <= payload.retries; attempt++) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), payload.timeout_ms);
    const started = performance.now();
    try {
      const response = await fetch(url.href, {
        method: payload.method,
        headers: payload.headers,
        body: ['GET', 'HEAD'].includes(payload.method) ? undefined : payload.body,
        credentials: 'include',
        redirect: 'follow',
        signal: controller.signal,
      });
      const text = await response.text();
      const headers = Object.fromEntries(response.headers.entries());
      clearTimeout(timer);
      if ((response.status === 429 || response.status >= 500) && attempt < payload.retries) {
        await new Promise((resolve) => setTimeout(resolve, 250 * Math.pow(2, attempt)));
        continue;
      }
      return {
        url: url.href,
        final_url: response.url,
        ok: response.ok,
        status: response.status,
        headers,
        body: text.slice(0, payload.max_chars_per_item),
        size: text.length,
        truncated: text.length > payload.max_chars_per_item,
        challenge: challenge(text, headers, response.status),
        elapsed_ms: Math.round(performance.now() - started),
        attempt: attempt + 1,
      };
    } catch (error) {
      clearTimeout(timer);
      if (attempt >= payload.retries) {
        return {url: url.href, ok: false, error: String(error), attempt: attempt + 1};
      }
    }
  }
}

(async () => {
  const results = new Array(payload.urls.length);
  let cursor = 0;
  async function worker() {
    while (true) {
      const index = cursor++;
      if (index >= payload.urls.length) return;
      results[index] = await fetchOne(payload.urls[index]);
    }
  }
  try {
    await Promise.all(Array.from({length: Math.min(payload.concurrency, payload.urls.length)}, worker));
    done({ok: true, results});
  } catch (error) {
    done({ok: false, error: String(error && error.stack || error)});
  }
})();
"""


def fetch_batch(args: dict[str, Any]) -> dict[str, Any]:
    urls = args.get("urls") or []
    if not urls or len(urls) > 100:
        raise ValueError("urls must contain between 1 and 100 entries")
    payload = {
        "urls": urls,
        "method": str(args.get("method") or "GET").upper(),
        "headers": args.get("headers") or {"Accept": "text/html,application/xhtml+xml,application/json;q=0.9,*/*;q=0.8"},
        "body": args.get("body"),
        "concurrency": max(1, min(20, int(args.get("concurrency") or 8))),
        "timeout_ms": max(500, min(120_000, int(args.get("timeout_ms") or 30_000))),
        "retries": max(0, min(3, int(args.get("retries") or 1))),
        "same_origin": args.get("same_origin", True) is not False,
        "max_chars_per_item": max(100, min(250_000, int(args.get("max_chars_per_item") or 50_000))),
    }
    batches = (len(urls) + payload["concurrency"] - 1) // payload["concurrency"]
    script_timeout = min(360, max(30, batches * (payload["timeout_ms"] / 1000) * (payload["retries"] + 1) + 10))
    driver.set_script_timeout(script_timeout)
    result = driver.execute_async_script(FETCH_BATCH_SCRIPT, payload)
    if not result.get("ok"):
        raise RuntimeError(result.get("error") or "batch fetch failed")
    responses = result.get("results") or []
    return {
        "total": len(responses),
        "success": sum(1 for item in responses if item.get("ok")),
        "failed": sum(1 for item in responses if not item.get("ok")),
        "challenges": sum(1 for item in responses if item.get("challenge")),
        "results": responses,
    }


def stop_browser() -> dict[str, Any]:
    global driver
    if driver is None:
        return {"stopped": False}
    try:
        driver.quit()
    finally:
        driver = None
    return {"stopped": True}


COMMANDS = {
    "start": start_browser,
    "status": lambda _args: page_state(),
    "navigate": navigate,
    "wait": wait_for,
    "evaluate": evaluate,
    "extract": extract,
    "fetch_batch": fetch_batch,
    "stop": lambda _args: stop_browser(),
}


def main() -> None:
    emit({"event": "ready", "protocol": 1, "pid": os.getpid()})
    for raw_line in sys.stdin:
        request_id = None
        try:
            request = json.loads(raw_line)
            request_id = request.get("id")
            command = request.get("command")
            handler = COMMANDS.get(command)
            if handler is None:
                raise ValueError(f"unknown command: {command}")
            if command != "start" and command != "stop" and driver is None:
                raise RuntimeError("browser is not started")
            result = handler(request.get("args") or {})
            emit({"id": request_id, "ok": True, "result": result})
            if command == "stop":
                break
        except Exception as exc:
            emit(
                {
                    "id": request_id,
                    "ok": False,
                    "error": str(exc),
                    "code": type(exc).__name__,
                    "details": traceback.format_exc(limit=8),
                }
            )

    try:
        stop_browser()
    except Exception:
        pass


if __name__ == "__main__":
    main()
