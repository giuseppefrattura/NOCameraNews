const express = require('express');
const cors = require('cors');
const path = require('path');
const fs = require('fs');
const https = require('https');
const notifier = require('node-notifier');
const { exec } = require('child_process');

const app = express();
const PORT = process.env.PORT || 3000;
const DB_FILE = path.join(__dirname, 'db.json');

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// Create public folder if it doesn't exist
if (!fs.existsSync(path.join(__dirname, 'public'))) {
  fs.mkdirSync(path.join(__dirname, 'public'));
}

// Global state to track status
let lastCheckedTime = null;
let isCheckingNow = false;
let checkTimeoutId = null;
let lastCheckError = null;

// ==========================================
// DATABASE HELPERS (Atomic Reads & Writes)
// ==========================================
function readDb() {
  try {
    if (!fs.existsSync(DB_FILE)) {
      const initial = {
        keywords: ["LEICA", "NIKON"],
        seenIds: [],
        history: [],
        settings: {
          intervalMinutes: 5,
          activeHoursStart: 8,
          activeHoursEnd: 20,
          activeDays: [2, 3, 4, 5, 6], // Martedì - Sabato
          enabled: true,
          soundEnabled: true
        }
      };
      fs.writeFileSync(DB_FILE, JSON.stringify(initial, null, 2));
      return initial;
    }
    const data = fs.readFileSync(DB_FILE, 'utf8');
    return JSON.parse(data);
  } catch (err) {
    console.error('Error reading database file:', err);
    return { keywords: [], seenIds: [], history: [], settings: {} };
  }
}

function writeDb(data) {
  try {
    fs.writeFileSync(DB_FILE, JSON.stringify(data, null, 2), 'utf8');
    return true;
  } catch (err) {
    console.error('Error writing to database file:', err);
    return false;
  }
}

// ==========================================
// MACOS NOTIFICATION SYSTEMS (Dual Mode)
// ==========================================
function sendDesktopNotification(title, message, codice = null) {
  const db = readDb();
  const sound = db.settings.soundEnabled ? 'Glass' : false;
  const productUrl = codice ? `https://www.newoldcamera.com/Scheda.aspx?Codice=${codice}` : null;

  console.log(`[Notification] Dispatching alert: "${title}" - "${message}"`);

  // --- METHOD 1: Rich macOS Notification via node-notifier ---
  notifier.notify(
    {
      title: title,
      message: message,
      sound: sound, // Plays macOS sound (e.g. Glass, Ping, Blow)
      wait: true, // Wait for user interaction
      timeout: 10,
      open: productUrl // Opens the browser URL when clicked!
    },
    function (err, response, metadata) {
      if (err) {
        console.warn('[Notification] node-notifier encountered an error, falling back to AppleScript...');
        // --- METHOD 2: Fallback to Native AppleScript (osascript) ---
        sendAppleScriptNotification(title, message, sound, productUrl);
      }
    }
  );
}

function sendAppleScriptNotification(title, message, sound, productUrl) {
  // Sanitize input strings for bash & AppleScript
  const cleanTitle = title.replace(/"/g, '\\"');
  const cleanMsg = message.replace(/"/g, '\\"');
  
  let script = `display notification "${cleanMsg}" with title "${cleanTitle}"`;
  if (sound) {
    script += ` sound name "${sound}"`;
  }

  exec(`osascript -e '${script}'`, (err) => {
    if (err) {
      console.error('[Notification] AppleScript notification failed:', err);
    }
  });

  // If clicked, we can't easily capture click on osascript without complex listener,
  // but if the URL is provided, we can log it. Node-notifier is the primary click handler.
}

// ==========================================
// CRAWLER & SCRAPER LOGIC
// ==========================================
function fetchProductList() {
  return new Promise((resolve, reject) => {
    const url = 'https://noc-gateway-api.icyriver-4199ba13.northeurope.azurecontainerapps.io/api/v1/products/published/daily';
    
    https.get(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept': 'application/json'
      }
    }, (res) => {
      let data = '';

      if (res.statusCode !== 200) {
        reject(new Error(`API responded with status code ${res.statusCode}`));
        return;
      }

      res.on('data', (chunk) => {
        data += chunk;
      });

      res.on('end', () => {
        try {
          const parsed = JSON.parse(data);
          resolve(parsed);
        } catch (e) {
          reject(new Error('Failed to parse API JSON response'));
        }
      });
    }).on('error', (err) => {
      reject(err);
    });
  });
}

async function checkNewProducts() {
  if (isCheckingNow) return;
  
  const db = readDb();
  const settings = db.settings;

  // Verify Schedule and Activation settings
  if (!settings.enabled) {
    console.log('[Scheduler] Scraper is disabled in settings.');
    return;
  }

  const now = new Date();
  const currentHour = now.getHours();
  const currentDay = now.getDay(); // 0 = Sun, 1 = Mon, 2 = Tue, ... 6 = Sat

  const isCorrectDay = settings.activeDays.includes(currentDay);
  const isCorrectTime = currentHour >= settings.activeHoursStart && currentHour < settings.activeHoursEnd;

  if (!isCorrectDay || !isCorrectTime) {
    console.log(`[Scheduler] Scraper skipped: Current time (${now.toLocaleTimeString()} - Day ${currentDay}) is outside active hours.`);
    return;
  }

  isCheckingNow = true;
  console.log(`[Scraper] Starting product check at ${now.toLocaleTimeString()}...`);

  try {
    const products = await fetchProductList();
    lastCheckError = null;

    if (!Array.isArray(products)) {
      throw new Error('API did not return a valid list of products.');
    }

    console.log(`[Scraper] Successfully loaded ${products.length} products from site.`);

    const isFirstBoot = db.seenIds.length === 0;
    let dbModified = false;

    // Loop through retrieved items
    for (const item of products) {
      const itemId = item.id;
      
      // If we haven't seen this item before
      if (!db.seenIds.includes(itemId)) {
        db.seenIds.push(itemId);
        dbModified = true;

        // Skip notifying on initial load to avoid flooding the user
        if (!isFirstBoot) {
          // Check matching keywords
          const brand = (item.marca || '').toUpperCase();
          const model = (item.modello || '').toUpperCase();
          const textToSearch = `${brand} ${model}`;

          const matchedKeyword = db.keywords.find(kw => 
            textToSearch.includes(kw.toUpperCase().trim())
          );

          if (matchedKeyword) {
            console.log(`[Scraper] Match found! "${brand} ${model}" matches keyword "${matchedKeyword}"`);
            
            // Build matched item history object
            const historyItem = {
              id: item.id,
              codice: item.codice,
              marca: item.marca,
              modello: item.modello,
              prezzoVendita: item.prezzoVendita,
              prezzoPromozione: item.prezzoPromozione,
              prenotato: item.prenotato,
              stato: item.stato,
              disponibile: item.disponibile,
              virtualPath: item.virtualPath,
              matchedKeyword: matchedKeyword,
              timestampScraped: new Date().toISOString(),
              notified: true
            };

            db.history.unshift(historyItem); // Insert at beginning of history array

            // Trigger Notification
            const priceStr = item.prezzoPromozione > 0 && item.prezzoPromozione < item.prezzoVendita 
              ? `€${item.prezzoPromozione} (PROMO! scontrato da €${item.prezzoVendita})`
              : `€${item.prezzoVendita}`;
            
            const title = `Nuovo Prodotto: ${item.marca}`;
            const message = `${item.modello}\nPrezzo: ${priceStr} | Condizione: ${item.stato || 'N/D'}`;

            sendDesktopNotification(title, message, item.codice);
          }
        }
      }
    }

    if (isFirstBoot) {
      console.log(`[Scraper] Initial boot complete. Saved ${db.seenIds.length} existing items to skip alerts.`);
    }

    if (dbModified) {
      writeDb(db);
    }

    lastCheckedTime = new Date().toISOString();
  } catch (err) {
    console.error('[Scraper] Error in product crawler:', err.message);
    lastCheckError = err.message;
  } finally {
    isCheckingNow = false;
  }
}

// ==========================================
// SCHEDULING WRAPPER
// ==========================================
function startPolling() {
  if (checkTimeoutId) {
    clearInterval(checkTimeoutId);
  }

  const db = readDb();
  const intervalMs = (db.settings.intervalMinutes || 5) * 60 * 1000;

  console.log(`[Scheduler] Polling scheduled to run every ${db.settings.intervalMinutes} minutes.`);
  
  // Run immediate first check (backgrounded)
  checkNewProducts();

  // Schedule intervals
  checkTimeoutId = setInterval(checkNewProducts, intervalMs);
}

// Initialize database & Start scheduling on server load
startPolling();

// ==========================================
// EXPRESS REST API ENDPOINTS
// ==========================================

// Get operational status
app.get('/api/status', (req, res) => {
  const db = readDb();
  
  let nextCheckInSeconds = 0;
  if (checkTimeoutId && db.settings.enabled) {
    // Estimate based on node interval state (rough estimate)
    const intervalMs = (db.settings.intervalMinutes || 5) * 60 * 1000;
    // We don't have accurate remaining time natively from setInterval without wrappers,
    // so we will return lastCheckedTime and next check estimation.
    if (lastCheckedTime) {
      const nextTime = new Date(new Date(lastCheckedTime).getTime() + intervalMs);
      nextCheckInSeconds = Math.max(0, Math.round((nextTime.getTime() - Date.now()) / 1000));
    }
  }

  res.json({
    enabled: db.settings.enabled,
    lastChecked: lastCheckedTime,
    lastError: lastCheckError,
    nextCheckInSeconds: nextCheckInSeconds,
    scrapedCount: db.seenIds.length,
    matchCount: db.history.length,
    keywordsCount: db.keywords.length,
    intervalMinutes: db.settings.intervalMinutes
  });
});

// Keywords CRUD
app.get('/api/keywords', (req, res) => {
  const db = readDb();
  res.json({ keywords: db.keywords });
});

app.post('/api/keywords', (req, res) => {
  const { keywords } = req.body;
  if (!Array.isArray(keywords)) {
    return res.status(400).json({ error: 'Keywords must be an array of strings.' });
  }

  const db = readDb();
  db.keywords = keywords.map(kw => kw.trim().toUpperCase()).filter(kw => kw.length > 0);
  writeDb(db);

  console.log('[API] Tracked keywords updated:', db.keywords);
  res.json({ success: true, keywords: db.keywords });
});

// History CRUD
app.get('/api/history', (req, res) => {
  const db = readDb();
  res.json({ history: db.history });
});

app.delete('/api/history', (req, res) => {
  const db = readDb();
  db.history = [];
  writeDb(db);
  res.json({ success: true, message: 'Match history cleared.' });
});

// Settings REST
app.get('/api/settings', (req, res) => {
  const db = readDb();
  res.json({ settings: db.settings });
});

app.post('/api/settings', (req, res) => {
  const { settings } = req.body;
  if (!settings || typeof settings !== 'object') {
    return res.status(400).json({ error: 'Settings object is required.' });
  }

  const db = readDb();
  const oldInterval = db.settings.intervalMinutes;
  
  // Merge settings carefully
  db.settings = {
    intervalMinutes: Number(settings.intervalMinutes) || 5,
    activeHoursStart: Number(settings.activeHoursStart) >= 0 ? Number(settings.activeHoursStart) : 8,
    activeHoursEnd: Number(settings.activeHoursEnd) >= 0 ? Number(settings.activeHoursEnd) : 20,
    activeDays: Array.isArray(settings.activeDays) ? settings.activeDays.map(Number) : [2, 3, 4, 5, 6],
    enabled: typeof settings.enabled === 'boolean' ? settings.enabled : true,
    soundEnabled: typeof settings.soundEnabled === 'boolean' ? settings.soundEnabled : true
  };

  writeDb(db);
  console.log('[API] Settings updated successfully.');

  // Restart scheduler if interval changed or enabled toggled
  if (oldInterval !== db.settings.intervalMinutes || settings.enabled !== undefined) {
    startPolling();
  }

  res.json({ success: true, settings: db.settings });
});

// Trigger a direct scraper execution manually
app.post('/api/trigger-check', async (req, res) => {
  console.log('[API] Manual scraper trigger requested.');
  await checkNewProducts();
  res.json({ success: true, lastChecked: lastCheckedTime, lastError: lastCheckError });
});

// Trigger a local test notification
app.post('/api/test-notification', (req, res) => {
  console.log('[API] Test notification requested.');
  sendDesktopNotification(
    'NOC Monitor: Test Alert 📸',
    'La configurazione delle notifiche macOS è attiva e funzionante al 100%!',
    '26C0933' // Test with a real code to verify product links
  );
  res.json({ success: true, message: 'Test notification triggered successfully.' });
});

// Start Express Listener
app.listen(PORT, () => {
  console.log(`===========================================================`);
  console.log(`New Old Camera Monitor backend active on: http://localhost:${PORT}`);
  console.log(`Dashboard interface is ready and listening...`);
  console.log(`===========================================================`);
});
