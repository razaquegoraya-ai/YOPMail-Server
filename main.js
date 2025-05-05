require('dotenv').config();
const express = require('express');
const { chromium } = require('@playwright/test');
const axios = require('axios');
const { HttpsProxyAgent } = require('https-proxy-agent');
const pLimit = require('p-limit');
const fs = require('fs');
const path = require('path');
const app = express();

// Ensure temp directory exists
const tempDir = path.join(__dirname, 'temp');
if (!fs.existsSync(tempDir)) {
  fs.mkdirSync(tempDir, { recursive: true });
}

// Configuration from environment variables
const config = {
  proxy: {
    list: process.env.PROXY_LIST ? process.env.PROXY_LIST.split(',') : [],
    currentIndex: 0
  },
  concurrency: parseInt(process.env.CONCURRENCY_LIMIT) || 8,
  maxRetries: parseInt(process.env.MAX_RETRIES) || 3,
  retryDelay: parseInt(process.env.RETRY_DELAY) || 1000
};

const port = process.env.YOPMAIL_SERVER_PORT || 7091;

// Initialize rate limiter
const limit = pLimit(config.concurrency);

// Proxy rotation function
function getNextProxy() {
  if (!config.proxy.list.length) return null;
  const proxy = config.proxy.list[config.proxy.currentIndex];
  config.proxy.currentIndex = (config.proxy.currentIndex + 1) % config.proxy.list.length;
  return proxy;
}

let browser = null;

async function initBrowser() {
  if (!browser) {
    const proxy = getNextProxy();
    const launchOptions = {
      headless: true,
      args: [
        '--disable-blink-features=AutomationControlled',
        '--disable-features=IsolateOrigins,site-per-process',
        '--disable-web-security',
        '--disable-features=IsolateOrigins',
        '--disable-site-isolation-trials',
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--disable-accelerated-2d-canvas',
        '--no-first-run',
        '--no-zygote',
        '--disable-gpu'
      ]
    };

    if (proxy) {
      launchOptions.proxy = {
        server: proxy
      };
    }

    browser = await chromium.launch(launchOptions);
  }
  return browser;
}

async function getInbox(alias) {
  let retries = 3;
  while (retries > 0) {
    try {
      console.log(`Fetching inbox for ${alias}... (Attempts remaining: ${retries})`);

      const browser = await initBrowser();
      const context = await browser.newContext({
        userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
        viewport: { width: 1920, height: 1080 },
        locale: 'en-US',
        timezoneId: 'America/New_York',
        permissions: ['geolocation'],
        geolocation: { latitude: 40.7128, longitude: -74.0060 },
        deviceScaleFactor: 2,
        hasTouch: false,
        isMobile: false,
        acceptDownloads: true
      });

      const page = await context.newPage();
      await page.setDefaultTimeout(60000);
      await page.setDefaultNavigationTimeout(60000);

      // Add stealth scripts
      await page.addInitScript(() => {
        Object.defineProperty(navigator, 'webdriver', { get: () => false });
        Object.defineProperty(navigator, 'plugins', { get: () => [1, 2, 3, 4, 5] });
        Object.defineProperty(navigator, 'languages', { get: () => ['en-US', 'en'] });
      });

      console.log('Navigating to YOPMail...');
      // Navigate to YOPMail with retry logic
      let navigationSuccess = false;
      for (let i = 0; i < 3 && !navigationSuccess; i++) {
        try {
          const response = await page.goto('https://yopmail.com/', {
            waitUntil: 'domcontentloaded',
            timeout: 60000
          });

          if (response) {
            console.log(`Navigation status: ${response.status()}`);
            if (response.status() === 200) {
              navigationSuccess = true;
            }
          }
        } catch (e) {
          console.log(`Navigation attempt ${i + 1} failed: ${e.message}`);
          await page.waitForTimeout(2000);
        }
      }

      if (!navigationSuccess) {
        throw new Error('Failed to navigate to YOPMail after multiple attempts');
      }

      console.log('Waiting for page to be ready...');
      await page.waitForTimeout(5000); // Give extra time for page to stabilize

      // Debug: Log page content
      const pageContent = await page.content();
      console.log('Page loaded. Checking for login form...');

      // Try multiple selectors for the email input
      const selectors = [
        'input#login',
        'input[name="login"]',
        'input[type="text"]',
        'input.login'
      ];

      let inputFound = false;
      for (const selector of selectors) {
        try {
          console.log(`Trying selector: ${selector}`);
          const input = await page.waitForSelector(selector, { timeout: 10000 });
          if (input) {
            console.log(`Found input with selector: ${selector}`);
            await input.fill(alias, { delay: 100 });
            inputFound = true;
            break;
          }
        } catch (e) {
          console.log(`Selector ${selector} not found`);
        }
      }

      if (!inputFound) {
        throw new Error('Could not find email input field with any known selector');
      }

      await page.waitForTimeout(Math.random() * 1000 + 500);

      // Try multiple selectors for the check inbox button
      const buttonSelectors = [
        'button[title="Check Inbox"]',
        'input[type="submit"]',
        'button:has-text("Check Inbox")',
        'button.checkinbox'
      ];

      let buttonFound = false;
      for (const selector of buttonSelectors) {
        try {
          console.log(`Trying button selector: ${selector}`);
          const button = await page.waitForSelector(selector, { timeout: 10000 });
          if (button) {
            console.log(`Found button with selector: ${selector}`);
            await button.click();
            buttonFound = true;
            break;
          }
        } catch (e) {
          console.log(`Button selector ${selector} not found`);
        }
      }

      if (!buttonFound) {
        throw new Error('Could not find check inbox button with any known selector');
      }

      console.log('Waiting for inbox to load...');
      await page.waitForTimeout(Math.random() * 2000 + 1000);

      // Switch to inbox frame
      console.log('Looking for inbox frame...');
      const inboxFrame = page.frameLocator('#ifinbox');
      await inboxFrame.waitFor({ timeout: 30000 });

      // Get all email elements
      console.log('Getting email list...');
      const emails = await inboxFrame.locator('.m').all();
      const emailData = [];

      for (const email of emails) {
        const id = await email.getAttribute('id');
        const subject = await email.locator('.lms').textContent();
        const from = await email.locator('.lmf').textContent();

        emailData.push({
          id,
          subject: subject.trim(),
          from: from.trim(),
          href: `https://yopmail.com/en/mail?b=${id}&id=${id}`
        });
      }

      await context.close();
      return { mails: emailData };
    } catch (error) {
      console.error(`Error getting inbox (Attempt ${4-retries}/3):`, error);
      retries--;
      if (retries === 0) throw error;
      await new Promise(resolve => setTimeout(resolve, 5000)); // Wait 5 seconds before retry
    }
  }
}

async function readMail(url) {
  let retries = 3;
  while (retries > 0) {
    try {
      console.log(`Reading mail from ${url}... (Attempts remaining: ${retries})`);

      const browser = await initBrowser();
      const context = await browser.newContext({
        userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
        viewport: { width: 1920, height: 1080 },
        locale: 'en-US',
        timezoneId: 'America/New_York',
        permissions: ['geolocation'],
        geolocation: { latitude: 40.7128, longitude: -74.0060 },
        deviceScaleFactor: 2,
        hasTouch: false,
        isMobile: false,
        acceptDownloads: true
      });

      const page = await context.newPage();
      await page.setDefaultTimeout(60000);
      await page.setDefaultNavigationTimeout(60000);

      // Add stealth scripts
      await page.addInitScript(() => {
        Object.defineProperty(navigator, 'webdriver', { get: () => false });
        Object.defineProperty(navigator, 'plugins', { get: () => [1, 2, 3, 4, 5] });
        Object.defineProperty(navigator, 'languages', { get: () => ['en-US', 'en'] });
      });

      // Navigate with retry logic
      let navigationSuccess = false;
      for (let i = 0; i < 3 && !navigationSuccess; i++) {
        try {
          await page.goto(url, {
            waitUntil: 'networkidle',
            timeout: 60000
          });
          navigationSuccess = true;
        } catch (e) {
          console.log(`Navigation attempt ${i + 1} failed: ${e.message}`);
          await page.waitForTimeout(2000);
        }
      }

      if (!navigationSuccess) {
        throw new Error('Failed to navigate to email after multiple attempts');
      }

      // Switch to mail frame
      const mailFrame = page.frameLocator('#ifmail');
      await mailFrame.waitFor({ timeout: 30000 });

      // Get email content
      const content = await mailFrame.locator('#mail').textContent();

      await context.close();
      return content.trim();
    } catch (error) {
      console.error(`Error reading mail (Attempt ${4-retries}/3):`, error);
      retries--;
      if (retries === 0) throw error;
      await new Promise(resolve => setTimeout(resolve, 5000)); // Wait 5 seconds before retry
    }
  }
}

function extractVerificationCode(content) {
  // Common verification code patterns
  const patterns = [
    /verification code[^\d]*(\d{4,8})/i,
    /code[^\d]*(\d{4,8})/i,
    /(\d{4,8})[^\d]*is your verification code/i,
    /(\d{4,8})[^\d]*is your code/i
  ];

  for (const pattern of patterns) {
    const match = content.match(pattern);
    if (match && match[1]) {
      return match[1];
    }
  }

  return null;
}

// Cleanup function
async function cleanup() {
  if (browser) {
    await browser.close();
    browser = null;
  }
}

// Handle cleanup on process termination
process.on('SIGTERM', cleanup);
process.on('SIGINT', cleanup);

app.use(express.json());

app.post('/read', async (req, res) => {
  const { alias: rawAlias, subject } = req.body;
  const alias = rawAlias ? rawAlias.toLowerCase() : null;

  if (!alias) {
    return res.status(400).json({ error: 'Email alias is required' });
  }

  try {
    const inbox = await limit(() => getInbox(alias));

    if (!inbox.mails.length) {
      return res.json({ code: null, message: 'No emails found' });
    }

    let targetMail = inbox.mails[0]; // Default to latest email

    if (subject) {
      const matchingMail = inbox.mails.find(mail =>
        mail.subject.toLowerCase().includes(subject.toLowerCase())
      );
      if (matchingMail) {
        targetMail = matchingMail;
      }
    }

    const content = await limit(() => readMail(targetMail.href));
    const code = extractVerificationCode(content);

    res.json({
      code,
      email: targetMail,
      content
    });
  } catch (error) {
    console.error('Error processing request:', error);
    res.status(500).json({ error: 'Failed to process request', details: error.message });
  }
});

app.post('/code', async (req, res) => {
  const { alias: rawAlias, subject } = req.body;
  const alias = rawAlias ? rawAlias.toLowerCase() : null;

  if (!alias) {
    return res.status(400).json({ success: false, message: 'Missing alias parameter', code: null });
  }

  try {
    const proxy = getNextProxy();
    const proxyAgent = createProxyAgent(proxy);

    console.log(`Processing code request for alias: ${alias}, subject: ${subject || 'any'}, using proxy: ${proxy || 'none'}`);

    // Get inbox for the email alias
    const inboxData = await getInbox(alias);

    if (!inboxData || !inboxData.mails || inboxData.mails.length === 0) {
      return { success: false, message: 'No emails found', code: null };
    }

    // Find message matching the subject, or use the first email
    let targetEmail;
    if (subject) {
      targetEmail = inboxData.mails.find(mail =>
        mail.subject && mail.subject.includes(subject)
      );
    }

    // If no matching email found, use the first one
    if (!targetEmail && inboxData.mails.length > 0) {
      targetEmail = inboxData.mails[0];
    }

    if (!targetEmail) {
      return { success: false, message: 'No matching email found', code: null };
    }

    console.log(`Found message with ID: ${targetEmail.id}`);

    // Get message content
    const messageContent = await readMail(targetEmail.href);

    // Extract verification code
    const code = extractVerificationCode(messageContent);

    if (code) {
      console.log(`Found verification code: ${code}`);
      return {
        success: true,
        code: code,
        message: 'Verification code found'
      };
    } else {
      console.log('No verification code found');
      return {
        success: false,
        code: null,
        message: 'No verification code found'
      };
    }
  } catch (error) {
    console.error('Error extracting code:', error);
    res.status(500).json({ success: false, code: null, message: 'Error extracting code' });
  }
});

app.post('/get-code', async (req, res) => {
  const { alias: rawAlias, subject } = req.body;
  const alias = rawAlias ? rawAlias.toLowerCase() : null;

  if (!alias) {
    return res.send('');
  }

  try {
    const proxy = getNextProxy();
    const proxyAgent = createProxyAgent(proxy);

    console.log(`Processing get-code request for alias: ${alias}, subject: ${subject || 'any'}, using proxy: ${proxy || 'none'}`);

    // Get inbox for the email alias
    const inboxData = await getInbox(alias);

    if (!inboxData || !inboxData.mails || inboxData.mails.length === 0) {
      console.log('No emails found');
      return res.send('');
    }

    // Process each email until we find a code
    for (let i = 0; i < Math.min(3, inboxData.mails.length); i++) {
      const email = inboxData.mails[i];

      // Skip if subject is specified and doesn't match
      if (subject && (!email.subject || !email.subject.includes(subject))) {
        continue;
      }

      console.log(`Checking email ${i+1} with ID: ${email.id}`);

      try {
        // Get message content
        const messageContent = await readMail(email.href);

        // Extract verification code
        const code = extractVerificationCode(messageContent);

        if (code) {
          console.log(`Found verification code: ${code}`);
          return res.send(code);
        }
      } catch (e) {
        console.log(`Error reading email ${i+1}: ${e.message}`);
        continue;
      }
    }

    console.log('No verification code found in any email');
    return res.send('');
  } catch (error) {
    console.error('Error extracting code:', error);
    res.send('');
  }
});

// Add a simple health check endpoint
app.get('/', (req, res) => {
  res.send('YOPMail server is running');
});

app.listen(port, () => {
  console.log(`YOPMail server listening at http://localhost:${port}`);
  console.log('Available endpoints:');
  console.log('- GET / - Health check');
  console.log('- POST /read - Read email content');
  console.log('- POST /code - Extract verification code (JSON response)');
  console.log('- POST /get-code - Get verification code as plain text');
});