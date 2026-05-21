# HSE Certificate Tracker — PWA

Offline-first Progressive Web App for tracking HSE training certificates, medical
fitness, identity documents (Resident ID, Passport, Driving License, CEP, DCRP,
Insurance) and vehicle records (Mulkia, insurance, etc.) with multi-stage
expiry alerts.

## Features

- **Personnel & Training** — multiple courses per person with start date, validity (6m/1y/2y/3y/5y/custom) and auto-computed expiry.
- **Medical / Fitness** — typed medical certificates (annual fitness, driver medical, etc.).
- **Documents & IDs** — Resident ID, Passport, Driving License, CEP, DCRP, Insurance, or any manual type.
- **Vehicles** — vehicle profile + records (Mulkia, Insurance, Inspection, manual).
- **PDF / image certificates** — attach files; preview side-by-side with the detail view; click for full-screen lightbox.
- **Expiry alerts** — local notifications + in-app toasts at 45, 30, 15, 10, 5, 3 and 1 day before expiry, and after expiry.
- **Renewal flow** — renewing a certificate moves the old file & dates into Expired History automatically.
- **Intelligent search** — global Ctrl/⌘-/ across all entities, plus per-view search, sort and status filters.
- **Interactive dashboard** — stat cards, donut chart, 6-month expirations bar chart, expiring-soon list, recent additions.
- **Sharing** — Web Share API (native Android/iOS share sheet → WhatsApp / Mail / Files), plus fallback WhatsApp / mailto / download / copy.
- **Backup** — JSON export including embedded file blobs; one-click import.
- **PWA** — installable, works offline, registers periodic background sync where supported.

## How to install on a phone

1. Host the contents of this folder on any static web host **over HTTPS** (GitHub Pages, Netlify, Cloudflare Pages, Vercel, your own server).
2. Open the URL on your phone in Chrome (Android) or Safari (iOS).
3. Android Chrome will show an *Install app* prompt — tap it.
   iOS Safari: tap Share → *Add to Home Screen*.
4. Open from the home-screen icon. Allow notifications when prompted.

## How to run locally for testing

```bash
python3 -m http.server 8080
# then open http://localhost:8080
```

Service workers, notifications and the Web Share API require HTTPS or
`localhost` — they will not work if you open `index.html` from a `file://` URL.

## How to deploy to GitHub Pages

1. Push this repo to GitHub.
2. In *Settings → Pages*, set **Source** to the branch holding these files (root).
3. Open `https://<you>.github.io/<repo>/` on your phone and install.

## Data & privacy

All data — including attached certificate files — is stored locally on your
device using IndexedDB. Nothing is uploaded anywhere. Use Settings → *Export
backup* to keep an off-device copy.
