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

### New Order Availability
```
function findFirstAvailableDate(requestedKg):
    1. totalCommitted = sum of all pending order quantities
    2. For each stock delivery date (sorted):
       - cumulativeStock += delivery amount
       - available = cumulativeStock - totalCommitted
       - If available >= requestedKg:
         - Return this date (adjusted for weekday + lead time)
    3. Return: insufficient stock message
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
