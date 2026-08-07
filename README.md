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

1. In `app.js`, replace the placeholder with your real URL:
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
- **Print**: available from both New Entry (before submission — Material
  Doc / Key in by / Key in date print blank) and from an open IT Entry
  transaction (prints whatever is currently on the sheet, including the
  Material Document/Key in info once completed). The layout follows the
  processing-form reference you sent — title, outlet, date/staff/supervisor
  line, an itemised table, and a footer with Material Doc / Key in by / Date
  plus signature lines.

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
