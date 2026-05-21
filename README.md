# NOCameraNews 📸

**NOCameraNews** (New Old Camera Monitor) è un'applicazione web e un servizio di monitoraggio in tempo reale che traccia i nuovi arrivi sul celebre sito di attrezzatura fotografica usata *New Old Camera*. 

Il sistema interroga in modo estremamente leggero l'API del sito, filtra i prodotti in base alle tue parole chiave personalizzate (es. `LEICA`, `NIKON`) e ti avvisa immediatamente tramite notifiche desktop o registrando i match in una splendida dashboard con design moderno (Dark Mode & Glassmorphism).

---

## 🚀 Funzionalità Principali

*   **Scraper Intelligente in Background:** Esegue controlli regolari consumando pochissimi Kilobyte di dati direttamente dall'API di Azure Gateway di New Old Camera.
*   **Pianificazione Avanzata:** Per rispettare i server del sito, il monitor è attivo solo nelle ore calde di caricamento:
    *   **Orari:** dalle 08:00 alle 20:00 (pausa notturna automatica).
    *   **Giorni:** da Martedì a Sabato (giorni lavorativi del negozio).
    *   **Frequenza:** personalizzabile (default: ogni 5 minuti).
*   **Dashboard Web Premium (Glassmorphism):**
    *   Aggiunta e rimozione rapida delle parole chiave di ricerca.
    *   Visualizzazione della cronologia degli articoli rilevati con dettagli su prezzo (con indicatore promo), condizioni dell'usato (Stato A, AB, B, ecc.) e link diretto alla scheda.
    *   Conto alla rovescia in tempo reale per la prossima scansione e pulsante per forzare il controllo manuale.
    *   Pannello di configurazione delle ore e dei giorni di attività.
*   **Notifiche Desktop macOS (Solo in locale):** Avvisi sonori e visivi con click diretto per aprire l'articolo nel browser.

---

## 🛠️ Architettura dei File

*   `server.js`: Il server backend Node.js (Express) che gestisce il crawler periodico, le notifiche e le API REST per la dashboard.
*   `db.json`: Database JSON locale ultra-leggero che memorizza lo stato delle notifiche già inviate (`seenIds`), la cronologia dei match, le parole chiave e le impostazioni del timer.
*   `public/`: La cartella contenente l'interfaccia frontend (HTML, CSS con stili premium e file JS interattivo).
*   `Dockerfile` & `docker-compose.yml`: File di configurazione per containerizzare l'applicazione in un clic.

---

## 💻 Esecuzione Locale (Con Notifiche macOS Funzionanti)

Per godere delle notifiche native macOS direttamente sul tuo desktop, è necessario eseguire il server in locale:

1. **Installazione delle dipendenze:**
   ```bash
   npm install
   ```

2. **Avvio del server:**
   ```bash
   npm start
   ```

3. **Accesso alla Dashboard:**
   Apri sul tuo browser l'indirizzo: **`http://localhost:3000`**

---

## 🐳 Esecuzione tramite Docker (Consigliata per Server/NAS)

Se vuoi che il monitor sia attivo h24 su una macchina Linux, un NAS o un server remoto senza dipendere dal tuo computer personale:

1. **Avvio dei container:**
   ```bash
   docker compose up -d --build
   ```

2. **Gestione del database (`db.json`):**
   Il file `db.json` è montato come volume. Le impostazioni e la cronologia dei match rimarranno salvate anche se distruggi o riavvii il container.

3. **Visualizzazione dei log:**
   ```bash
   docker compose logs -f
   ```

*Nota: In ambiente Docker (Linux), le notifiche desktop native di macOS non verranno visualizzate, ma tutti gli avvisi continueranno ad essere registrati correttamente nel database e saranno consultabili in qualsiasi momento dalla dashboard.*
