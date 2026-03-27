import { chromium, Browser, Page } from 'playwright';

async function testTradingViewScraper() {
  let browser: Browser | null = null;
  let page: Page | null = null;

  try {
    console.log('[Test] Launching browser...');
    browser = await chromium.launch({
      headless: true,
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
      ],
    });

    console.log('[Test] Creating page...');
    page = await browser.newPage({
      userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    });

    await page.setViewportSize({ width: 1920, height: 1080 });

    console.log('[Test] Navigating to TradingView...');
    await page.goto('https://www.tradingview.com/symbols/XAUUSD/', {
      waitUntil: 'networkidle',
      timeout: 30000,
    });

    console.log('[Test] Waiting for price element...');
    const selector = 'span[data-qa-id=symbol-last-value].js-symbol-last';

    // Wait with timeout
    try {
      await page.waitForSelector(selector, { timeout: 15000 });
    } catch (error) {
      console.log('[Test] Selector not found, taking screenshot...');
      await page.screenshot({ path: 'debug-screenshot.png', fullPage: false });
      throw error;
    }

    console.log('[Test] Extracting price...');
    const element = await page.$(selector);
    if (!element) {
      throw new Error('Price element not found');
    }

    const text = await element.textContent();
    console.log(`[Test] Raw text: ${text}`);

    if (!text) {
      throw new Error('Price text is empty');
    }

    const cleanText = text.replace(/,/g, '');
    const price = parseFloat(cleanText);

    if (isNaN(price)) {
      throw new Error(`Failed to parse price: ${text}`);
    }

    console.log(`\n✅ SUCCESS! Current Gold Price (XAUUSD): $${price}\n`);

    // Test multiple reads
    console.log('[Test] Testing multiple reads (5 times, 2s interval)...');
    for (let i = 1; i <= 5; i++) {
      await new Promise((resolve) => setTimeout(resolve, 2000));

      const el = await page.$(selector);
      if (el) {
        const txt = await el.textContent();
        if (txt) {
          const p = parseFloat(txt.replace(/,/g, ''));
          if (!isNaN(p) && p > 0) {
            console.log(`[Test] Read ${i}: $${p}`);
          }
        }
      }
    }

    console.log('\n✅ All tests passed!');

  } catch (error) {
    console.error('\n❌ Test failed:', error);
    process.exit(1);
  } finally {
    if (page) {
      await page.close();
    }
    if (browser) {
      await browser.close();
    }
  }
}

testTradingViewScraper();
