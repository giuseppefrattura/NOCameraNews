const express = require('express');
const cors = require('cors');
const path = require('path');
const fs = require('fs');
const https = require('https');
const notifier = require('node-notifier');

const app = express();
const PORT = process.env.PORT || 3000;

// Setup PostgreSQL Connection Pool
const { Pool } = require('pg');
const pool = new Pool({
  connectionString: process.env.DATABASE_URL || 'postgresql://postgres:postgrespassword@localhost:5432/nocameranews'
});

async function initDb(retries = 10, delay = 2000) {
  for (let i = 0; i < retries; i++) {
    try {
      const client = await pool.connect();
      try {
        // Create preferences table
        await client.query(`
          CREATE TABLE IF NOT EXISTS app_preferences (
            key VARCHAR(50) PRIMARY KEY,
            value JSONB NOT NULL
          );
        `);

        // Create daily products table
        await client.query(`
          CREATE TABLE IF NOT EXISTS all_daily_products (
            id BIGINT PRIMARY KEY,
            data JSONB NOT NULL,
            timestamp_scraped TIMESTAMP DEFAULT CURRENT_TIMESTAMP
          );
        `);

        // Initialize default db settings if they do not exist
        const dbCheck = await client.query("SELECT 1 FROM app_preferences WHERE key = 'db'");
        if (dbCheck.rowCount === 0) {
          const initialDb = {
            keywords: ["LEICA", "NIKON"],
            history: [],
            settings: {
              intervalMinutes: 5,
              activeHoursStart: 8,
              activeHoursEnd: 20,
              activeDays: [2, 3, 4, 5, 6], // Martedì - Sabato
              enabled: true,
              soundEnabled: true,
              desktopEnabled: true,
              telegramEnabled: false,
              telegramToken: "",
              telegramChatId: ""
            }
          };
          await client.query("INSERT INTO app_preferences (key, value) VALUES ($1, $2)", ['db', initialDb]);
          console.log('[Database] Default app settings database seeded.');
        }

        // Initialize default seen_ids if they do not exist
        const seenIdsCheck = await client.query("SELECT 1 FROM app_preferences WHERE key = 'seen_ids'");
        if (seenIdsCheck.rowCount === 0) {
          const initialSeenIds = {
            lastClearedDate: new Date().toDateString(),
            ids: []
          };
          await client.query("INSERT INTO app_preferences (key, value) VALUES ($1, $2)", ['seen_ids', initialSeenIds]);
          console.log('[Database] Default seen_ids tracker seeded.');
        }

        console.log('[Database] PostgreSQL tables initialized successfully.');
        return; // Connection and init succeeded, exit loop
      } finally {
        client.release();
      }
    } catch (err) {
      console.warn(`[Database] Connection attempt ${i + 1} failed: ${err.message}. Retrying in ${delay / 1000}s...`);
      if (i === retries - 1) {
        throw err;
      }
      await new Promise(resolve => setTimeout(resolve, delay));
    }
  }
}

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

const PRODUCT_API_TIMEOUT_MS = 15000;

// ==========================================
// DATABASE HELPERS (Atomic Reads & Writes)
// ==========================================
let dbWriteChain = Promise.resolve();
function withDbLock(task) {
  const run = dbWriteChain.then(task, task);
  dbWriteChain = run.then(() => undefined, () => undefined);
  return run;
}

async function readDb() {
  try {
    const res = await pool.query("SELECT value FROM app_preferences WHERE key = 'db'");
    if (res.rowCount > 0) {
      const parsed = res.rows[0].value;
      
      // Self-migrating settings layer
      if (parsed.settings) {
        let modified = false;
        if (parsed.settings.telegramEnabled === undefined) {
          parsed.settings.telegramEnabled = false;
          modified = true;
        }
        if (parsed.settings.telegramToken === undefined) {
          parsed.settings.telegramToken = "";
          modified = true;
        }
        if (parsed.settings.telegramChatId === undefined) {
          parsed.settings.telegramChatId = "";
          modified = true;
        }
        if (parsed.settings.desktopEnabled === undefined) {
          parsed.settings.desktopEnabled = true;
          modified = true;
        }
        if (modified) {
          await writeDb(parsed);
        }
      }
      
      return parsed;
    }
  } catch (err) {
    console.error('Error reading database from PostgreSQL:', err);
  }
  return { keywords: [], history: [], settings: {} };
}

// ==========================================
// TELEGRAM BOT RICH MEDIA NOTIFICATIONS
// ==========================================
function escapeHtmlForTelegram(str) {
  if (!str) return '';
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

async function sendTelegramNotification(title, message, codice = null, imageSrc = null) {
  const db = await readDb();
  const token = db.settings.telegramToken;
  const chatId = db.settings.telegramChatId;
  const enabled = db.settings.telegramEnabled;

  if (!enabled || !token || !chatId) {
    return;
  }

  const productUrl = codice ? `https://www.newoldcamera.com/Scheda.aspx?Codice=${codice}` : null;
  const captionHtml = `<b>${escapeHtmlForTelegram(title)}</b>\n\n${escapeHtmlForTelegram(message)}`;
  
  const inlineKeyboard = productUrl ? {
    inline_keyboard: [
      [
        {
          text: 'Vedi Articolo 📸',
          url: productUrl
        }
      ]
    ]
  } : null;

  try {
    if (imageSrc) {
      // Send as photo
      const response = await fetch(`https://api.telegram.org/bot${token}/sendPhoto`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          chat_id: chatId,
          photo: imageSrc,
          caption: captionHtml,
          parse_mode: 'HTML',
          reply_markup: inlineKeyboard
        })
      });

      if (response.ok) {
        console.log('[Telegram] Photo notification dispatched successfully.');
        return;
      } else {
        const errText = await response.text();
        console.warn(`[Telegram] Failed to send photo (falling back to text): ${errText}`);
      }
    }

    // Fallback/Text Message
    const response = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: chatId,
        text: captionHtml,
        parse_mode: 'HTML',
        reply_markup: inlineKeyboard
      })
    });

    if (response.ok) {
      console.log('[Telegram] Text notification dispatched successfully.');
    } else {
      const errText = await response.text();
      console.error(`[Telegram] Failed to send text notification: ${errText}`);
    }
  } catch (err) {
    console.error('[Telegram] Error sending notification:', err);
  }
}

// ==========================================
// TELEGRAM BIDIRECTIONAL CONTROL (Polling & Commands)
// ==========================================
let telegramPollIntervalId = null;
let telegramOffset = -1;
let isPollingTelegram = false;

async function checkTelegramUpdates() {
  if (isPollingTelegram) return;
  
  const db = await readDb();
  const token = db.settings.telegramToken;
  const chatId = db.settings.telegramChatId;
  const enabled = db.settings.telegramEnabled;

  if (!enabled || !token || !chatId) {
    stopTelegramPolling();
    return;
  }

  isPollingTelegram = true;

  try {
    const url = `https://api.telegram.org/bot${token}/getUpdates?offset=${telegramOffset}&timeout=30`;
    const response = await fetch(url, {
      method: 'GET',
      headers: { 'Accept': 'application/json' }
    });

    if (!response.ok) {
      throw new Error(`getUpdates returned status ${response.status}`);
    }

    const data = await response.json();
    if (data.ok && Array.isArray(data.result)) {
      for (const update of data.result) {
        telegramOffset = update.update_id + 1;
        if (update.message && update.message.text) {
          await handleTelegramMessage(update.message);
        }
      }
    }
  } catch (err) {
    console.error('[Telegram Polling] Error:', err.message);
  } finally {
    isPollingTelegram = false;
  }
}

async function handleTelegramMessage(message) {
  const db = await readDb();
  const configuredChatId = String(db.settings.telegramChatId).trim();
  const senderChatId = String(message.chat.id).trim();
  const token = db.settings.telegramToken;

  if (senderChatId !== configuredChatId) {
    console.warn(`[Telegram Security] Blocked unauthorized command from Chat ID: ${senderChatId}. Configured: ${configuredChatId}`);
    try {
      await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          chat_id: message.chat.id,
          text: '❌ <b>Accesso Negato</b>\nQuesto bot è privato e risponde solo al Chat ID autorizzato nelle impostazioni di NOCameraNews.',
          parse_mode: 'HTML'
        })
      });
    } catch (e) {
      console.error('[Telegram Security] Failed to send block alert:', e.message);
    }
    return;
  }

  const text = message.text.trim();
  const parts = text.split(/\s+/);
  const command = parts[0].toLowerCase();
  const argument = parts.slice(1).join(' ').trim().toUpperCase();

  let responseText = '';

  if (command === '/start' || command === '/help') {
    responseText = `🤖 <b>NOCameraNews Bot Benvenuto!</b>\n\n` +
      `Puoi controllare il monitor direttamente da qui usando questi comandi:\n` +
      `📊 /status - Stato del monitor e statistiche scansioni\n` +
      `🔑 /keywords - Elenco delle parole chiave tracciate\n` +
      `➕ /add <code>[parola]</code> - Aggiungi una parola chiave (es: <code>/add LEICA M</code>)\n` +
      `➖ /remove <code>[parola]</code> - Rimuovi una parola chiave (es: <code>/remove LEICA M</code>)\n` +
      `❓ /help - Mostra questo messaggio di aiuto`;
  } else if (command === '/status') {
    let nextCheckInSeconds = 0;
    if (checkTimeoutId && db.settings.enabled) {
      const intervalMs = (db.settings.intervalMinutes || 5) * 60 * 1000;
      if (lastCheckedTime) {
        const nextTime = new Date(new Date(lastCheckedTime).getTime() + intervalMs);
        nextCheckInSeconds = Math.max(0, Math.round((nextTime.getTime() - Date.now()) / 1000));
      }
    }

    const mins = Math.floor(nextCheckInSeconds / 60);
    const secs = nextCheckInSeconds % 60;
    const nextCheckStr = db.settings.enabled 
      ? `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`
      : 'Disattivato';

    const lastCheckedStr = lastCheckedTime 
      ? new Date(lastCheckedTime).toLocaleTimeString('it-IT')
      : 'Mai';

    const statusIcon = db.settings.enabled ? '🟢 Attivo' : '🔴 Disattivato';

    responseText = `📊 <b>Stato Monitor NOCameraNews</b>\n\n` +
      `• <b>Stato:</b> ${statusIcon}\n` +
      `• <b>Frequenza scansione:</b> ogni ${db.settings.intervalMinutes} min\n` +
      `• <b>Ultimo controllo:</b> ${lastCheckedStr}\n` +
      `• <b>Prossimo controllo tra:</b> ${nextCheckStr}\n` +
      `• <b>Parole chiave tracciate:</b> ${db.keywords.length}\n` +
      `• <b>Articoli rilevati (Cronologia):</b> ${db.history.length}`;
  } else if (command === '/keywords' || command === '/chiavi') {
    if (db.keywords.length === 0) {
      responseText = `🔑 <b>Nessuna parola chiave impostata.</b>\nUsa il comando /add per tracciare il primo termine!`;
    } else {
      responseText = `🔑 <b>Parole Chiave Tracciate (${db.keywords.length}):</b>\n\n` +
        db.keywords.map((kw, i) => `${i + 1}. <code>${kw}</code>`).join('\n');
    }
  } else if (command === '/add') {
    if (!argument) {
      responseText = `⚠️ Specificare la parola chiave da aggiungere.\nEs: <code>/add LEICA</code>`;
    } else {
      const result = await withDbLock(async () => {
        const fresh = await readDb();
        if (fresh.keywords.includes(argument)) {
          return { duplicate: true, count: fresh.keywords.length };
        }
        fresh.keywords.push(argument);
        await writeDb(fresh);
        return { duplicate: false, count: fresh.keywords.length };
      });

      if (result.duplicate) {
        responseText = `ℹ️ La parola chiave <code>${argument}</code> è già tracciata.`;
      } else {
        responseText = `✅ Parola chiave <code>${argument}</code> aggiunta con successo!\nOra tracciamo ${result.count} termini.`;
        console.log(`[Telegram Cmd] Added keyword: ${argument}`);
      }
    }
  } else if (command === '/remove' || command === '/delete') {
    if (!argument) {
      responseText = `⚠️ Specificare la parola chiave da rimuovere.\nEs: <code>/remove LEICA</code>`;
    } else {
      const result = await withDbLock(async () => {
        const fresh = await readDb();
        if (!fresh.keywords.includes(argument)) {
          return { missing: true, count: fresh.keywords.length };
        }
        fresh.keywords = fresh.keywords.filter(kw => kw !== argument);
        await writeDb(fresh);
        return { missing: false, count: fresh.keywords.length };
      });

      if (result.missing) {
        responseText = `ℹ️ La parola chiave <code>${argument}</code> non è presente nell'elenco.`;
      } else {
        responseText = `✅ Parola chiave <code>${argument}</code> rimossa con successo.\nOra tracciamo ${result.count} termini.`;
        console.log(`[Telegram Cmd] Removed keyword: ${argument}`);
      }
    }
  } else {
    responseText = `❓ Comando non riconosciuto.\nUsa /help per vedere l'elenco dei comandi disponibili.`;
  }

  try {
    await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: message.chat.id,
        text: responseText,
        parse_mode: 'HTML'
      })
    });
  } catch (err) {
    console.error('[Telegram Cmd] Error sending response back:', err.message);
  }
}

async function startTelegramPolling() {
  if (telegramPollIntervalId) {
    clearInterval(telegramPollIntervalId);
  }

  const db = await readDb();
  const enabled = db.settings.telegramEnabled;
  const token = db.settings.telegramToken;
  const chatId = db.settings.telegramChatId;

  if (!enabled || !token || !chatId) {
    console.log('[Telegram Polling] Polling will remain inactive: disabled or missing config.');
    return;
  }

  console.log('[Telegram Polling] Polling started and listening for remote commands...');
  telegramOffset = -1;
  await checkTelegramUpdates();
  telegramPollIntervalId = setInterval(checkTelegramUpdates, 4000);
}

function stopTelegramPolling() {
  if (telegramPollIntervalId) {
    clearInterval(telegramPollIntervalId);
    telegramPollIntervalId = null;
    console.log('[Telegram Polling] Polling stopped.');
  }
}

async function readSeenIds() {
  try {
    const today = new Date().toDateString();
    const res = await pool.query("SELECT value FROM app_preferences WHERE key = 'seen_ids'");
    if (res.rowCount > 0) {
      const parsed = res.rows[0].value;
      if (parsed.lastClearedDate !== today) {
        console.log(`[Database] Day changed from "${parsed.lastClearedDate}" to "${today}". Resetting seenIds daily list.`);
        parsed.lastClearedDate = today;
        parsed.ids = [];
        await writeSeenIds(parsed);
      }
      return parsed;
    }
  } catch (err) {
    console.error('Error reading seen_ids from PostgreSQL:', err);
  }
  return { lastClearedDate: new Date().toDateString(), ids: [] };
}

async function writeSeenIds(data) {
  try {
    await pool.query("INSERT INTO app_preferences (key, value) VALUES ($1, $2) ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value", ['seen_ids', data]);
    return true;
  } catch (err) {
    console.error('Error writing seen_ids to PostgreSQL:', err);
    return false;
  }
}

async function writeDb(data) {
  try {
    await pool.query("INSERT INTO app_preferences (key, value) VALUES ($1, $2) ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value", ['db', data]);
    return true;
  } catch (err) {
    console.error('Error writing database to PostgreSQL:', err);
    return false;
  }
}

async function readAllDaily() {
  try {
    const res = await pool.query("SELECT data FROM all_daily_products ORDER BY timestamp_scraped DESC");
    return res.rows.map(r => r.data);
  } catch (err) {
    console.error('Error reading all_daily from PostgreSQL:', err);
    return [];
  }
}

async function writeAllDaily(data) {
  try {
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      await client.query("DELETE FROM all_daily_products");
      for (const item of data) {
        await client.query(
          "INSERT INTO all_daily_products (id, data, timestamp_scraped) VALUES ($1, $2, $3) ON CONFLICT (id) DO UPDATE SET data = EXCLUDED.data", 
          [item.id, item, item.timestampScraped || new Date().toISOString()]
        );
      }
      await client.query("COMMIT");
      return true;
    } catch (err) {
      await client.query("ROLLBACK");
      throw err;
    } finally {
      client.release();
    }
  } catch (err) {
    console.error('Error writing all_daily to PostgreSQL:', err);
    return false;
  }
}

// ==========================================
// MACOS NOTIFICATION SYSTEMS (Dual Mode)
// ==========================================
function sendDesktopNotification(title, message, codice = null, soundEnabled = true) {
  const sound = soundEnabled ? 'Glass' : false;
  const productUrl = codice ? `https://www.newoldcamera.com/Scheda.aspx?Codice=${codice}` : null;

  console.log(`[Notification] Dispatching alert: "${title}" - "${message}"`);

  notifier.notify(
    {
      title: title,
      message: message,
      sound: sound,
      wait: true,
      timeout: 10,
      open: productUrl
    },
    function (err) {
      if (err) {
        console.error('[Notification] node-notifier failed:', err.message);
      }
    }
  );
}

// ==========================================
// CRAWLER & SCRAPER LOGIC
// ==========================================
function fetchProductList() {
  return new Promise((resolve, reject) => {
    const url = 'https://noc-gateway-api.icyriver-4199ba13.northeurope.azurecontainerapps.io/api/v1/products/published/daily';

    const req = https.get(url, {
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
    });

    req.setTimeout(PRODUCT_API_TIMEOUT_MS, () => {
      req.destroy(new Error(`Request timed out after ${PRODUCT_API_TIMEOUT_MS}ms`));
    });

    req.on('error', (err) => {
      reject(err);
    });
  });
}

async function processProducts(products, settings) {
  const db = await readDb();
  const seenData = await readSeenIds();
  const isFirstBoot = seenData.ids.length === 0;
  let seenModified = false;
  let dbModified = false;

  const allDailyData = await readAllDaily();
  let allDailyModified = false;

  // Loop through retrieved items
  for (const item of products) {
    const itemId = item.id;

    // Save all products to database if not already present
    const existsInAllDaily = allDailyData.some(p => p.id === itemId);
    if (!existsInAllDaily) {
      allDailyData.unshift({
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
        timestampScraped: new Date().toISOString()
      });
      allDailyModified = true;
    }

    const isNewItem = !seenData.ids.includes(itemId);

    if (isNewItem) {
      seenData.ids.push(itemId);
      seenModified = true;
    }

    // Check if product is already in history to prevent duplicates
    const existsInHistory = db.history.some(h => h.id === itemId);

    if (!existsInHistory) {
      // Check matching keywords
      const brand = (item.marca || '').toUpperCase();
      const model = (item.modello || '').toUpperCase();
      const textToSearch = `${brand} ${model}`;

      const matchedKeyword = db.keywords.find(kw => {
        const kwText = typeof kw === 'object' && kw !== null ? kw.text : kw;
        if (!kwText) return false;
        return textToSearch.includes(kwText.toUpperCase().trim());
      });

      if (matchedKeyword) {
        let isMatch = true;
        let keywordText = matchedKeyword;

        if (typeof matchedKeyword === 'object' && matchedKeyword !== null) {
          keywordText = matchedKeyword.text;

          // Calculate effective active price
          const activePrice = item.prezzoPromozione > 0 && item.prezzoPromozione < item.prezzoVendita
            ? item.prezzoPromozione
            : item.prezzoVendita;

          // Check min price limit
          if (matchedKeyword.minPrice !== undefined && matchedKeyword.minPrice !== null && matchedKeyword.minPrice !== '') {
            if (activePrice < Number(matchedKeyword.minPrice)) {
              isMatch = false;
              console.log(`[Scraper] Skip: Product "${brand} ${model}" price (€${activePrice}) is below min limit (€${matchedKeyword.minPrice}) for keyword "${keywordText}"`);
            }
          }
          // Check max price limit
          if (isMatch && matchedKeyword.maxPrice !== undefined && matchedKeyword.maxPrice !== null && matchedKeyword.maxPrice !== '') {
            if (activePrice > Number(matchedKeyword.maxPrice)) {
              isMatch = false;
              console.log(`[Scraper] Skip: Product "${brand} ${model}" price (€${activePrice}) is above max limit (€${matchedKeyword.maxPrice}) for keyword "${keywordText}"`);
            }
          }
          // Check exclusions
          if (isMatch && Array.isArray(matchedKeyword.exclude) && matchedKeyword.exclude.length > 0) {
            const hasExcludedWord = matchedKeyword.exclude.some(word => {
              const cleanWord = word.trim().toUpperCase();
              if (!cleanWord) return false;
              return textToSearch.includes(cleanWord);
            });
            if (hasExcludedWord) {
              isMatch = false;
              console.log(`[Scraper] Skip: Product "${brand} ${model}" matches excluded terms [${matchedKeyword.exclude.join(', ')}] for keyword "${keywordText}"`);
            }
          }
        }

        if (isMatch) {
          console.log(`[Scraper] Match found! "${brand} ${model}" matches keyword "${keywordText}"`);

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
            matchedKeyword: keywordText, // Store string to keep UI and history consistent
            timestampScraped: new Date().toISOString(),
            notified: !isFirstBoot && isNewItem
          };

          db.history.unshift(historyItem); // Insert at beginning of history array
          dbModified = true;

          // Trigger Notification ONLY for truly new items after first boot
          if (!isFirstBoot && isNewItem) {
            const priceStr = item.prezzoPromozione > 0 && item.prezzoPromozione < item.prezzoVendita
              ? `€${item.prezzoPromozione} (PROMO! scontrato da €${item.prezzoVendita})`
              : `€${item.prezzoVendita}`;

            const title = `Nuovo Prodotto: ${item.marca}`;
            const message = `${item.modello}\nPrezzo: ${priceStr} | Condizione: ${item.stato || 'N/D'}`;

            // Trigger Desktop macOS notification if enabled
            if (settings.desktopEnabled !== false) {
              sendDesktopNotification(title, message, item.codice, settings.soundEnabled !== false);
            }

            // Trigger Telegram Bot notification if enabled
            if (settings.telegramEnabled) {
              // Build Image URL if available
              let imageSrc = null;
              if (item.virtualPath && item.virtualPath.trim() !== '') {
                const path = item.virtualPath.trim();
                if (path.startsWith('http')) {
                  imageSrc = path;
                } else if (path.startsWith('/')) {
                  imageSrc = `https://www.newoldcamera.com${path}`;
                } else {
                  imageSrc = `https://www.newoldcamera.com/${path}`;
                }
              }
              sendTelegramNotification(title, message, item.codice, imageSrc);
            }
          }
        }
      }
    }
  }

  if (isFirstBoot) {
    console.log(`[Scraper] Initial boot complete. Saved ${seenData.ids.length} existing items to skip alerts.`);
  }

  if (seenModified) {
    await writeSeenIds(seenData);
  }

  if (dbModified) {
    await writeDb(db);
  }

  if (allDailyModified) {
    await writeAllDaily(allDailyData);
  }
}

async function checkNewProducts() {
  if (isCheckingNow) return;
  
  const now = new Date();
  const currentHour = now.getHours();
  const todayDateString = now.toDateString();
  let db = await readDb();

  let settings = db.settings;

  // Auto-clear logic after 20:00 or when a new day starts
  const isNewDay = db.lastDailyClearDate !== todayDateString;
  const isAfterEightPM = currentHour >= 20;
  const alreadyClearedTodayAfterEight = db.lastDailyClearDate === todayDateString && db.lastDailyClearHour >= 20;

  if (isNewDay || (isAfterEightPM && !alreadyClearedTodayAfterEight)) {
    await withDbLock(async () => {
      db = await readDb();
      console.log(`[Auto-Clear] Resetting daily databases (New Day: ${isNewDay}, After 20:00: ${isAfterEightPM})`);

      db.history = [];
      db.lastDailyClearDate = todayDateString;
      db.lastDailyClearHour = currentHour;
      await writeDb(db);

      await writeAllDaily([]);

      const seenData = await readSeenIds();
      seenData.ids = [];
      seenData.lastClearedDate = todayDateString;
      await writeSeenIds(seenData);
    });
    settings = db.settings;
  }

  // Verify Schedule and Activation settings
  if (!settings.enabled) {
    console.log('[Scheduler] Scraper is disabled in settings.');
    return;
  }

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

    await withDbLock(() => processProducts(products, settings));

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
async function startPolling() {
  if (checkTimeoutId) {
    clearInterval(checkTimeoutId);
  }

  const db = await readDb();
  const intervalMs = (db.settings.intervalMinutes || 5) * 60 * 1000;

  console.log(`[Scheduler] Polling scheduled to run every ${db.settings.intervalMinutes} minutes.`);
  
  // Run immediate first check (backgrounded)
  checkNewProducts();

  // Schedule intervals
  checkTimeoutId = setInterval(checkNewProducts, intervalMs);
}

// Initialize database, seed data & Start scheduling on server load
(async () => {
  try {
    await initDb();
    await startPolling();
    await startTelegramPolling();
  } catch (err) {
    console.error('[Startup] Failed to start server components:', err);
  }
})();

function requireAdminPassword(req, res, next) {
  const password = process.env.ADMIN_PASSWORD;
  if (!password) {
    return next(); // Bypassed if no password is configured
  }

  const clientPassword = req.headers['x-admin-password'];
  if (clientPassword === password) {
    return next();
  }

  res.status(401).json({ error: 'Password amministratore non valida o mancante.' });
}

// ==========================================
// EXPRESS REST API ENDPOINTS
// ==========================================

// Get operational status
app.get('/api/status', async (req, res) => {
  const db = await readDb();
  
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

  const seenData = await readSeenIds();

  res.json({
    enabled: db.settings.enabled,
    lastChecked: lastCheckedTime,
    lastError: lastCheckError,
    nextCheckInSeconds: nextCheckInSeconds,
    scrapedCount: seenData.ids.length,
    matchCount: db.history.length,
    keywordsCount: db.keywords.length,
    intervalMinutes: db.settings.intervalMinutes,
    passwordRequired: !!process.env.ADMIN_PASSWORD,
    telegramEnabled: db.settings.telegramEnabled
  });
});

// Keywords CRUD
app.get('/api/keywords', requireAdminPassword, async (req, res) => {
  const db = await readDb();
  res.json({ keywords: db.keywords });
});

app.post('/api/keywords', requireAdminPassword, async (req, res) => {
  const { keywords } = req.body;
  if (!Array.isArray(keywords)) {
    return res.status(400).json({ error: 'Keywords must be an array.' });
  }

  const normalizedKeywords = keywords.map(kw => {
    if (typeof kw === 'object' && kw !== null) {
      return {
        text: String(kw.text || '').trim().toUpperCase(),
        minPrice: kw.minPrice !== undefined && kw.minPrice !== null && kw.minPrice !== '' ? Number(kw.minPrice) : null,
        maxPrice: kw.maxPrice !== undefined && kw.maxPrice !== null && kw.maxPrice !== '' ? Number(kw.maxPrice) : null,
        exclude: Array.isArray(kw.exclude) 
          ? kw.exclude.map(word => String(word).trim().toUpperCase()).filter(word => word.length > 0)
          : []
      };
    }
    return String(kw).trim().toUpperCase();
  }).filter(kw => {
    const text = typeof kw === 'object' ? kw.text : kw;
    return text && text.length > 0;
  });

  const updatedKeywords = await withDbLock(async () => {
    const db = await readDb();
    db.keywords = normalizedKeywords;
    await writeDb(db);
    return db.keywords;
  });

  console.log('[API] Tracked keywords updated:', updatedKeywords);
  res.json({ success: true, keywords: updatedKeywords });
});

// History CRUD
app.get('/api/history', async (req, res) => {
  const db = await readDb();
  res.json({ history: db.history });
});

// All daily products list
app.get('/api/all-daily', async (req, res) => {
  const allDaily = await readAllDaily();
  res.json({ products: allDaily });
});

app.delete('/api/history', requireAdminPassword, async (req, res) => {
  await withDbLock(async () => {
    const db = await readDb();
    db.history = [];
    await writeDb(db);
  });
  res.json({ success: true, message: 'Match history cleared.' });
});

// Reset matching history and seen IDs cache
app.post('/api/reset-all', requireAdminPassword, async (req, res) => {
  try {
    console.log('[API] Reset cache and history requested.');

    await withDbLock(async () => {
      // Clear seen IDs
      const seenData = {
        lastClearedDate: new Date().toDateString(),
        ids: []
      };
      await writeSeenIds(seenData);

      // Clear history
      const db = await readDb();
      db.history = [];
      await writeDb(db);

      // Clear all_daily database
      await writeAllDaily([]);
    });

    res.json({ success: true, message: 'Cronologia, cache e database dei prodotti di tutti i giorni resettati con successo.' });
  } catch (err) {
    console.error('Error resetting database and cache:', err);
    res.status(500).json({ error: 'Errore interno durante il reset.' });
  }
});

// Settings REST
app.get('/api/settings', requireAdminPassword, async (req, res) => {
  const db = await readDb();
  res.json({ settings: db.settings });
});

app.post('/api/settings', requireAdminPassword, async (req, res) => {
  const { settings } = req.body;
  if (!settings || typeof settings !== 'object') {
    return res.status(400).json({ error: 'Settings object is required.' });
  }

  const intervalMinutes = Number(settings.intervalMinutes);
  const activeHoursStart = Number(settings.activeHoursStart);
  const activeHoursEnd = Number(settings.activeHoursEnd);
  const activeDays = Array.isArray(settings.activeDays) ? settings.activeDays.map(Number) : [];

  const errors = [];
  if (!Number.isInteger(intervalMinutes) || intervalMinutes < 1 || intervalMinutes > 1440) {
    errors.push('"intervalMinutes" deve essere un intero tra 1 e 1440.');
  }
  if (!Number.isInteger(activeHoursStart) || activeHoursStart < 0 || activeHoursStart > 23 ||
      !Number.isInteger(activeHoursEnd) || activeHoursEnd < 0 || activeHoursEnd > 23 ||
      activeHoursStart >= activeHoursEnd) {
    errors.push('"activeHoursStart" e "activeHoursEnd" devono essere interi tra 0 e 23 con inizio minore di fine.');
  }
  if (activeDays.length === 0 || !activeDays.every(d => Number.isInteger(d) && d >= 0 && d <= 6)) {
    errors.push('"activeDays" deve essere un array non vuoto di interi tra 0 e 6 (0 = domenica).');
  }
  if (errors.length > 0) {
    return res.status(400).json({ error: errors.join(' ') });
  }

  let savedSettings = null;
  await withDbLock(async () => {
    const db = await readDb();
    const oldInterval = db.settings.intervalMinutes;
    const oldTelegramEnabled = db.settings.telegramEnabled;
    const oldTelegramToken = db.settings.telegramToken;
    const oldTelegramChatId = db.settings.telegramChatId;

    db.settings = {
      intervalMinutes,
      activeHoursStart,
      activeHoursEnd,
      activeDays,
      enabled: typeof settings.enabled === 'boolean' ? settings.enabled : true,
      soundEnabled: typeof settings.soundEnabled === 'boolean' ? settings.soundEnabled : true,
      desktopEnabled: typeof settings.desktopEnabled === 'boolean' ? settings.desktopEnabled : true,
      telegramEnabled: typeof settings.telegramEnabled === 'boolean' ? settings.telegramEnabled : false,
      telegramToken: typeof settings.telegramToken === 'string' ? settings.telegramToken.trim() : '',
      telegramChatId: typeof settings.telegramChatId === 'string' ? settings.telegramChatId.trim() : ''
    };

    await writeDb(db);
    savedSettings = db.settings;

    // Restart scheduler if interval changed or enabled toggled
    if (oldInterval !== db.settings.intervalMinutes || settings.enabled !== undefined) {
      await startPolling();
    }

    // Restart Telegram Polling if Telegram settings changed
    if (oldTelegramEnabled !== db.settings.telegramEnabled ||
        oldTelegramToken !== db.settings.telegramToken ||
        oldTelegramChatId !== db.settings.telegramChatId) {
      if (db.settings.telegramEnabled) {
        await startTelegramPolling();
      } else {
        stopTelegramPolling();
      }
    }
  });

  res.json({ success: true, settings: savedSettings });
});

// Trigger a direct scraper execution manually
app.post('/api/trigger-check', requireAdminPassword, async (req, res) => {
  console.log('[API] Manual scraper trigger requested.');
  await checkNewProducts();
  res.json({ success: true, lastChecked: lastCheckedTime, lastError: lastCheckError });
});

// Trigger a local test notification
app.post('/api/test-notification', requireAdminPassword, async (req, res) => {
  console.log('[API] Test notification requested.');
  const db = await readDb();
  sendDesktopNotification(
    'NOC Monitor: Test Alert 📸',
    'La configurazione delle notifiche macOS è attiva e funzionante al 100%!',
    '26C0933', // Test with a real code to verify product links
    db.settings.soundEnabled !== false
  );
  res.json({ success: true, message: 'Test notification triggered successfully.' });
});

// Trigger a local test telegram notification (allows dry-run parameters)
app.post('/api/test-telegram', requireAdminPassword, async (req, res) => {
  const { telegramToken, telegramChatId } = req.body;
  const db = await readDb();
  
  const token = telegramToken !== undefined ? telegramToken.trim() : db.settings.telegramToken;
  const chatId = telegramChatId !== undefined ? telegramChatId.trim() : db.settings.telegramChatId;

  console.log('[API] Test Telegram notification requested.');

  if (!token || !chatId) {
    return res.status(400).json({ error: 'Token Bot e Chat ID Telegram sono richiesti per il test.' });
  }

  const title = 'NOC Monitor: Test Telegram 📸🤖';
  const message = 'Congratulazioni! La connessione e le notifiche del bot Telegram funzionano correttamente. Sei pronto a ricevere i prossimi match in tempo reale!';
  const testCodice = '26C0933';
  const testPhoto = 'https://www.newoldcamera.com/images/Prodotti/small_26C0933_1.jpg'; // Real photo placeholder

  const captionHtml = `<b>${escapeHtmlForTelegram(title)}</b>\n\n${escapeHtmlForTelegram(message)}`;
  const inlineKeyboard = {
    inline_keyboard: [
      [
        {
          text: 'Vedi Prodotto 📸',
          url: `https://www.newoldcamera.com/Scheda.aspx?Codice=${testCodice}`
        }
      ]
    ]
  };

  try {
    // Send as photo
    const photoResponse = await fetch(`https://api.telegram.org/bot${token}/sendPhoto`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: chatId,
        photo: testPhoto,
        caption: captionHtml,
        parse_mode: 'HTML',
        reply_markup: inlineKeyboard
      })
    });

    if (photoResponse.ok) {
      return res.json({ success: true, message: 'Notifica di prova Telegram inviata con successo (Foto).' });
    } else {
      const photoErr = await photoResponse.text();
      console.warn(`[Test Telegram] Failed to send photo, trying text fallback: ${photoErr}`);
    }

    // Fallback to text message
    const response = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: chatId,
        text: captionHtml,
        parse_mode: 'HTML',
        reply_markup: inlineKeyboard
      })
    });

    if (response.ok) {
      res.json({ success: true, message: 'Notifica di prova Telegram inviata con successo (Testo).' });
    } else {
      const errText = await response.text();
      res.status(500).json({ error: `Telegram API error: ${errText}` });
    }
  } catch (err) {
    console.error('[API Test Telegram] Error:', err);
    res.status(500).json({ error: `Errore di connessione: ${err.message}` });
  }
});

// Start Express Listener
app.listen(PORT, () => {
  console.log(`===========================================================`);
  console.log(`New Old Camera Monitor backend active on: http://localhost:${PORT}`);
  console.log(`Dashboard interface is ready and listening...`);
  console.log(`===========================================================`);
});
