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

## 🛠️ Architettura dei File e Database

*   `server.js`: Il server backend Node.js (Express) che gestisce il crawler periodico, le notifiche e le API REST per la dashboard.
*   **Database PostgreSQL**: Il sistema si basa su un database relazionale composto da due tabelle principali:
    *   `app_preferences`: Memorizza le preferenze dell'applicazione (impostazioni, parole chiave e cronologia) in formato JSONB.
    *   `all_daily_products`: Memorizza tutti gli articoli trovati durante la giornata, identificati univocamente da `id`. Questa tabella viene svuotata automaticamente la notte (dopo le 20:00 o al cambio del giorno).
*   `public/`: La cartella contenente l'interfaccia frontend (HTML, CSS con stili premium e file JS interattivo).
*   `Dockerfile` & `docker-compose.yml`: File di configurazione per containerizzare l'applicazione e avviare il database PostgreSQL in un clic.

---

## 💻 Esecuzione Locale (Con Notifiche macOS Funzionanti)

Per godere delle notifiche native macOS direttamente sul tuo desktop, è necessario eseguire il server in locale ed avere un'istanza PostgreSQL attiva:

1. **Avviare PostgreSQL:** Assicurarsi che PostgreSQL sia in esecuzione (ad esempio tramite Docker o installazione locale) e definire la variabile d'ambiente `DATABASE_URL` nel terminale.
   ```bash
   export DATABASE_URL=postgresql://postgres:postgrespassword@localhost:5432/nocameranews
   ```

2. **Installazione delle dipendenze:**
   ```bash
   npm install
   ```

3. **Avvio del server:**
   ```bash
   npm start
   ```

4. **Accesso alla Dashboard:**
   Apri sul tuo browser l'indirizzo: **`http://localhost:3000`**

---

## 🐳 Esecuzione tramite Docker (Consigliata)

Se vuoi eseguire il monitor completo (app + database) in modo isolato:

1. **Avvio dei container:**
   ```bash
   docker compose up -d --build
   ```

2. **Persistenza dei Dati:**
   Il volume PostgreSQL `pgdata` è configurato per persistere tutti i dati di impostazione, cronologia e stato del crawler anche dopo il riavvio o lo spegnimento dei container.

3. **Visualizzazione dei log:**
   ```bash
   docker compose logs -f
   ```

*Nota: In ambiente Docker (Linux), le notifiche desktop native di macOS non verranno visualizzate, ma tutti gli avvisi continueranno ad essere registrati correttamente nel database e saranno consultabili in qualsiasi momento dalla dashboard o tramite bot Telegram.*
