// API Base Endpoint (assumes relative hosting, fallback to localhost:3000)
const API_BASE = '';

// Application State
let state = {
  settings: {},
  keywords: [],
  passwordRequired: false
};

// DOM Elements
const el = {
  loginGateway: document.getElementById('loginGateway'),
  settingsContainer: document.getElementById('settingsContainer'),
  gatewayPasswordInput: document.getElementById('gatewayPasswordInput'),
  btnGatewayConfirm: document.getElementById('btnGatewayConfirm'),
  settingsForm: document.getElementById('settingsForm'),
  
  intervalInput: document.getElementById('intervalInput'),
  desktopToggle: document.getElementById('desktopToggle'),
  soundToggle: document.getElementById('soundToggle'),
  enabledToggle: document.getElementById('enabledToggle'),
  hoursStartInput: document.getElementById('hoursStartInput'),
  hoursEndInput: document.getElementById('hoursEndInput'),
  activeDaysCheckboxes: document.getElementsByName('activeDays'),
  
  // Telegram Integration elements
  telegramToggle: document.getElementById('telegramToggle'),
  telegramFields: document.getElementById('telegramFields'),
  telegramTokenInput: document.getElementById('telegramTokenInput'),
  telegramChatIdInput: document.getElementById('telegramChatIdInput'),
  btnToggleTokenVisibility: document.getElementById('btnToggleTokenVisibility'),
  btnTestTelegram: document.getElementById('btnTestTelegram'),
  eyeIcon: document.getElementById('eyeIcon'),
  
  keywordInput: document.getElementById('keywordInput'),
  btnAddKeyword: document.getElementById('btnAddKeyword'),
  tagsContainer: document.getElementById('tagsContainer'),
  keywordsCount: document.getElementById('keywordsCount')
};

// ==========================================
// INITIALIZATION
// ==========================================
document.addEventListener('DOMContentLoaded', async () => {
  setupEventListeners();
  await checkAuthAndLoad();
});

function setupEventListeners() {
  // Confirm Password
  el.btnGatewayConfirm.addEventListener('click', handleGatewayLogin);
  el.gatewayPasswordInput.addEventListener('keypress', (e) => {
    if (e.key === 'Enter') handleGatewayLogin();
  });
  
  // Add Keyword
  el.btnAddKeyword.addEventListener('click', handleAddKeyword);
  el.keywordInput.addEventListener('keypress', (e) => {
    if (e.key === 'Enter') handleAddKeyword();
  });
  
  // Submit Settings Form
  el.settingsForm.addEventListener('submit', handleSettingsSubmit);

  // Telegram fields toggling dynamic visibility
  if (el.telegramToggle) {
    el.telegramToggle.addEventListener('change', (e) => {
      toggleTelegramFieldsVisibility(e.target.checked);
    });
  }

  // Telegram test button
  if (el.btnTestTelegram) {
    el.btnTestTelegram.addEventListener('click', handleTestTelegram);
  }

  // Bot Token visibility toggle
  if (el.btnToggleTokenVisibility) {
    el.btnToggleTokenVisibility.addEventListener('click', () => {
      const isPassword = el.telegramTokenInput.type === 'password';
      el.telegramTokenInput.type = isPassword ? 'text' : 'password';
      
      // Update eye icon SVG to strike-through if visible
      if (isPassword) {
        el.eyeIcon.innerHTML = `<path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-10-7-10-7a22.49 22.49 0 0 1 2.9-4M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 10 7 10 7a19.5 19.5 0 0 1-2.73 4.14M4.93 4.93l14.14 14.14"/><circle cx="12" cy="12" r="3"/>`;
      } else {
        el.eyeIcon.innerHTML = `<path d="M2 12s3-7 10-7 10 7 10 7-3 7-10 7-10-7-10-7Z"/><circle cx="12" cy="12" r="3"/>`;
      }
    });
  }

  // Filter Modal Event Listeners
  const filterForm = document.getElementById('filterForm');
  if (filterForm) {
    filterForm.addEventListener('submit', handleFilterSubmit);
  }
  const btnCancelFilter = document.getElementById('btnCancelFilter');
  if (btnCancelFilter) {
    btnCancelFilter.addEventListener('click', closeFilterModal);
  }
  const btnResetFilter = document.getElementById('btnResetFilter');
  if (btnResetFilter) {
    btnResetFilter.addEventListener('click', resetFilterForm);
  }
  const filterModal = document.getElementById('filterModal');
  if (filterModal) {
    filterModal.addEventListener('click', (e) => {
      if (e.target.id === 'filterModal') closeFilterModal();
    });
  }
}

function toggleTelegramFieldsVisibility(show) {
  if (!el.telegramFields) return;
  
  // Ensure basic smooth transitions
  el.telegramFields.style.transition = 'all 0.4s cubic-bezier(0.16, 1, 0.3, 1)';
  
  if (show) {
    el.telegramFields.style.opacity = '1';
    el.telegramFields.style.pointerEvents = 'auto';
    el.telegramFields.style.maxHeight = '500px';
    el.telegramFields.style.transform = 'translateY(0)';
    el.telegramFields.style.marginTop = '12px';
  } else {
    el.telegramFields.style.opacity = '0';
    el.telegramFields.style.pointerEvents = 'none';
    el.telegramFields.style.maxHeight = '0';
    el.telegramFields.style.transform = 'translateY(-10px)';
    el.telegramFields.style.marginTop = '0';
  }
}

async function handleTestTelegram() {
  const token = el.telegramTokenInput.value.trim();
  const chatId = el.telegramChatIdInput.value.trim();

  if (!token || !chatId) {
    showToast('Inserisci Token Bot e Chat ID prima di inviare un test!', 'info');
    return;
  }

  el.btnTestTelegram.disabled = true;
  const originalHtml = el.btnTestTelegram.innerHTML;
  el.btnTestTelegram.innerHTML = 'Invio in corso...';

  // Submit with X-Admin-Password if needed
  const headers = {
    'Content-Type': 'application/json'
  };
  
  if (state.passwordRequired) {
    const password = localStorage.getItem('admin_password');
    if (password) headers['x-admin-password'] = password;
  }

  try {
    const res = await fetch(`${API_BASE}/api/test-telegram`, {
      method: 'POST',
      headers: headers,
      body: JSON.stringify({ telegramToken: token, telegramChatId: chatId })
    });

    const data = await res.json();
    if (res.ok) {
      showToast('Notifica di prova Telegram inviata con successo!', 'success');
    } else {
      showToast(data.error || 'Errore durante l\'invio del test.', 'danger');
    }
  } catch (err) {
    console.error('Error testing Telegram:', err);
    showToast('Impossibile connettersi al server per il test.', 'danger');
  } finally {
    el.btnTestTelegram.disabled = false;
    el.btnTestTelegram.innerHTML = originalHtml;
  }
}

// ==========================================
// AUTHENTICATION & LOADING
// ==========================================
async function checkAuthAndLoad() {
  try {
    // 1. Fetch system status to see if password protection is enabled
    const statusRes = await fetch(`${API_BASE}/api/status`);
    if (!statusRes.ok) {
      throw new Error('Impossibile connettersi al server per lo stato.');
    }
    
    const statusData = await statusRes.json();
    state.passwordRequired = statusData.passwordRequired;
    
    // 2. If password is not required, bypass gateway immediately
    if (!state.passwordRequired) {
      await fetchSettingsAndShow();
      return;
    }
    
    // 3. If password is required, check localStorage
    const cachedPassword = localStorage.getItem('admin_password');
    if (cachedPassword) {
      const success = await attemptFetchSettings(cachedPassword);
      if (success) {
        // Cached password works! Form is now loaded and shown
        return;
      } else {
        // Stale password, clear it
        localStorage.removeItem('admin_password');
      }
    }
    
    // 4. If we reach here, show the Login Gateway beautifully
    showElement(el.loginGateway);
    el.gatewayPasswordInput.focus();
    
  } catch (err) {
    console.error('Initialization error:', err);
    showToast('Errore durante il caricamento della pagina.', 'danger');
  }
}

async function attemptFetchSettings(password) {
  try {
    const res = await fetch(`${API_BASE}/api/settings`, {
      headers: {
        'x-admin-password': password
      }
    });
    
    if (res.status === 200) {
      const data = await res.json();
      state.settings = data.settings;
      
      // Fetch keywords as well
      const keywordsRes = await fetch(`${API_BASE}/api/keywords`, {
        headers: {
          'x-admin-password': password
        }
      });
      if (keywordsRes.ok) {
        const keywordsData = await keywordsRes.json();
        state.keywords = keywordsData.keywords || [];
        renderKeywords();
      }
      
      // Populate inputs
      populateForm(data.settings);
      
      // Transition out login gateway and show settings container
      hideElement(el.loginGateway);
      showElement(el.settingsContainer);
      
      return true;
    } else if (res.status === 401) {
      return false;
    } else {
      throw new Error(`Status ${res.status}`);
    }
  } catch (err) {
    console.error('Error attempting settings fetch:', err);
    return false;
  }
}

async function handleGatewayLogin() {
  const password = el.gatewayPasswordInput.value;
  if (!password) {
    showToast('Inserisci la password amministratore.', 'info');
    el.gatewayPasswordInput.focus();
    return;
  }
  
  // Disable button and input during processing
  el.btnGatewayConfirm.disabled = true;
  el.gatewayPasswordInput.disabled = true;
  const originalBtnText = el.btnGatewayConfirm.innerText;
  el.btnGatewayConfirm.innerText = 'Verifica...';
  
  try {
    const success = await attemptFetchSettings(password);
    if (success) {
      // Save valid password in localStorage
      localStorage.setItem('admin_password', password);
      showToast('Autenticazione riuscita!', 'success');
    } else {
      showToast('Password errata o non valida.', 'danger');
      el.gatewayPasswordInput.disabled = false;
      el.btnGatewayConfirm.disabled = false;
      el.btnGatewayConfirm.innerText = originalBtnText;
      el.gatewayPasswordInput.focus();
      el.gatewayPasswordInput.select();
    }
  } catch (err) {
    console.error('Error during gateway confirm:', err);
    showToast('Errore durante la connessione al server.', 'danger');
    el.gatewayPasswordInput.disabled = false;
    el.btnGatewayConfirm.disabled = false;
    el.btnGatewayConfirm.innerText = originalBtnText;
  }
}

async function fetchSettingsAndShow() {
  try {
    const res = await fetch(`${API_BASE}/api/settings`);
    if (!res.ok) throw new Error('Failed to load settings');
    
    const data = await res.json();
    state.settings = data.settings;
    
    // Fetch keywords as well
    const keywordsRes = await fetch(`${API_BASE}/api/keywords`);
    if (keywordsRes.ok) {
      const keywordsData = await keywordsRes.json();
      state.keywords = keywordsData.keywords || [];
      renderKeywords();
    }
    
    populateForm(data.settings);
    hideElement(el.loginGateway);
    showElement(el.settingsContainer);
  } catch (err) {
    console.error('Error loading public settings:', err);
    showToast('Errore nel caricamento delle impostazioni.', 'danger');
  }
}

// ==========================================
// FORM CONTROLS & UTILS
// ==========================================
function populateForm(settings) {
  if (!settings) return;
  
  el.intervalInput.value = settings.intervalMinutes || 5;
  el.desktopToggle.checked = settings.desktopEnabled !== false;
  el.soundToggle.checked = settings.soundEnabled !== false;
  el.enabledToggle.checked = settings.enabled !== false;
  el.hoursStartInput.value = settings.activeHoursStart !== undefined ? settings.activeHoursStart : 8;
  el.hoursEndInput.value = settings.activeHoursEnd !== undefined ? settings.activeHoursEnd : 20;
  
  // Telegram Settings
  el.telegramToggle.checked = settings.telegramEnabled === true;
  el.telegramTokenInput.value = settings.telegramToken || '';
  el.telegramChatIdInput.value = settings.telegramChatId || '';
  
  // Initial visibility of Telegram Fields
  toggleTelegramFieldsVisibility(settings.telegramEnabled === true);
  
  // Reset and check days checkboxes
  const activeDays = settings.activeDays || [1, 2, 3, 4, 5];
  el.activeDaysCheckboxes.forEach(cb => {
    const val = parseInt(cb.value, 10);
    cb.checked = activeDays.includes(val);
  });
}

async function handleSettingsSubmit(e) {
  e.preventDefault();
  
  // Gather activeDays
  const activeDays = [];
  el.activeDaysCheckboxes.forEach(cb => {
    if (cb.checked) {
      activeDays.push(parseInt(cb.value, 10));
    }
  });
  
  // Validation for Telegram Bot Token and Chat ID if enabled
  if (el.telegramToggle.checked) {
    if (!el.telegramTokenInput.value.trim() || !el.telegramChatIdInput.value.trim()) {
      showToast('Inserisci il Bot Token e il Chat ID per abilitare Telegram.', 'danger');
      return;
    }
  }

  const payload = {
    settings: {
      intervalMinutes: parseInt(el.intervalInput.value, 10),
      desktopEnabled: el.desktopToggle.checked,
      soundEnabled: el.soundToggle.checked,
      enabled: el.enabledToggle.checked,
      activeHoursStart: parseInt(el.hoursStartInput.value, 10),
      activeHoursEnd: parseInt(el.hoursEndInput.value, 10),
      activeDays: activeDays,
      telegramEnabled: el.telegramToggle.checked,
      telegramToken: el.telegramTokenInput.value.trim(),
      telegramChatId: el.telegramChatIdInput.value.trim()
    }
  };
  
  // Submit with X-Admin-Password if needed
  const headers = {
    'Content-Type': 'application/json'
  };
  
  if (state.passwordRequired) {
    const password = localStorage.getItem('admin_password');
    if (!password) {
      showToast('Credenziali mancanti. Effettua nuovamente l\'accesso.', 'danger');
      window.location.reload();
      return;
    }
    headers['x-admin-password'] = password;
  }
  
  // Disable form elements during submission
  const submitBtn = el.settingsForm.querySelector('button[type="submit"]');
  const originalBtnText = submitBtn.innerText;
  submitBtn.disabled = true;
  submitBtn.innerText = 'Salvataggio in corso...';
  
  try {
    const res = await fetch(`${API_BASE}/api/settings`, {
      method: 'POST',
      headers: headers,
      body: JSON.stringify(payload)
    });
    
    if (res.ok) {
      const data = await res.json();
      state.settings = data.settings;
      populateForm(data.settings);
      showToast('Impostazioni salvate con successo!', 'success');
      
      // Navigate back to dashboard after a short delay
      setTimeout(() => {
        window.location.href = 'index.html';
      }, 1200);
      
    } else if (res.status === 401) {
      showToast('Credenziali non valide o scadute.', 'danger');
      localStorage.removeItem('admin_password');
      window.location.reload();
    } else {
      throw new Error('Salvataggio fallito');
    }
  } catch (err) {
    console.error('Error saving settings:', err);
    showToast('Impossibile salvare le impostazioni.', 'danger');
  } finally {
    submitBtn.disabled = false;
    submitBtn.innerText = originalBtnText;
  }
}

// ==========================================
// TRANSITIONS & VISIBILITY HELPERS
// ==========================================
function showElement(element) {
  if (!element) return;
  element.style.display = 'block';
  element.style.opacity = '0';
  element.style.transform = 'translateY(15px)';
  element.style.transition = 'all 0.4s cubic-bezier(0.16, 1, 0.3, 1)';
  
  // Trigger flow
  setTimeout(() => {
    element.style.opacity = '1';
    element.style.transform = 'translateY(0)';
  }, 50);
}

function hideElement(element) {
  if (!element) return;
  element.style.transition = 'all 0.3s cubic-bezier(0.16, 1, 0.3, 1)';
  element.style.opacity = '0';
  element.style.transform = 'translateY(-15px)';
  
  setTimeout(() => {
    element.style.display = 'none';
  }, 300);
}

// ==========================================
// TOAST NOTIFICATIONS SYSTEM
// ==========================================
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
  `;
  document.head.appendChild(style);
  
  return container;
}

// ==========================================
// KEYWORD TAG OPERATIONS WITH FILTERS
// ==========================================
let currentFilterIndex = null;

function renderKeywords() {
  el.keywordsCount.textContent = state.keywords.length;
  el.tagsContainer.innerHTML = '';
  
  if (state.keywords.length === 0) {
    el.tagsContainer.innerHTML = `<span class="text-muted" style="font-size: 0.8rem;">Nessuna parola chiave impostata.</span>`;
    return;
  }

  state.keywords.forEach((kw, index) => {
    const isObj = typeof kw === 'object' && kw !== null;
    const kwText = isObj ? kw.text : kw;
    
    // Check if there are active filters on this keyword
    const hasFilters = isObj && (
      (kw.minPrice !== undefined && kw.minPrice !== null && kw.minPrice !== '') ||
      (kw.maxPrice !== undefined && kw.maxPrice !== null && kw.maxPrice !== '') ||
      (Array.isArray(kw.exclude) && kw.exclude.length > 0)
    );

    const tag = document.createElement('span');
    tag.className = 'tag';
    tag.innerHTML = `
      ${escapeHtml(kwText)}
      <span class="tag-actions-wrapper">
        <span class="tag-cog-btn ${hasFilters ? 'active-filters' : ''}" title="${hasFilters ? 'Filtri attivi (Clicca per modificare)' : 'Imposta filtri avanzati'}">⚙️</span>
        <span class="delete-btn" title="Rimuovi">&times;</span>
      </span>
    `;
    
    tag.querySelector('.delete-btn').addEventListener('click', (e) => {
      e.stopPropagation();
      deleteKeyword(kwText);
    });

    tag.querySelector('.tag-cog-btn').addEventListener('click', (e) => {
      e.stopPropagation();
      openFilterModal(index);
    });

    el.tagsContainer.appendChild(tag);
  });
}

function openFilterModal(index) {
  currentFilterIndex = index;
  const kw = state.keywords[index];
  const isObj = typeof kw === 'object' && kw !== null;
  const kwText = isObj ? kw.text : kw;

  document.getElementById('modalKeywordTitle').textContent = kwText;
  
  // Populate modal fields
  if (isObj) {
    document.getElementById('filterMinPrice').value = kw.minPrice !== null && kw.minPrice !== undefined ? kw.minPrice : '';
    document.getElementById('filterMaxPrice').value = kw.maxPrice !== null && kw.maxPrice !== undefined ? kw.maxPrice : '';
    document.getElementById('filterExclude').value = Array.isArray(kw.exclude) ? kw.exclude.join(', ') : '';
  } else {
    document.getElementById('filterMinPrice').value = '';
    document.getElementById('filterMaxPrice').value = '';
    document.getElementById('filterExclude').value = '';
  }

  // Show modal backdrop
  const filterModal = document.getElementById('filterModal');
  filterModal.style.display = 'flex';
}

function closeFilterModal() {
  document.getElementById('filterModal').style.display = 'none';
  currentFilterIndex = null;
}

async function handleFilterSubmit(e) {
  e.preventDefault();
  if (currentFilterIndex === null) return;

  const minPrice = document.getElementById('filterMinPrice').value.trim();
  const maxPrice = document.getElementById('filterMaxPrice').value.trim();
  const excludeVal = document.getElementById('filterExclude').value.trim();

  // Convert comma-separated exclusions
  const exclude = excludeVal 
    ? excludeVal.split(',').map(word => word.trim().toUpperCase()).filter(word => word.length > 0)
    : [];

  const kw = state.keywords[currentFilterIndex];
  const isObj = typeof kw === 'object' && kw !== null;
  const kwText = isObj ? kw.text : kw;

  // Update active state
  state.keywords[currentFilterIndex] = {
    text: kwText,
    minPrice: minPrice !== '' ? Number(minPrice) : null,
    maxPrice: maxPrice !== '' ? Number(maxPrice) : null,
    exclude: exclude
  };

  // Convert back to string if they cleared everything
  const item = state.keywords[currentFilterIndex];
  if (item.minPrice === null && item.maxPrice === null && item.exclude.length === 0) {
    state.keywords[currentFilterIndex] = kwText;
  }

  closeFilterModal();
  renderKeywords();
  
  // Save modified keywords list immediately to server!
  await saveKeywordsToServer();
}

function resetFilterForm() {
  document.getElementById('filterMinPrice').value = '';
  document.getElementById('filterMaxPrice').value = '';
  document.getElementById('filterExclude').value = '';
}

async function saveKeywordsToServer() {
  const originalKeywords = [...state.keywords];
  
  try {
    const headers = { 'Content-Type': 'application/json' };
    if (state.passwordRequired) {
      const password = localStorage.getItem('admin_password');
      if (password) headers['x-admin-password'] = password;
    }
    
    const res = await fetch(`${API_BASE}/api/keywords`, {
      method: 'POST',
      headers: headers,
      body: JSON.stringify({ keywords: state.keywords })
    });
    
    if (res.ok) {
      const data = await res.json();
      state.keywords = data.keywords;
      renderKeywords();
      showToast('Configurazione filtri salvata!', 'success');
    } else if (res.status === 401) {
      showToast('Credenziali non valide o scadute.', 'danger');
      localStorage.removeItem('admin_password');
      window.location.reload();
    } else {
      throw new Error('Save failed');
    }
  } catch (err) {
    console.error('Error saving keywords:', err);
    state.keywords = originalKeywords;
    renderKeywords();
    showToast('Impossibile salvare i filtri sul server.', 'danger');
  }
}

async function handleAddKeyword() {
  const value = el.keywordInput.value.trim().toUpperCase();
  if (!value) return;
  
  // Safe comparison mapping structured or string keywords
  const exists = state.keywords.some(kw => {
    const text = typeof kw === 'object' && kw !== null ? kw.text : kw;
    return text === value;
  });

  if (exists) {
    showToast('Questa parola chiave è già tracciata!', 'info');
    el.keywordInput.value = '';
    return;
  }

  const originalKeywords = [...state.keywords];
  state.keywords.push(value);
  el.keywordInput.value = '';

  // Disable input and button
  el.keywordInput.disabled = true;
  el.btnAddKeyword.disabled = true;

  try {
    const headers = { 'Content-Type': 'application/json' };
    if (state.passwordRequired) {
      const password = localStorage.getItem('admin_password');
      if (password) headers['x-admin-password'] = password;
    }
    
    const res = await fetch(`${API_BASE}/api/keywords`, {
      method: 'POST',
      headers: headers,
      body: JSON.stringify({ keywords: state.keywords })
    });
    
    if (res.ok) {
      const data = await res.json();
      state.keywords = data.keywords;
      renderKeywords();
      showToast(`Parola chiave "${value}" aggiunta!`, 'success');
    } else if (res.status === 401) {
      showToast('Credenziali non valide o scadute.', 'danger');
      localStorage.removeItem('admin_password');
      window.location.reload();
    } else {
      throw new Error('Save failed');
    }
  } catch (err) {
    console.error('Error saving keywords:', err);
    state.keywords = originalKeywords;
    renderKeywords();
    showToast('Errore nel salvare la parola chiave.', 'danger');
  } finally {
    el.keywordInput.disabled = false;
    el.btnAddKeyword.disabled = false;
    el.keywordInput.focus();
  }
}

async function deleteKeyword(kwText) {
  const originalKeywords = [...state.keywords];
  state.keywords = state.keywords.filter(item => {
    const text = typeof item === 'object' && item !== null ? item.text : item;
    return text !== kwText;
  });
  
  try {
    const headers = { 'Content-Type': 'application/json' };
    if (state.passwordRequired) {
      const password = localStorage.getItem('admin_password');
      if (password) headers['x-admin-password'] = password;
    }
    
    const res = await fetch(`${API_BASE}/api/keywords`, {
      method: 'POST',
      headers: headers,
      body: JSON.stringify({ keywords: state.keywords })
    });
    
    if (res.ok) {
      const data = await res.json();
      state.keywords = data.keywords;
      renderKeywords();
      showToast('Parola chiave rimossa.', 'info');
    } else if (res.status === 401) {
      showToast('Credenziali non valide o scadute.', 'danger');
      localStorage.removeItem('admin_password');
      window.location.reload();
    } else {
      throw new Error('Deletion failed');
    }
  } catch (err) {
    console.error('Error deleting keyword:', err);
    state.keywords = originalKeywords;
    renderKeywords();
    showToast('Errore durante la rimozione della parola chiave.', 'danger');
  }
}

function escapeHtml(str) {
  if (!str) return '';
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}
