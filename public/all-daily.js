// API Base Endpoint (assumes relative hosting, fallback to localhost:3000)
const API_BASE = '';

// Application State
let state = {
  products: [],
  enabled: true
};

// DOM Elements
const el = {
  statusDot: document.getElementById('statusDot'),
  statusText: document.getElementById('statusText'),
  lastChecked: document.getElementById('lastChecked'),
  productsCount: document.getElementById('productsCount'),
  productsGrid: document.getElementById('productsGrid')
};

// ==========================================
// INITIALIZATION
// ==========================================
document.addEventListener('DOMContentLoaded', async () => {
  // Show skeleton cards during initial load
  showSkeletons();
  
  // Initial data fetch
  await fetchProducts();
  await updateStatus();
  
  // Start active status polling
  startStatusPolling();
});

// ==========================================
// API CLIENT OPERATIONS
// ==========================================

// Get All Daily Products
async function fetchProducts() {
  try {
    const res = await fetch(`${API_BASE}/api/all-daily`);
    const data = await res.json();
    state.products = data.products || [];
    renderProducts();
  } catch (err) {
    console.error('Error fetching daily products:', err);
  }
}

// Update Status (Polled frequently)
async function updateStatus() {
  try {
    const res = await fetch(`${API_BASE}/api/status`);
    const data = await res.json();

    // Status Pill
    if (data.enabled) {
      state.enabled = true;
      el.statusDot.className = 'status-dot pulsing';
      el.statusText.textContent = 'Monitor Attivo';
    } else {
      state.enabled = false;
      el.statusDot.className = 'status-dot paused';
      el.statusText.textContent = 'Monitor Pausato';
    }

    // Last Checked
    if (data.lastChecked) {
      const date = new Date(data.lastChecked);
      el.lastChecked.textContent = date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
    } else {
      el.lastChecked.textContent = 'Mai';
    }

  } catch (err) {
    console.error('Error updating status:', err);
    el.statusDot.className = 'status-dot paused';
    el.statusText.textContent = 'Server Offline';
  }
}

function startStatusPolling() {
  // Poll every 3 seconds to keep status in sync
  setInterval(async () => {
    await updateStatus();
    // Also periodically fetch the products to keep it live
    await fetchProducts();
  }, 5000);
}

// ==========================================
// RENDER HELPERS
// ==========================================

function showSkeletons() {
  el.productsGrid.innerHTML = `
    <div class="skeleton-card"></div>
    <div class="skeleton-card"></div>
    <div class="skeleton-card"></div>
  `;
}

// Render Scraped Products Feed
function renderProducts() {
  el.productsCount.textContent = state.products.length;
  el.productsGrid.innerHTML = '';

  if (state.products.length === 0) {
    el.productsGrid.innerHTML = `
      <div class="empty-state" style="grid-column: 1 / -1; text-align: center; padding: 60px 20px;">
        <svg xmlns="http://www.w3.org/2000/svg" width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" style="margin-bottom: 16px; color: var(--text-muted);"><path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z"/><circle cx="12" cy="13" r="4"/></svg>
        <h3 style="font-family: 'Montserrat', sans-serif; font-size: 1.25rem; font-weight: 700; margin-bottom: 8px;">Nessun Prodotto Rilevato</h3>
        <p style="color: var(--text-secondary); max-width: 500px; margin: 0 auto; font-size: 0.85rem;">Nessun prodotto è stato ancora pubblicato sul sito oggi, oppure il database è stato recentemente azzerato.</p>
      </div>
    `;
    return;
  }

  state.products.forEach(item => {
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

    el.productsGrid.appendChild(card);
  });
}

// ==========================================
// UTILITY FUNCTIONS
// ==========================================

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

function escapeHtml(str) {
  if (!str) return '';
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}
