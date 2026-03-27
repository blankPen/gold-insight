import { EventEmitter } from 'events';
import { chromium, Browser, Page } from 'playwright';
import { addPrice } from './db';

export const priceEmitter = new EventEmitter();

let browser: Browser | null = null;
let page: Page | null = null;
let isRunning = false;
let checkInterval: NodeJS.Timeout | null = null;
let lastPrice: number = 0;

const TRADINGVIEW_URL = 'https://www.tradingview.com/symbols/XAUUSD/';
const PRICE_SELECTOR = 'span[data-qa-id=symbol-last-value].js-symbol-last';

async function initializeBrowser(): Promise<void> {
  if (browser) return;

  console.log('[Scraper] Launching browser...');
  browser = await chromium.launch({
    headless: true,
    channel: 'chromium-headless-shell',
    proxy: { server: 'http://127.0.0.1:7890' },
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-dev-shm-usage',
      '--disable-blink-features=AutomationControlled',
    ],
  });

  console.log('[Scraper] Creating new page...');
  page = await browser.newPage({
    userAgent: 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  });

  await page.setViewportSize({ width: 1920, height: 1080 });

  console.log('[Scraper] Navigating to TradingView...');
  await page.goto(TRADINGVIEW_URL, {
    waitUntil: 'networkidle',
    timeout: 30000,
  });

  console.log('[Scraper] Page loaded, waiting for price element...');
  await page.waitForSelector(PRICE_SELECTOR, {
    state: 'attached',
    timeout: 15000,
  });

  // Wait until the element actually has price text
  await page.waitForFunction(
    (sel) => {
      const el = document.querySelector(sel);
      if (!el?.textContent) return false;
      const num = parseFloat(el.textContent.replace(/,/g, ''));
      return num > 0;
    },
    PRICE_SELECTOR,
    { timeout: 20000 },
  );

  console.log('[Scraper] Browser initialized successfully');
}

async function extractPrice(): Promise<number | null> {
  if (!page || !isRunning) return null;

  try {
    const element = await page.$(PRICE_SELECTOR);
    if (!element) {
      console.warn('[Scraper] Price element not found');
      return null;
    }

    const text = await element.textContent();
    if (!text) {
      console.warn('[Scraper] Price text is empty');
      return null;
    }

    const cleanText = text.replace(/,/g, '');
    const price = parseFloat(cleanText);

    if (isNaN(price)) {
      console.warn(`[Scraper] Failed to parse price: ${text}`);
      return null;
    }

    return price;
  } catch (error) {
    console.error('[Scraper] Error extracting price:', error);
    return null;
  }
}

async function checkPriceUpdates(): Promise<void> {
  const price = await extractPrice();

  if (price !== null && price > 0) {
    if (price !== lastPrice) {
      lastPrice = price;
      const timestamp = new Date().toISOString();
      const payload = { price, timestamp };

      addPrice(price, timestamp);
      console.log(`[Scraper] Price update: $${price}`);
      priceEmitter.emit('price', payload);
    }
  }
}

export const scraper = {
  async start() {
    if (isRunning) {
      console.log('[Scraper] Already running');
      return;
    }

    try {
      isRunning = true;
      await initializeBrowser();

      console.log('[Scraper] Starting price monitoring...');
      checkInterval = setInterval(checkPriceUpdates, 1000);
      await checkPriceUpdates();

      console.log('[Scraper] Started successfully');
    } catch (error) {
      console.error('[Scraper] Failed to start:', error);
      isRunning = false;
      throw error;
    }
  },

  async stop() {
    if (!isRunning) {
      console.log('[Scraper] Not running');
      return;
    }

    console.log('[Scraper] Stopping...');
    isRunning = false;

    if (checkInterval) {
      clearInterval(checkInterval);
      checkInterval = null;
    }

    if (page) {
      try { await page.close(); } catch { /* ignore */ }
      page = null;
    }

    if (browser) {
      try { await browser.close(); } catch { /* ignore */ }
      browser = null;
    }

    lastPrice = 0;
    console.log('[Scraper] Stopped');
  },

  get isRunning(): boolean {
    return isRunning;
  },
};

export default scraper;
