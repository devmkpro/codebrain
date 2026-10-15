# UC + JavaScript scraping MCP

The `scraping` tool group runs each Chrome/undetected-chromedriver session in
its own Python process. The MCP server owns lifecycle and request correlation;
Python owns WebDriver, page state, cookies, DOM execution, and cleanup.

## Runtime setup

```powershell
python -m pip install -r resources/scraping/requirements.txt
```

Set `CODEBRAIN_PYTHON` when the desired interpreter is not the first `py -3`,
`python`, or `python3` on `PATH`. Packaged builds copy `uc_worker.py` to
`resources/scraping`; `CODEBRAIN_UC_WORKER` can override that path.

## Tool flow

1. `enable_tool_group({ group: "scraping" })`
2. `scraping_session_start({ headless: false })`
3. `scraping_navigate({ session_id, url, challenge_wait_ms: 120000 })`
4. `scraping_wait({ session_id, selector: "main", challenge_clear: true })`
5. Use `scraping_extract`, `scraping_evaluate`, or `scraping_fetch_batch`.
6. `scraping_session_stop({ session_id })`

## Request capture and interception

Each UC worker exposes the Chrome DevTools endpoint of the Chrome process it
owns. The MCP bridge attaches to that endpoint when the session starts, so
network inspection and interception stay in the same UC browser and do not
fall back to a desktop/browser-extension controller.

1. `scraping_clear_network({ session_id })`
2. Navigate or trigger an action.
3. `scraping_network_log({ session_id, url_pattern: "/api/" })`

To pause a request deliberately, start interception before the action:

1. `scraping_intercept_start({ session_id, urlPatterns: ["*api*"] })`
2. Trigger the request.
3. `scraping_intercept_list({ session_id })`
4. `scraping_intercept_continue({ session_id, request_id })` for every paused request.
5. `scraping_intercept_stop({ session_id })`

Requests remain paused until continued, so narrow the URL pattern and always
stop interception during cleanup.

`scraping_fetch_batch` executes `window.fetch` inside the loaded page. It keeps
the browser's cookies and origin context, limits concurrency and body size, and
reports HTTP status, timing, retries, truncation, and challenge markers for each
URL. Cross-origin requests are rejected by default; pass `same_origin: false`
only when the loaded site permits that request through CORS.

`scraping_extract` avoids returning an entire page to the model. For a product
grid, pass `item_selector: ".product"` and fields such as:

```json
[
  { "name": "title", "selector": "h2" },
  { "name": "url", "selector": "a", "attribute": "href" },
  { "name": "images", "selector": "img", "attribute": "src", "multiple": true }
]
```

Responses are capped at two million serialized characters. Sessions are capped
at three per Codebrain process and are closed after twenty minutes of inactivity.
