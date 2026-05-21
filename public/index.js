// API Base Endpoint (assumes relative hosting, fallback to localhost:3000)
const API_BASE = '';

// Application State
let state = {
  keywords: [],
  history: [],
  settings: {},
  countdownSeconds: 0,
  countdownIntervalId: null,
  statusPollIntervalId: null
};

// DOM Elements
const el = {
  statusDot: document.getElementById('statusDot'),
  statusText: document.getElementById('statusText'),
  lastChecked: document.getElementById('lastChecked'),
  nextCheckTimer: document.getElementById('nextCheckTimer'),
  timerContainer: document.getElementById('timerContainer'),
  btnTriggerCheck: document.getElementById('btnTriggerCheck'),
  btnTestNotify: document.getElementById('btnTestNotify'),
  
  keywordInput: document.getElementById('keywordInput'),
  btnAddKeyword: document.getElementById('btnAddKeyword'),
  tagsContainer: document.getElementById('tagsContainer'),
  keywordsCount: document.getElementById('keywordsCount'),
  
  settingsForm: document.getElementById('settingsForm'),
  intervalInput: document.getElementById('intervalInput'),
  soundToggle: document.getElementById('soundToggle'),
  enabledToggle: document.getElementById('enabledToggle'),
  hoursStartInput: document.getElementById('hoursStartInput'),
  hoursEndInput: document.getElementById('hoursEndInput'),
  
  historyCount: document.getElementById('historyCount'),
  btnClearHistory: document.getElementById('btnClearHistory'),
  historyGrid: document.getElementById('historyGrid')
};

// ==========================================
// INITIALIZATION
// ==========================================
document.addEventListener('DOMContentLoaded', async () => {
  setupEventListeners();
  
  // Show skeleton cards during initial load
  showSkeletons();
  
  // Initial data fetch
  await fetchSettings();
  await fetchKeywords();
  await fetchHistory();
  await updateStatus();
  
  // Start active timers
  startStatusPolling();
  startCountdownTimer();
});

function setupEventListeners() {
  // Add Keyword
  el.btnAddKeyword.addEventListener('click', handleAddKeyword);
  el.keywordInput.addEventListener('keypress', (e) => {
    if (e.key === 'Enter') handleAddKeyword();
  });
  
  // Save Settings
  el.settingsForm.addEventListener('submit', handleSaveSettings);
  
  // Manual Trigger Check
  el.btnTriggerCheck.addEventListener('click', triggerManualCheck);
  
  // Test Notification
  el.btnTestNotify.addEventListener('click', triggerTestNotification);
  
  // Clear History
  el.btnClearHistory.addEventListener('click', clearHistory);
}

// ==========================================
// AUTHENTICATION INTERCEPTOR LAYER
// ==========================================
function promptAdminPassword() {
  const modal = document.getElementById('authModal');
  const input = document.getElementById('authPasswordInput');
  const btnConfirm = document.getElementById('btnAuthConfirm');
  const btnCancel = document.getElementById('btnAuthCancel');

  modal.style.display = 'flex';
  input.value = '';
  input.focus();

  return new Promise((resolve, reject) => {
    function cleanup() {
      modal.style.display = 'none';
      btnConfirm.removeEventListener('click', onConfirm);
      btnCancel.removeEventListener('click', onCancel);
      input.removeEventListener('keydown', onKeyDown);
    }

    function onConfirm() {
      const password = input.value;
      cleanup();
      resolve(password);
    }

    function onCancel() {
      cleanup();
      reject(new Error('Annullato dall\'utente'));
    }

    function onKeyDown(e) {
      if (e.key === 'Enter') {
        onConfirm();
      } else if (e.key === 'Escape') {
        onCancel();
      }
    }

    btnConfirm.addEventListener('click', onConfirm);
    btnCancel.addEventListener('click', onCancel);
    input.addEventListener('keydown', onKeyDown);
  });
}

async function fetchWithAuth(url, options = {}) {
  options.headers = options.headers || {};
  
  if (options.body && !options.headers['Content-Type']) {
    options.headers['Content-Type'] = 'application/json';
  }

  let cachedPassword = localStorage.getItem('admin_password');
  if (cachedPassword) {
    options.headers['x-admin-password'] = cachedPassword;
  }

  let res = await fetch(url, options);

  if (res.status === 401) {
    localStorage.removeItem('admin_password');
    delete options.headers['x-admin-password'];

    try {
      const newPassword = await promptAdminPassword();
      localStorage.setItem('admin_password', newPassword);
      options.headers['x-admin-password'] = newPassword;
      
      res = await fetch(url, options);
      
      if (res.status === 401) {
        localStorage.removeItem('admin_password');
        showToast('Password errata o non valida.', 'danger');
      }
    } catch (err) {
      console.log('Authentication prompt cancelled or failed:', err);
      // Return a mock response object to let the calling code fail gracefully without throwing unhandled exceptions
      return { ok: false, status: 401, json: async () => ({ error: 'Autenticazione richiesta.' }) };
    }
  }

  return res;
}

// ==========================================
// API CLIENT OPERATIONS
// ==========================================

// Get Keywords
async function fetchKeywords() {
  try {
    const res = await fetch(`${API_BASE}/api/keywords`);
    const data = await res.json();
    state.keywords = data.keywords || [];
    renderKeywords();
  } catch (err) {
    console.error('Error fetching keywords:', err);
  }
}

// Get History
async function fetchHistory() {
  try {
    const res = await fetch(`${API_BASE}/api/history`);
    const data = await res.json();
    state.history = data.history || [];
    renderHistory();
  } catch (err) {
    console.error('Error fetching history:', err);
  }
}

// Get Settings
async function fetchSettings() {
  try {
    const res = await fetch(`${API_BASE}/api/settings`);
    const data = await res.json();
    state.settings = data.settings || {};
    populateSettingsForm();
  } catch (err) {
    console.error('Error fetching settings:', err);
  }
}

// Save Settings
async function handleSaveSettings(e) {
  e.preventDefault();
  
  const checkedDays = [];
  document.querySelectorAll('input[name="activeDays"]:checked').forEach(cb => {
    checkedDays.push(parseInt(cb.value));
  });

  const updated = {
    settings: {
      intervalMinutes: parseInt(el.intervalInput.value) || 5,
      soundEnabled: el.soundToggle.checked,
      enabled: el.enabledToggle.checked,
      activeHoursStart: parseInt(el.hoursStartInput.value) !== NaN ? parseInt(el.hoursStartInput.value) : 8,
      activeHoursEnd: parseInt(el.hoursEndInput.value) !== NaN ? parseInt(el.hoursEndInput.value) : 20,
      activeDays: checkedDays
    }
  };

  try {
    const res = await fetchWithAuth(`${API_BASE}/api/settings`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(updated)
    });
    
    if (res.ok) {
      const data = await res.json();
      state.settings = data.settings;
      showToast('Impostazioni salvate con successo!', 'success');
      
      // Update countdown immediately
      await updateStatus();
    }
  } catch (err) {
    console.error('Error saving settings:', err);
    showToast('Impossibile salvare le impostazioni.', 'danger');
  }
}

// Add Keyword Action
async function handleAddKeyword() {
  const value = el.keywordInput.value.trim().toUpperCase();
  if (!value) return;
  
  if (state.keywords.includes(value)) {
    showToast('Questa parola chiave è già tracciata!', 'info');
    el.keywordInput.value = '';
    return;
  }

  state.keywords.push(value);
  el.keywordInput.value = '';

  try {
    const res = await fetchWithAuth(`${API_BASE}/api/keywords`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ keywords: state.keywords })
    });
    
    if (res.ok) {
      const data = await res.json();
      state.keywords = data.keywords;
      renderKeywords();
      showToast(`Parola chiave "${value}" aggiunta!`, 'success');
    }
  } catch (err) {
    console.error('Error saving keywords:', err);
    showToast('Errore nel salvare la parola chiave.', 'danger');
  }
}

// Remove Keyword Action
async function deleteKeyword(kw) {
  state.keywords = state.keywords.filter(item => item !== kw);
  
  try {
    const res = await fetchWithAuth(`${API_BASE}/api/keywords`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ keywords: state.keywords })
    });
    
    if (res.ok) {
      const data = await res.json();
      state.keywords = data.keywords;
      renderKeywords();
      showToast(`Parola chiave rimossa.`, 'info');
    }
  } catch (err) {
    console.error('Error deleting keyword:', err);
  }
}

// Manual Check Trigger
async function triggerManualCheck() {
  el.btnTriggerCheck.disabled = true;
  const originalHtml = el.btnTriggerCheck.innerHTML;
  el.btnTriggerCheck.innerHTML = `
    <svg class="spinning" xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21.5 2v6h-6M21.34 15.57a10 10 0 1 1-.57-8.38l5.67-5.67"/></svg>
    Verifica...
  `;

  try {
    const res = await fetchWithAuth(`${API_BASE}/api/trigger-check`, { method: 'POST' });
    if (res.ok) {
      await fetchHistory();
      await updateStatus();
      showToast('Controllo completato!', 'success');
    }
  } catch (err) {
    console.error('Error triggering check:', err);
    showToast('Errore durante la scansione manuale.', 'danger');
  } finally {
    el.btnTriggerCheck.disabled = false;
    el.btnTriggerCheck.innerHTML = originalHtml;
  }
}

// Test Notification Trigger
async function triggerTestNotification() {
  try {
    const res = await fetchWithAuth(`${API_BASE}/api/test-notification`, { method: 'POST' });
    if (res.ok) {
      showToast('Notifica di prova inviata!', 'success');
    }
  } catch (err) {
    console.error('Error triggering test alert:', err);
    showToast('Errore nell\'inviare la notifica.', 'danger');
  }
}

// Clear History
async function clearHistory() {
  if (!confirm('Sei sicuro di voler svuotare tutta la cronologia degli articoli rilevati?')) return;

  try {
    const res = await fetchWithAuth(`${API_BASE}/api/history`, { method: 'DELETE' });
    if (res.ok) {
      state.history = [];
      renderHistory();
      showToast('Cronologia svuotata.', 'info');
    }
  } catch (err) {
    console.error('Error clearing history:', err);
  }
}

// Update Status (Polled frequently)
async function updateStatus() {
  try {
    const res = await fetch(`${API_BASE}/api/status`);
    const data = await res.json();
    
    // Secured Badge display toggle
    const securedBadge = document.getElementById('securedBadge');
    if (securedBadge) {
      securedBadge.style.display = data.passwordRequired ? 'inline-flex' : 'none';
    }

    // Status Pill
    if (data.enabled) {
      el.statusDot.className = 'status-dot pulsing';
      el.statusText.textContent = 'Monitor Attivo';
      el.timerContainer.style.display = 'flex';
    } else {
      el.statusDot.className = 'status-dot paused';
      el.statusText.textContent = 'Monitor Pausato';
      el.timerContainer.style.display = 'none';
    }

    // Last Checked
    if (data.lastChecked) {
      const date = new Date(data.lastChecked);
      el.lastChecked.textContent = date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
    } else {
      el.lastChecked.textContent = 'Mai';
    }

    // Set Countdown state
    state.countdownSeconds = data.nextCheckInSeconds || 0;
    updateTimerText();

  } catch (err) {
    console.error('Error updating status:', err);
    el.statusDot.className = 'status-dot paused';
    el.statusText.textContent = 'Server Offline';
  }
}

// ==========================================
// RENDER HELPERS
// ==========================================

// Populate Form Settings
function populateSettingsForm() {
  const s = state.settings;
  el.intervalInput.value = s.intervalMinutes || 5;
  el.soundToggle.checked = s.soundEnabled !== false;
  el.enabledToggle.checked = s.enabled !== false;
  el.hoursStartInput.value = s.activeHoursStart !== undefined ? s.activeHoursStart : 8;
  el.hoursEndInput.value = s.activeHoursEnd !== undefined ? s.activeHoursEnd : 20;

  // Uncheck all active days first
  document.querySelectorAll('input[name="activeDays"]').forEach(cb => {
    cb.checked = false;
  });

  // Check specified days
  const activeDays = s.activeDays || [2, 3, 4, 5, 6];
  activeDays.forEach(day => {
    const cb = document.querySelector(`input[name="activeDays"][value="${day}"]`);
    if (cb) cb.checked = true;
  });
}

// Render Keywords List
function renderKeywords() {
  el.keywordsCount.textContent = state.keywords.length;
  el.tagsContainer.innerHTML = '';
  
  if (state.keywords.length === 0) {
    el.tagsContainer.innerHTML = `<span class="text-muted" style="font-size: 0.8rem;">Nessuna parola chiave impostata.</span>`;
    return;
  }

  state.keywords.forEach(kw => {
    const tag = document.createElement('span');
    tag.className = 'tag';
    tag.innerHTML = `
      ${escapeHtml(kw)}
      <span class="delete-btn">&times;</span>
    `;
    
    tag.querySelector('.delete-btn').addEventListener('click', () => {
      deleteKeyword(kw);
    });

    el.tagsContainer.appendChild(tag);
  });
}

// Render Scraped Match History Feed
function renderHistory() {
  el.historyCount.textContent = state.history.length;
  el.historyGrid.innerHTML = '';

  if (state.history.length === 0) {
    el.historyGrid.innerHTML = `
      <div class="empty-state">
        <svg xmlns="http://www.w3.org/2000/svg" width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z"/><circle cx="12" cy="13" r="4"/></svg>
        <h3>Nessun Prodotto Rilevato</h3>
        <p>Il sistema controllerà le nuove aggiunte su New Old Camera basandosi sulle tue parole chiave ed elencherà qui gli articoli abbinati.</p>
      </div>
    `;
    return;
  }

  state.history.forEach(item => {
    const card = document.createElement('article');
    card.className = 'glass-card product-card';
    
    // Brand custom badge style
    const brandLower = (item.marca || '').toLowerCase();
    let brandClass = '';
    if (brandLower.includes('leica')) brandClass = 'leica';
    else if (brandLower.includes('nikon')) brandClass = 'nikon';
    else if (brandLower.includes('canon')) brandClass = 'canon';
    else if (brandLower.includes('sony')) brandClass = 'sony';

    // Pricing Logic
    const isPromo = item.prezzoPromozione > 0 && item.prezzoPromozione < item.prezzoVendita;
    const priceHtml = isPromo 
      ? `
        <div class="price-area">
          <span class="price-original">€${item.prezzoVendita}</span>
          <span class="price-current promo">€${item.prezzoPromozione}</span>
        </div>
      `
      : `
        <div class="price-area">
          <span class="price-current">€${item.prezzoVendita}</span>
        </div>
      `;

    // Image URL Logic
    let imageSrc = '';
    let hasImage = false;
    if (item.virtualPath && item.virtualPath.trim() !== '') {
      hasImage = true;
      const path = item.virtualPath.trim();
      if (path.startsWith('http')) {
        imageSrc = path;
      } else if (path.startsWith('/')) {
        imageSrc = `https://www.newoldcamera.com${path}`;
      } else {
        imageSrc = `https://www.newoldcamera.com/${path}`;
      }
    }

    const imageHtml = hasImage 
      ? `<img src="${imageSrc}" alt="${escapeHtml(item.marca)} ${escapeHtml(item.modello)}" loading="lazy">`
      : `
        <div class="product-image-placeholder">
          <svg xmlns="http://www.w3.org/2000/svg" width="36" height="36" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z"/><circle cx="12" cy="13" r="4"/></svg>
          <span>Nessuna Foto</span>
        </div>
      `;

    // Booking Watermark Label
    let bookingHtml = '';
    if (item.prenotato > 0) {
      bookingHtml = `<span class="condition-badge" style="background-color: var(--danger); color: white;">PRENOTATO</span>`;
    } else if (item.stato) {
      bookingHtml = `<span class="condition-badge" title="Condizione dell'usato">Usato: ${escapeHtml(item.stato)}</span>`;
    } else {
      bookingHtml = `<span class="condition-badge" style="background-color: var(--success); color: black;">NUOVO</span>`;
    }

    // Relative Scraped Time Helper
    const relativeTime = getRelativeTime(item.timestampScraped);

    // Direct Product Link URL
    const productUrl = `https://www.newoldcamera.com/Scheda.aspx?Codice=${item.codice}`;

    card.innerHTML = `
      <div class="product-image-container">
        ${imageHtml}
        <div class="card-floating-badges">
          <span class="brand-badge ${brandClass}">${escapeHtml(item.marca)}</span>
          ${bookingHtml}
        </div>
        <span class="matched-kw-badge">MATCH: ${escapeHtml(item.matchedKeyword)}</span>
      </div>
      <div class="product-info">
        <h3 class="prod-title">${escapeHtml(item.marca)}</h3>
        <p class="prod-model">${escapeHtml(item.modello)}</p>
        <div class="prod-footer">
          ${priceHtml}
          <div class="card-actions">
            <a href="${productUrl}" target="_blank" class="btn-card-link" title="Vedi scheda prodotto sul sito">
              <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><line x1="5" y1="12" x2="19" y2="12"/><polyline points="12 5 19 12 12 19"/></svg>
            </a>
          </div>
        </div>
      </div>
      <span class="scanned-timestamp" title="${new Date(item.timestampScraped).toLocaleString()}">${relativeTime}</span>
    `;

    el.historyGrid.appendChild(card);
  });
}

function showSkeletons() {
  el.historyGrid.innerHTML = `
    <div class="skeleton-card"></div>
    <div class="skeleton-card"></div>
    <div class="skeleton-card"></div>
  `;
}

// ==========================================
// BACKGROUND LOOPS & TIMERS
// ==========================================

function startStatusPolling() {
  if (state.statusPollIntervalId) {
    clearInterval(state.statusPollIntervalId);
  }
  
  // Poll every 3 seconds to keep status in sync
  state.statusPollIntervalId = setInterval(updateStatus, 3000);
}

function startCountdownTimer() {
  if (state.countdownIntervalId) {
    clearInterval(state.countdownIntervalId);
  }

  // Ticks every second locally to show smooth countdown
  state.countdownIntervalId = setInterval(() => {
    if (state.settings.enabled && state.countdownSeconds > 0) {
      state.countdownSeconds--;
      updateTimerText();
    }
  }, 1000);
}

function updateTimerText() {
  if (!state.settings.enabled) {
    el.nextCheckTimer.textContent = 'Disattivato';
    return;
  }
  
  if (state.countdownSeconds <= 0) {
    el.nextCheckTimer.textContent = 'In corso...';
    return;
  }

  const mins = Math.floor(state.countdownSeconds / 60);
  const secs = state.countdownSeconds % 60;
  
  const paddedMins = String(mins).padStart(2, '0');
  const paddedSecs = String(secs).padStart(2, '0');
  
  el.nextCheckTimer.textContent = `${paddedMins}:${paddedSecs}`;
}

// ==========================================
// UTILITY FUNCTIONS
// ==========================================

// Parse ISO date string to human relative time
function getRelativeTime(isoString) {
  const date = new Date(isoString);
  const now = new Date();
  const diffMs = now - date;
  const diffMins = Math.floor(diffMs / 60000);
  const diffHours = Math.floor(diffMins / 60);

  if (diffMins < 1) return 'Rilevato ora';
  if (diffMins < 60) return `Rilevato ${diffMins} min fa`;
  if (diffHours < 24) return `Rilevato ${diffHours} ore fa`;
  
  return date.toLocaleDateString([], { day: '2-digit', month: 'short' }) + ' ' + date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

// Escape dangerous HTML strings
function escapeHtml(str) {
  if (!str) return '';
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

// Simple floating Toast notification in HTML
function showToast(message, type = 'info') {
  const container = document.getElementById('toast-container') || createToastContainer();
  
  const toast = document.createElement('div');
  toast.className = `toast toast-${type}`;
  toast.innerHTML = `
    <span class="toast-message">${message}</span>
  `;
  
  container.appendChild(toast);
  
  // Transition in
  setTimeout(() => {
    toast.classList.add('visible');
  }, 10);
  
  // Transition out and destroy
  setTimeout(() => {
    toast.classList.remove('visible');
    setTimeout(() => {
      toast.remove();
    }, 300);
  }, 3500);
}

function createToastContainer() {
  const container = document.createElement('div');
  container.id = 'toast-container';
  container.style.cssText = `
    position: fixed;
    bottom: 24px;
    right: 24px;
    display: flex;
    flex-direction: column;
    gap: 10px;
    z-index: 10000;
    pointer-events: none;
  `;
  document.body.appendChild(container);
  
  // Add quick dynamic CSS for toast inside document head
  const style = document.createElement('style');
  style.textContent = `
    .toast {
      padding: 12px 20px;
      border-radius: 8px;
      font-size: 0.85rem;
      font-weight: 600;
      color: #fff;
      background: rgba(15, 23, 42, 0.95);
      border: 1px solid rgba(255, 255, 255, 0.1);
      box-shadow: 0 10px 15px -3px rgba(0, 0, 0, 0.3);
      backdrop-filter: blur(10px);
      min-width: 250px;
      max-width: 350px;
      transform: translateY(20px);
      opacity: 0;
      transition: all 0.3s cubic-bezier(0.175, 0.885, 0.32, 1.275);
      pointer-events: auto;
    }
    .toast.visible {
      transform: translateY(0);
      opacity: 1;
    }
    .toast-success { border-left: 4px solid var(--success); }
    .toast-danger { border-left: 4px solid var(--danger); }
    .toast-info { border-left: 4px solid var(--info); }
    .spinning {
      animation: spin 1s linear infinite;
    }
    @keyframes spin {
      100% { transform: rotate(360deg); }
    }
  `;
  document.head.appendChild(style);
  
  return container;
}
