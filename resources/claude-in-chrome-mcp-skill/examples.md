# Claude in Chrome MCP — Practical Examples

Real-world examples you can copy and adapt for your own projects.

---

## 🔍 Example 1: E-Commerce Product Scraper

**Goal:** Scrape product names, prices, and images from an online store.

```
# Skill: claude-in-chrome-mcp (browser automation)

WORKFLOW:
1. Open the product listing page
2. Extract product info from each row
3. Handle pagination (next page button)
4. Save all products to CSV

IMPLEMENTATION:

# Step 1: Open site
paneId = await mcp__codebrain__browser_open({
  url: "https://shop.example.com/products"
});

# Step 2: Read page structure
const tree = await mcp__codebrain__browser_get_accessibility_tree({
  paneId: paneId
});

# Step 3: Scrape products from current page
const products = [];
const rows = await mcp__codebrain__browser_eval({
  paneId: paneId,
  script: `
    document.querySelectorAll('.product-item').map(item => ({
      name: item.querySelector('.title')?.textContent,
      price: item.querySelector('.price')?.textContent,
      image: item.querySelector('img')?.src,
      url: item.querySelector('a')?.href
    }))
  `
});

products.push(...rows);

# Step 4: Paginate
while (true) {
  const nextBtn = await mcp__codebrain__browser_find_by_text({
    paneId: paneId,
    text: "Next"
  });
  
  if (!nextBtn) break; // No more pages
  
  await mcp__codebrain__browser_click({
    selector: ".pagination .next",
    paneId: paneId
  });
  
  await mcp__codebrain__browser_wait_for_load({
    paneId: paneId,
    timeout: 10000
  });
  
  // Repeat step 3...
  const moreRows = await mcp__codebrain__browser_eval({ ... });
  products.push(...moreRows);
}

# Step 5: Save to file
await file_write({
  path: "products.json",
  content: JSON.stringify(products, null, 2)
});
```

---

## 🔐 Example 2: Automated Login & Dashboard Access

**Goal:** Login to a web app and capture a screenshot of the dashboard.

```
# Skill: claude-in-chrome-mcp (browser automation)

WORKFLOW:
1. Open login page
2. Enter credentials
3. Submit form
4. Wait for redirect to dashboard
5. Take screenshot

IMPLEMENTATION:

const paneId = await mcp__codebrain__browser_open({
  url: "https://app.example.com/login"
});

# Wait for page to load
await mcp__codebrain__browser_wait_for_load({ paneId });

# Fill login form
await mcp__codebrain__browser_fill_form({
  paneId: paneId,
  fields: [
    { selector: "input#email", value: "test@example.com" },
    { selector: "input#password", value: "MyPassword123" }
  ]
});

# Click submit button
await mcp__codebrain__browser_click({
  selector: "button[type=submit]",
  paneId: paneId
});

# Wait for redirect to dashboard (timeout after 15 seconds)
await mcp__codebrain__browser_wait_for_url({
  urlPattern: "/dashboard",
  paneId: paneId,
  timeout: 15000
});

# Verify login success by checking for welcome text
const text = await mcp__codebrain__browser_get_text({ paneId });
if (text.includes("Welcome")) {
  console.log("✅ Login successful");
} else {
  console.error("❌ Login failed");
  return { ok: false, error: "Login unsuccessful" };
}

# Take screenshot of dashboard
const screenshot = await mcp__codebrain__browser_screenshot({ paneId });
console.log(screenshot);

# Annotate screenshot with important areas
await mcp__codebrain__browser_annotate({
  paneId: paneId,
  imagePath: "/tmp/dashboard.png",
  annotations: [
    {
      type: "box",
      selector: ".sidebar",
      color: "blue",
      label: "Navigation menu"
    },
    {
      type: "box",
      selector: ".main-content",
      color: "green",
      label: "Dashboard content"
    }
  ]
});
```

---

## 📝 Example 3: Form Filling & Validation

**Goal:** Fill a multi-step form and validate success.

```
# Skill: claude-in-chrome-mcp (browser automation)

WORKFLOW:
1. Open form page
2. Fill step 1
3. Click "Next"
4. Fill step 2
5. Submit
6. Verify success message

IMPLEMENTATION:

const paneId = await mcp__codebrain__browser_open({
  url: "https://example.com/form"
});

# Step 1: Fill personal info
await mcp__codebrain__browser_fill_form({
  paneId: paneId,
  fields: [
    { selector: "input[name=firstName]", value: "John" },
    { selector: "input[name=lastName]", value: "Doe" },
    { selector: "input[name=email]", value: "john@example.com" }
  ]
});

# Click Next button
await mcp__codebrain__browser_click_text({
  text: "Next",
  paneId: paneId
});

# Wait for step 2
await mcp__codebrain__browser_wait_for({
  selector: "input[name=address]",
  paneId: paneId,
  timeout: 5000
});

# Step 2: Fill address info
await mcp__codebrain__browser_fill_form({
  paneId: paneId,
  fields: [
    { selector: "input[name=address]", value: "123 Main St" },
    { selector: "input[name=city]", value: "New York" },
    { selector: "input[name=zipcode]", value: "10001" }
  ]
});

# Select country from dropdown
await mcp__codebrain__browser_select({
  selector: "select[name=country]",
  value: "United States",
  paneId: paneId
});

# Check terms checkbox
await mcp__codebrain__browser_check({
  selector: "input[type=checkbox][name=terms]",
  checked: true,
  paneId: paneId
});

# Submit form
await mcp__codebrain__browser_click_text({
  text: "Submit",
  paneId: paneId
});

# Wait for success page
await mcp__codebrain__browser_wait_for_text({
  text: "Thank you for submitting",
  paneId: paneId,
  timeout: 10000
});

# Verify
const finalText = await mcp__codebrain__browser_get_text({ paneId });
console.log(finalText);
```

---

## 🔍 Example 4: Dynamic Content Scraping (Infinite Scroll)

**Goal:** Scrape content from a page with infinite scroll / lazy loading.

```
# Skill: claude-in-chrome-mcp (browser automation)

WORKFLOW:
1. Open page with infinite scroll
2. Scroll to bottom
3. Wait for new items to load
4. Extract items
5. Repeat until all items loaded

IMPLEMENTATION:

const paneId = await mcp__codebrain__browser_open({
  url: "https://example.com/feed"
});

const allItems = [];
let previousCount = 0;

for (let i = 0; i < 10; i++) {
  # Scroll to bottom
  await mcp__codebrain__browser_scroll({
    selector: ".feed-container",
    direction: "down",
    amount: 5,
    paneId: paneId
  });

  # Wait for new items to load
  await new Promise(r => setTimeout(r, 2000)); // Give 2s for loading

  # Extract all items
  const items = await mcp__codebrain__browser_eval({
    paneId: paneId,
    script: `
      document.querySelectorAll('.feed-item').map((item, idx) => ({
        id: idx,
        title: item.querySelector('.title')?.textContent,
        author: item.querySelector('.author')?.textContent,
        likes: parseInt(item.querySelector('.likes')?.textContent || 0)
      }))
    `
  });

  const currentCount = items.length;
  console.log(`Found ${currentCount} items (new: ${currentCount - previousCount})`);

  # Check if we've loaded all items
  if (currentCount === previousCount) {
    console.log("✅ Reached end of feed");
    allItems.push(...items);
    break;
  }

  previousCount = currentCount;
  allItems.push(...items);
}

console.log(`Total items scraped: ${allItems.length}`);
```

---

## 🧪 Example 5: Testing a Web App (UI Test)

**Goal:** Automated UI testing: navigate, interact, verify.

```
# Skill: claude-in-chrome-mcp (browser automation)

WORKFLOW:
1. Open app
2. Perform action (click button)
3. Wait for result
4. Verify state
5. Check console for errors

IMPLEMENTATION:

const paneId = await mcp__codebrain__browser_open({
  url: "http://localhost:3000"
});

# Clear console to track errors
await mcp__codebrain__browser_clear_console({ paneId });

# Test 1: Button click
console.log("Test 1: Click button");
await mcp__codebrain__browser_click_text({
  text: "Generate Report",
  paneId: paneId
});

# Wait for loading spinner to disappear
await mcp__codebrain__browser_wait_for({
  selector: ".spinner",
  paneId: paneId,
  timeout: 10000
});

# Wait for result to appear
await mcp__codebrain__browser_wait_for_text({
  text: "Report generated",
  paneId: paneId,
  timeout: 5000
});

# Verify success
const text = await mcp__codebrain__browser_get_text({ paneId });
console.assert(
  text.includes("Report generated"),
  "Report generation failed"
);

# Test 2: Check for console errors
console.log("Test 2: Checking console for errors");
const consoleLogs = await mcp__codebrain__browser_console_log({
  paneId: paneId,
  level: "error"
});

if (consoleLogs.messages.length > 0) {
  console.error("❌ Console errors found:");
  consoleLogs.messages.forEach(msg => console.error(msg.message));
} else {
  console.log("✅ No console errors");
}

# Test 3: Check network requests
console.log("Test 3: Checking network requests");
const network = await mcp__codebrain__browser_network_log({ paneId });
const failedRequests = network.requests.filter(r => r.status >= 400);

if (failedRequests.length > 0) {
  console.error("❌ Failed network requests:");
  failedRequests.forEach(r => 
    console.error(`${r.url}: ${r.status}`)
  );
} else {
  console.log("✅ All network requests successful");
}

# Test 4: Take screenshot for manual review
console.log("Test 4: Taking screenshot");
const screenshot = await mcp__codebrain__browser_screenshot({ paneId });
console.log(screenshot);
```

---

## 🛠️ Example 6: Batch Operations (CDP Mode)

**Goal:** Execute multiple actions efficiently in one roundtrip.

```
# Skill: claude-in-chrome-mcp (browser automation)
# Note: Batch operations only work in CDP mode (native Chrome)

const paneId = await mcp__codebrain__browser_open({
  url: "https://example.com/admin"
});

# Execute 5 actions in a single roundtrip (faster!)
const result = await mcp__codebrain__browser_batch({
  paneId: paneId,
  actions: [
    # Action 1: Fill email field
    {
      name: "fill",
      selector: "input[type=email]",
      value: "admin@example.com"
    },
    
    # Action 2: Fill password field
    {
      name: "fill",
      selector: "input[type=password]",
      value: "SecurePassword123"
    },
    
    # Action 3: Click login button
    {
      name: "click",
      selector: "button.login-btn"
    },
    
    # Action 4: Wait for navigation
    {
      name: "wait_for_url",
      urlPattern: "/dashboard",
      timeout: 10000
    },
    
    # Action 5: Take screenshot
    {
      name: "screenshot"
    }
  ]
});

console.log("✅ All actions completed in one roundtrip");
console.log(result);
```

---

## 🌐 Example 7: Multi-Tab Automation (CDP Mode)

**Goal:** Open multiple tabs and manage them.

```
# Skill: claude-in-chrome-mcp (browser automation)
# Note: Tab operations only work in CDP mode (native Chrome)

const paneId = await mcp__codebrain__browser_open({
  url: "https://example.com/page1"
});

# Open second tab
const tab2Result = await mcp__codebrain__browser_tabs_create({
  paneId: paneId,
  url: "https://example.com/page2"
});

# Open third tab
const tab3Result = await mcp__codebrain__browser_tabs_create({
  paneId: paneId,
  url: "https://example.com/page3"
});

# List all tabs
const tabs = await mcp__codebrain__browser_tabs_list({ paneId });
console.log(`Open tabs: ${tabs.length}`);

# Switch between tabs and check content
for (let tab of tabs) {
  const text = await mcp__codebrain__browser_get_text({ paneId });
  console.log(`Tab ${tab.id}: "${text.substring(0, 50)}..."`);
}

# Close middle tab
await mcp__codebrain__browser_tabs_close({
  paneId: paneId,
  tabId: tab2Result.tabId
});

console.log("✅ Tab management complete");
```

---

## 💻 Example 8: JavaScript Execution in Page

**Goal:** Run custom JavaScript to extract/manipulate data.

```
# Skill: claude-in-chrome-mcp (browser automation)

const paneId = await mcp__codebrain__browser_open({
  url: "https://example.com"
});

# Example 1: Extract all links
const links = await mcp__codebrain__browser_eval({
  paneId: paneId,
  script: `
    Array.from(document.querySelectorAll('a'))
      .map(a => ({ href: a.href, text: a.textContent.trim() }))
      .filter(l => l.text.length > 0)
      .slice(0, 20)
  `
});

console.log("Links found:", links);

# Example 2: Get form data
const formData = await mcp__codebrain__browser_eval({
  paneId: paneId,
  script: `
    const form = document.querySelector('form');
    const formEntries = new FormData(form);
    const data = {};
    formEntries.forEach((value, key) => {
      data[key] = value;
    });
    data
  `
});

console.log("Form data:", formData);

# Example 3: Manipulate DOM (hide element)
const manipulateResult = await mcp__codebrain__browser_eval({
  paneId: paneId,
  script: `
    document.querySelector('.popup')?.style.display = 'none';
    'Hidden popup'
  `
});

console.log(manipulateResult);
```

---

## 🎯 Tips & Best Practices

### ✅ DO:
- Call `browser_guide()` before using any browser tool
- Use `browser_get_accessibility_tree()` to understand page structure
- Wait for elements to load: `browser_wait_for_load()`
- Check console/network for errors
- Take screenshots to verify state
- Use batch operations in CDP mode for speed

### ❌ DON'T:
- Hardcode coordinates without checking viewport size
- Use old selectors if page structure changed
- Click on invisible/disabled elements
- Forget to wait for page load after navigation
- Mix webview and CDP modes
- Leave sensitive credentials in code

### 🔥 Performance Tips:
1. Use `browser_batch()` to combine actions (CDP only)
2. Reuse paneId instead of opening multiple panes
3. Use `browser_get_accessibility_tree()` instead of parsing HTML manually
4. Set appropriate timeouts (not too long, not too short)
5. Clear console/network logs if they get too large

---

## 📞 Debugging Tips

### Issue: "Element not found"
```
# Solution: Get the accessibility tree
tree = await mcp__codebrain__browser_get_accessibility_tree({ paneId });
console.log(tree); # Find the correct selector
```

### Issue: "Click not working"
```
# Solution: Check element visibility
info = await mcp__codebrain__browser_get_element_info({
  selector: ".my-button",
  paneId
});
console.log(info); # Is it visible? Is it enabled?

# If there's an overlay, use coordinate-based click
screenshot = await mcp__codebrain__browser_screenshot({ paneId });
# Find coordinates visually, then:
await mcp__codebrain__browser_click_at({
  x: 150, y: 200,
  paneId
});
```

### Issue: "Page not loading"
```
# Solution: Wait longer and check for errors
await mcp__codebrain__browser_wait_for_load({
  paneId,
  timeout: 30000 # 30 seconds
});

errors = await mcp__codebrain__browser_console_log({
  paneId,
  level: "error"
});
console.log(errors);
```

---

**Happy automating! 🚀**
