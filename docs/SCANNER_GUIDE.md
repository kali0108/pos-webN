# Barcode & QR scanning — how it works and how to use it

## The one idea to understand

Every product has an optional **SKU** field. **That field *is* the barcode.** When you scan something, the
system compares the scanned text with the SKUs of your products and picks the match (capital/small letters,
stray spaces, and the 0-in-front difference between a 12-digit UPC-A and a 13-digit EAN-13 are all ignored).
So to make a product scannable, it just needs its barcode stored as its SKU.

Three kinds of products, three ways to get that code in:

| Product | Where the barcode comes from |
|---|---|
| Packaged goods you resell (biscuits, drinks…) | It's printed on the pack — scan it straight into the SKU field. |
| Things you bake / make yourself | No barcode exists. Click **Generate code** on the product, then **Print barcode labels** and stick the label on the box. |
| Anything with a QR code | A QR that contains the product's SKU text works exactly the same. |

Supported codes: EAN-13, EAN-8, UPC-A, UPC-E, Code 128, Code 39 and QR.

## Two ways to scan

### 1. USB or Bluetooth barcode scanner (recommended at the counter)
These scanners behave like a keyboard that types the code very fast and presses Enter. Plug it in (or pair it)
and it just works — **you do not need to click into any box first**: on the Billing, Products and Inventory
pages the system notices a scan arriving and handles it. Typing by hand is never mistaken for a scan (scanners are
far faster than people).

If a scanner doesn't behave: open Notepad and scan — the code should appear followed by a new line. If there's no
new line, set the scanner to "add Enter/CR after scan" (the manual's setup barcode). If letters come out wrong,
the scanner's keyboard-layout setting doesn't match the PC.

### 2. The camera (phone, tablet or laptop webcam) — the 📷 Scan buttons
Works on Android, iPhone, Windows and Mac browsers (Chrome, Edge, Firefox, Safari). It needs:
* the site opened with **https://** (your Vercel / domain address already is), and
* you to press **Allow** when the browser asks for camera permission (if you pressed Block by mistake, click the
  camera/lock icon in the address bar and allow it).

Hold the code steady and reasonably close in good light. If the camera can't be used, every scan window also has
a box to type the code.

## Using it, task by task

**Sell (Billing).** Scan the product — it's added to the bill; scan it again for another one. Or type in the search
box and press **Enter**: an exact SKU, or a single remaining match, is added straight away. Out-of-stock items are
refused with a message. A code that isn't in the catalog says so (and tells you to add it under Products).

**Add a product (Products).**
* Scan an unknown barcode anywhere on the page → press **Add it as a new product** → the code is already in the
  SKU field; fill in the name and price → **Add product**. Scan the next one to add another.
* Or click into **SKU / barcode** and scan, or press **📷 Scan** beside it.
* For your own bakes press **Generate code**, save, then use **Label** (one product) or **Print barcode labels**
  (everything shown) and print on a sticker sheet or label printer (in the print dialog choose margins "None",
  scale 100%).
* The same code can't belong to two products — you'll get a clear message naming the product that already has it
  (it may be a discontinued one: tick *Show discontinued products too*).

**Select / update a product.** Scan its barcode (or type it in *Find / select a product* and press Enter). The
product opens in the form below, and the list narrows to just that product. Change what you need → **Save changes**.

**Delete or discontinue a product.** Scan it as above, then use **Discontinue** (hides it, reversible) or
**Delete** in its row — delete asks for your password and keeps every past bill intact.

**Stock (Inventory).** Scan the product → the list narrows to it and the quantity box is ready → type the amount →
**Enter** (adds) — or press **Remove**.

## What has and hasn't been tested

Checked automatically (`npm test` in the `frontend` folder): that scans from a scanner select, add and find the
right products on all three pages; that a scanner's Enter can't submit a half-filled product form; that slow typing
isn't treated as a scan; duplicate-code protection; and the UPC-A/EAN-13 matching. The barcode *decoder* was also
tested against freshly generated EAN-13, EAN-8, UPC-A, Code 128, Code 39 and QR images — all read correctly.

What no automatic test can do is point a real camera at a real barcode, so the camera window itself needs one
quick check on your own phone or laptop the first time (open Products → 📷 Scan → hold up any barcode).
