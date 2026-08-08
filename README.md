# SHBN - Bad Stock Supplier/EG Log

A static frontend (works on GitHub Pages) backed by a Google Apps Script Web
App bound to your **SHBN - Bad Stock Supplier/EG Log** Google Sheet.

## 1. Backend — Google Apps Script

1. Open the sheet: `SHBN - Bad Stock Supplier/EG Log`.
2. `Extensions` → `Apps Script`.
3. Delete any starter code, paste in **`Code.gs`** from this folder.
4. `Deploy` → `New deployment` → gear icon → **Web app**.
   - Execute as: **Me**
   - Who has access: **Anyone**
5. Click **Deploy**, authorize the script, and copy the `/exec` URL.
6. On the "Masterlist" tab, keep the header row exactly as:
   `Material | Material Description | Sales Unit | Numerator | EAN/UPC | Department`
   (this already matches your current sheet).
7. The script creates monthly tabs itself (e.g. `AUG2026`, `SEPT2026`) the
   first time an entry is submitted in that month — you don't need to
   pre-create them. It also adds a hidden column **P (Txn ID)** to each
   monthly tab; this is required internally to group the rows from one
   "New Entry" submission together before a Material Document number exists.
   Please don't delete or reuse that column.

Whenever you edit `Code.gs`, create a **new version** under `Deploy` →
`Manage deployments` → edit (pencil) → New version, so the live `/exec` URL
picks up your changes.

## 2. Frontend

1. In `app.js` **and** `print-station.js`, replace the placeholder with your
   real URL:
   ```js
   const WEB_APP_URL = 'https://script.google.com/macros/s/XXXXXXXX/exec';
   ```
2. Push `index.html`, `style.css`, `app.js` to a GitHub repo (e.g.
   `itshbn-web/Bad-Stock-Log`, matching your other tools).
3. Enable GitHub Pages for that repo (Settings → Pages → deploy from
   branch `main`, root).
4. Visit `https://<org>.github.io/<repo>/` — that's your live app. You can
   link it from your Control Tower dashboard the same way as your other tools.

## 3. How the pieces fit together

- **New Entry**: fills Staff/Supervisor + Bad Stock Category, then repeatedly
  scans a code, looks it up against the Masterlist tab, and adds it to a
  cart (duplicate scans just add to the existing line's quantity, capped at
  999). Submitting writes one row per item to the current month's tab with a
  shared Txn ID and leaves Material Document / Key in by / Key in date blank.
- **IT Entry**: Pending = rows with no Material Document yet, grouped by Txn
  ID. Selecting one lets IT adjust quantities, remove single items, or delete
  the whole transaction (with a confirm prompt). Filling in Material
  Document + Key in by and hitting Submit stamps all of that transaction's
  rows with the document number, "key in by," and a Key In Date timestamp,
  which moves it to Completed. Completed transactions stay visible for 14
  days after their key-in date, based on the actual date value stored in the
  sheet.
- **Admin**: gated by password `8888` (client-side only, matching what you
  described — it's a soft lock, not real auth). From here you can bulk
  upload a masterlist Excel (only Material, Material Description, Sales
  Unit, Numerator, EAN/UPC are read; Department is applied from the field
  you type), or add/overwrite a single masterlist row by hand.
- **Print**: an open IT Entry transaction now has two buttons:
  - **Print Here** — prints directly from whatever device you're on, the
    same as before (useful when you're already at the printer).
  - **Send to Print Station** — queues the request for someone at the
    Print Station to print or cancel remotely (see below). This is what
    makes phone printing possible.
  New Entry still has no print button.

## 4. Print Station (remote/phone printing)

Since a phone can't push a print job to a specific office computer on its
own, printing works through a queue instead:

1. On the office computer that's connected to the printer, open
   `print-station.html` (same URL pattern as the main app, e.g.
   `https://itshbn-web.github.io/Bad-Stock-Log/print-station.html`) and
   **leave that tab open**.
2. Click **Enable Desktop Notifications** once and allow it — this lets the
   tab pop a system notification when a new print request comes in, even if
   the tab is in the background.
3. When someone (on their phone or anywhere else) opens a completed
   transaction in IT Entry and taps **Print**, a request lands in a new
   `PrintQueue` sheet tab and shows up on the Print Station within a few
   seconds.
4. From the Print Station, click **Print** to open the same print layout
   and send it to whatever printer is set up on that computer, or
   **Cancel** to reject the request without printing. Either way, the
   person who tapped Print sees a confirmation.

**Limitations to know about:**
- This is polling (checks every 5 seconds), not instant push — there's a
  short delay, not a live interrupt.
- The Print Station tab must stay open on that computer. If it's closed or
  the computer is asleep, requests just sit pending until it's reopened.
- Browsers can't reliably tell the difference between "printed" and
  "cancelled from the native print dialog" — once you click Print and the
  dialog closes, the request is marked Printed either way. Use the
  **Cancel** button in the queue list itself if you want to reject a
  request before it ever reaches that dialog.
- `print-station.js` needs the same `WEB_APP_URL` you set in `app.js` —
  update both if you ever redeploy the Apps Script.

## Notes / assumptions I made

- Your spreadsheet columns didn't include a way to group rows into one
  "transaction" before a Material Document exists, so I added a hidden
  **Txn ID** column (P) on each monthly tab — needed for pending grouping,
  edits, and deletes to work reliably.
- "Print format similar to the fourth picture" — the picture that actually
  looks like a print template is the Chicken Processing Form image, so I
  modeled the print layout on that (title/outlet header, staff/supervisor
  line, itemised table, Material Doc/Key in footer, signature lines). Let me
  know if you meant something else and I'll adjust it.
- OUTLET on the print-out is set to `SEGSHBN` to match the sample form —
  change the `OUTLET_NAME` constant at the top of `app.js` if that's wrong
  for this app.
