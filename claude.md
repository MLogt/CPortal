# CPortal - HDPro Ordering Portal

## Project Overview
A web-based ordering portal for HDPro stock management, connected to Supabase for fast database access.

## Architecture

### Frontend
- **`index.html`** - Single-page application hosted on GitHub Pages
- Vanilla JavaScript, no frameworks
- Communicates directly with Supabase REST API

### Backend
- **Supabase** - PostgreSQL database with REST API
- Tables: `stock_levels`, `orders`
- Row Level Security enabled with public access policies

### Legacy (deprecated)
- **`Code.gs`** - Google Apps Script (no longer used, kept for reference)
- **`index_supabase.html`** - Development version (same as index.html)

## Database Schema

### stock_levels table
| Column | Type | Description |
|--------|------|-------------|
| id | SERIAL | Primary key |
| date | DATE | Date of stock arrival |
| incoming_kg | INTEGER | Amount of stock in kg |
| description | TEXT | Optional description |
| created_at | TIMESTAMPTZ | Auto-generated |

### orders table
| Column | Type | Description |
|--------|------|-------------|
| id | SERIAL | Primary key |
| timestamp | TIMESTAMPTZ | Order creation time |
| customer_id | INTEGER | Customer identifier |
| customer | TEXT | Customer name |
| ordered_by | TEXT | Person who placed order |
| quantity_kg | INTEGER | Order quantity |
| status | TEXT | Order status |
| comment | TEXT | Optional notes |
| planned_shipping_date | DATE | Requested delivery date |
| customer_unit_price | NUMERIC | Price per kg for customer |
| cead_unit_price | NUMERIC | CEAD internal price per kg |
| created_at | TIMESTAMPTZ | Auto-generated |

## Current Features

### Stock Management
- Single StockLevels table for incoming stock deliveries
- Cumulative stock calculation per delivery date
- "X kg beschikbaar voor directe levering" - shows free stock for immediate orders
- Monthly stock chart showing:
  - Blue/Red bars: "Gevraagd schema" (requested schedule, can be negative)
  - Green bars: "Met vertragingen" (with delays, never negative)
- Zero line showing stock depletion point

### Order Fulfillment Logic
- **First-come-first-served**: Orders sorted by planned date
- **Sequential processing**: Each order checks stock availability considering only earlier orders
- For each order, calculates:
  - Stock available at planned date
  - Stock consumed by orders planned before this one
  - If `available >= order quantity` → On time
  - If not → Find first stock delivery date with enough remaining stock

### Order Display
- Color-coded order rows:
  - **Gray**: Shipped/delivered orders
  - **Green**: Orders fulfillable from current stock
  - **Month colors**: Future orders by planned month
- Red left border on delayed orders
- Fulfillment column showing:
  - ✓ On time
  - ⚠ +X days, Earliest: [date]
  - ⚠ No stock

### Order Placement
- Quantity input triggers availability check
- Auto-calculates earliest delivery date
- Date picker defaults to earliest available
- Confirmation modal before submission
- Dual pricing display:
  - Customer price (tiered pricing)
  - CEAD price: `(customer_price - 6.66) / 2 + 6.66`

### Pricing Tiers
| Quantity | Customer Price |
|----------|---------------|
| ≤ 400 kg | €9.90/kg |
| ≤ 1200 kg | €9.50/kg |
| ≤ 5200 kg | €8.80/kg |
| > 5200 kg | €8.30/kg |

## Configuration

### Supabase Connection (`index.html`)
```javascript
const SUPABASE_URL = 'https://vclhlfkekfixctkixsnt.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGci...';
const db = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
```

### App Settings
```javascript
const CONFIG = {
    customerId: 1,
    bagWeight: 20,
    bagsPerPallet: 24,
    leadTimeDays: 5  // Minimum business days before delivery
};
```

### Ntfy.sh Push Notifications (Recommended)

Simple, free push notifications to your phone:

1. **Install ntfy app** on your phone:
   - Android: https://play.google.com/store/apps/details?id=io.heckel.ntfy
   - iOS: https://apps.apple.com/app/ntfy/id1625396347

2. **Choose a secret topic name** (acts like a password):
   - Example: `hdpro-orders-abc123xyz`
   - Make it random/unique so others can't subscribe

3. **Subscribe in the app**:
   - Open ntfy app → Add subscription
   - Enter your topic name

4. **Update configuration** in `index.html`:
   ```javascript
   const NOTIFY_CONFIG = {
       ntfyTopic: 'hdpro-orders-abc123xyz',  // Your secret topic
       ntfyEnabled: true,
       // ...
   };
   ```

5. **Test**: Place an order and you should get a push notification!

### EmailJS Setup (Optional Email Notifications)

1. **Create EmailJS account**: Go to https://www.emailjs.com/ and sign up (free tier: 200 emails/month)

2. **Add Email Service**:
   - Dashboard → Email Services → Add New Service
   - Choose your email provider (Gmail, Outlook, etc.)
   - Follow the connection steps

3. **Create Email Template**:
   - Dashboard → Email Templates → Create New Template
   - Use these template variables:
   ```
   Subject: New HDPro Order - {{customer_name}} - {{quantity_kg}}kg

   New order received!

   Order Details:
   - Order ID: {{order_id}}
   - Customer: {{customer_name}}
   - Ordered by: {{ordered_by}}
   - Quantity: {{quantity_kg}} kg
   - Planned delivery: {{planned_date}}
   - Comment: {{comment}}

   Pricing:
   - Customer: {{customer_price}} (Total: {{customer_total}})
   - CEAD (PO): {{cead_price}} (Total: {{cead_total}})

   Order placed: {{order_date}}
   ```

4. **Update Configuration** in `index.html`:
   ```javascript
   const EMAILJS_CONFIG = {
       publicKey: 'your_public_key',      // Account → API Keys
       serviceId: 'service_xxxxx',        // Email Services → Service ID
       templateId: 'template_xxxxx',      // Email Templates → Template ID
       notifyEmail: 'orders@yourcompany.com'
   };
   ```

## Stock Calculation Logic

### Fulfillment Algorithm
```
function calculateOrderFulfillment(order):
    1. Get all pending orders sorted by planned_date
    2. For orders planned BEFORE this order:
       - Sum their quantities as stockConsumedBefore
    3. stockAtPlanned = cumulative stock up to order's planned date
    4. availableForThisOrder = stockAtPlanned - stockConsumedBefore
    5. If availableForThisOrder >= order.quantity:
       - Return: can fulfill on planned date
    6. Else:
       - Check each future stock delivery date
       - Find first date where available >= order.quantity
       - Return: earliest fulfillment date with delay days
```

### New Order Availability (Period-Based)
```
function findFirstAvailableDate(requestedKg):
    1. Define "stock periods" between stock delivery dates
    2. For each period:
       - periodStock = cumulative stock up to period start
       - ordersInPeriod = orders planned before next stock delivery
       - freeStock = periodStock - ordersInPeriod
       - If freeStock >= requestedKg:
         - Return first valid date in this period
    3. Return: insufficient stock message

Key insight: Orders compete for stock within the same period.
A new order can only be placed if there's free stock in that period.
```

## Deployment

### Frontend (GitHub Pages)
```bash
git add -A && git commit -m "message" && git push
```
Auto-deploys to GitHub Pages.

### Database (Supabase)
- Access via Supabase Dashboard: https://supabase.com/dashboard
- Edit stock_levels and orders tables directly in Table Editor
- SQL Editor available for complex queries

## Files

| File | Purpose |
|------|---------|
| `index.html` | Live production frontend |
| `index_supabase.html` | Development copy |
| `supabase_schema.sql` | Database schema for reference |
| `Code.gs` | Legacy Google Apps Script |
| `claude.md` | This documentation |

## Known Limitations / Future Improvements

1. **No authentication**: Anyone with the URL can place orders
2. **No order editing**: Orders can only be edited via Supabase dashboard
3. **Status changes**: Must be done manually in Supabase
4. **Stock deletions**: Use Supabase dashboard for any deletions

## Troubleshooting

### "duplicate key value violates unique constraint"
Run in Supabase SQL Editor:
```sql
SELECT setval('orders_id_seq', (SELECT MAX(id) FROM orders));
```

### Orders not loading
Check browser console for Supabase connection errors. Verify:
- SUPABASE_URL is correct
- SUPABASE_ANON_KEY is valid
- RLS policies allow public access

---

## Test Protocol

### Test Data Reference (as of Feb 2026)

**Stock Deliveries:**
| Date | Incoming KG | Cumulative |
|------|-------------|------------|
| 2026-01-01 | 6000 | 6000 |
| 2026-03-16 | 2000 | 8000 |
| 2026-04-16 | 4800 | 12800 |
| 2026-06-01 | 960 | 13760 |
| 2026-09-01 | 4800 | 18560 |

**Current Orders (pending):**
| Customer | Quantity | Planned Date | Period |
|----------|----------|--------------|--------|
| CEAD BV | 480 | 2026-01-28 | Period 1 |
| HAVOC AI | 1920 | 2026-02-13 | Period 1 |
| CEAD BV | 480 | 2026-02-25 | Period 1 |
| Culmar | 900 | 2026-02-08 | Period 1 |
| Impacd | 1440 | 2026-02-11 | Period 1 |
| Impacd | 4800 | 2026-03-16 | Period 2 |
| Impacd | 6360 | 2026-05-16 | Period 3 |

**Actual Fulfillment Schedule (accounting for delays):**
- Orders 1-5 (5220kg): Fulfilled in Feb from 6000kg stock → 780kg remaining
- Impacd 4800kg (planned Mar 16): Delayed to **Apr 16** (needs April stock)
- Impacd 6360kg (planned May 16): Delayed to **Sep 1** (needs September stock)

**Available for new orders at each date:**
- **Feb (immediate)**: 6000 - 5220 = **780kg** free
- **Mar 16**: 8000 - 5220 = **2780kg** free (Impacd 4800 not fulfilled yet)
- **Apr 16**: 12800 - 5220 - 4800 = **2780kg** free (after Impacd 4800 fulfilled)
- **Sep 1**: 18560 - 5220 - 4800 - 6360 = **2180kg** free

### Test Cases for New Order Placement

| Test # | Quantity | Expected Earliest Date | Reason |
|--------|----------|------------------------|--------|
| T1 | 500 kg | ~Feb 11-12 (immediate) | Fits in immediate free stock (780kg) |
| T2 | 780 kg | ~Feb 11-12 (immediate) | Exactly matches immediate free stock |
| T3 | 800 kg | Mar 16, 2026 | Fits in March free stock (2780kg) without delaying Impacd |
| T4 | 1000 kg | Mar 16, 2026 | Fits in March free stock (2780kg) without delaying Impacd |
| T5 | 2780 kg | Mar 16, 2026 | Exactly matches March free stock |
| T6 | 2800 kg | Sep 1, 2026 | Exceeds March, must wait for September |
| T7 | 2180 kg | Mar 16 or Sep 1 | Fits in March (2780kg available) |
| T8 | 5000 kg | No stock | Exceeds all available free stock (max 2780kg) |

### Test Cases for Existing Order Fulfillment

Orders are processed first-come-first-served by planned date:

| # | Order | Quantity | Planned | Expected Status | Cumulative |
|---|-------|----------|---------|-----------------|------------|
| 1 | CEAD BV | 480 kg | Jan 28 | ✓ On time | 480kg used |
| 2 | Culmar | 900 kg | Feb 8 | ✓ On time | 1380kg used |
| 3 | Impacd | 1440 kg | Feb 11 | ✓ On time | 2820kg used |
| 4 | HAVOC AI | 1920 kg | Feb 13 | ✓ On time | 4740kg used |
| 5 | CEAD BV | 480 kg | Feb 25 | ✓ On time | 5220kg used, 780kg left |
| 6 | Impacd | 4800 kg | Mar 16 | ⚠ Delayed to Apr 16 | Needs 12800kg stock |
| 7 | Impacd | 6360 kg | May 16 | ⚠ Delayed to Sep 1 | Needs 18560kg stock |

### Manual Test Procedure

1. **Open development site**: `index_supabase.html`
2. **Verify dashboard shows**: "780 kg beschikbaar voor directe levering"
3. **Test T1**: Enter 500kg → Should show "Earliest delivery: ~Feb 11-12"
4. **Test T3**: Enter 800kg → Should show "Earliest delivery: Sep 1, 2026"
5. **Test T7**: Enter 2200kg → Should show "Insufficient stock"
6. **Verify order table**: Check fulfillment column matches expected statuses

### Automated Console Test

Run in browser console after page loads:
```javascript
// Test the findFirstAvailableDate function
const tests = [
    { qty: 500, expectImmediate: true, desc: 'Fits in 780kg free' },
    { qty: 780, expectImmediate: true, desc: 'Exactly 780kg free' },
    { qty: 800, expectImmediate: false, expectMonth: '03', desc: 'March (2780kg free)' },
    { qty: 1000, expectImmediate: false, expectMonth: '03', desc: 'March (2780kg free)' },
    { qty: 2780, expectImmediate: false, expectMonth: '03', desc: 'Exactly March free stock' },
    { qty: 2800, expectImmediate: false, expectMonth: '09', desc: 'Must wait for Sep' },
    { qty: 5000, expectImmediate: false, expectMonth: null, desc: 'No stock available' }
];

console.log('=== New Order Availability Tests ===');
tests.forEach((t, i) => {
    const result = findFirstAvailableDate(t.qty);
    const isImmediate = result.date && new Date(result.date) < new Date('2026-03-01');
    let passed;
    if (t.expectImmediate) {
        passed = isImmediate;
    } else if (t.expectMonth === null) {
        passed = result.date === null;
    } else {
        passed = result.date && result.date.substring(5, 7) === t.expectMonth;
    }
    console.log(`T${i+1} (${t.qty}kg): ${passed ? '✓ PASS' : '✗ FAIL'} - ${t.desc}`, result);
});
```
