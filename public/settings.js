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
  soundToggle: document.getElementById('soundToggle'),
  enabledToggle: document.getElementById('enabledToggle'),
  hoursStartInput: document.getElementById('hoursStartInput'),
  hoursEndInput: document.getElementById('hoursEndInput'),
  activeDaysCheckboxes: document.getElementsByName('activeDays'),
  
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
  el.soundToggle.checked = settings.soundEnabled !== false;
  el.enabledToggle.checked = settings.enabled !== false;
  el.hoursStartInput.value = settings.activeHoursStart !== undefined ? settings.activeHoursStart : 8;
  el.hoursEndInput.value = settings.activeHoursEnd !== undefined ? settings.activeHoursEnd : 20;
  
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
  
  const payload = {
    settings: {
      intervalMinutes: parseInt(el.intervalInput.value, 10),
      soundEnabled: el.soundToggle.checked,
      enabled: el.enabledToggle.checked,
      activeHoursStart: parseInt(el.hoursStartInput.value, 10),
      activeHoursEnd: parseInt(el.hoursEndInput.value, 10),
      activeDays: activeDays
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
// KEYWORD TAG OPERATIONS
// ==========================================
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

async function handleAddKeyword() {
  const value = el.keywordInput.value.trim().toUpperCase();
  if (!value) return;
  
  if (state.keywords.includes(value)) {
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

async function deleteKeyword(kw) {
  const originalKeywords = [...state.keywords];
  state.keywords = state.keywords.filter(item => item !== kw);
  
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
