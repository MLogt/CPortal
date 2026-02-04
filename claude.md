# CPortal - HDPro Ordering Portal

## Project Overview
A web-based ordering portal for HDPro stock management, connected to Google Sheets via Google Apps Script.

## Architecture

### Frontend
- **`index.html`** - Single-page application hosted on GitHub Pages
- Vanilla JavaScript, no frameworks
- Communicates with Google Apps Script API

### Backend
- **`Code.gs`** - Google Apps Script (paste into Google Sheets > Extensions > Apps Script)
- Deployed as web app

### Google Sheets Structure
1. **StockLevels** sheet:
   | Date | Incoming KG | Description |
   |------|-------------|-------------|
   | 01-01-2026 | 6000 | Initial stock |
   | 16-03-2026 | 2000 | Batch delivery |

2. **Orders** sheet (existing structure with headers):
   - id, timestamp, customer_id, customer, ordered_by, quantity_kg, status, comment, planned_shipping_date, etc.

## Current Features

### Stock Management
- [x] Single StockLevels sheet (replaces old Inventory + Inbound)
- [x] Cumulative stock calculation per period
- [x] "X kg beschikbaar voor directe levering" - shows free stock after all pending orders
- [x] Monthly forecast chips showing stock per month
- [x] Negative stock shown in red with warning

### Order Display
- [x] Color-coded order rows:
  - **Gray**: Shipped/delivered orders
  - **Green**: Orders fulfillable from current stock (before next incoming)
  - **Month colors**: Future orders by planned month
- [x] Red left border on delayed orders
- [x] Fulfillment column showing:
  - ✓ On time
  - ⚠ +X days, Earliest: [date]
  - ⚠ No stock

### Order Placement
- [x] Quantity input triggers availability check
- [x] Auto-calculates earliest delivery date
- [x] Date picker defaults to earliest available
- [x] Confirmation modal before submission
- [x] Validates stock availability on selected date

## API Endpoints

### GET
- `?action=dashboard` - Returns stock_timeline + orders with fulfillment info
- `?action=check_availability&quantity_kg=X` - Returns first available date for X kg

### POST
- Creates new order with validation

## Current Status

### Working
- Stock period calculation (cumulative stock pools)
- Availability check for new orders
- Order fulfillment calculation per line
- Color coding based on fulfillment status
- Monthly stock forecast display

### Known Issues / TODO

1. **Fulfillment calculation edge case**:
   - Currently checks if `freeStock >= 0` for the period
   - Need to verify this works correctly for all scenarios

2. **Update Apps Script**:
   - User needs to copy latest Code.gs to Google Apps Script
   - Deploy new version after each backend change

3. **Potential improvements**:
   - [ ] Add "cancelled" to stock calculation exclusions (currently only shipped/delivered)
   - [ ] Show which orders are blocking stock (causing delays)
   - [ ] Allow partial order fulfillment suggestions
   - [ ] Email notifications for stock warnings

## Deployment

### Frontend (GitHub Pages)
```bash
git add -A && git commit -m "message" && git push
```
Auto-deploys to GitHub Pages.

### Backend (Google Apps Script)
1. Open Google Sheet > Extensions > Apps Script
2. Replace all code with contents of `Code.gs`
3. Save (Ctrl+S)
4. Deploy > Manage deployments > Edit (pencil) > New version > Deploy

## Configuration

### Frontend (`index.html`)
```javascript
const CONFIG = {
    apiBase: "https://script.google.com/macros/s/YOUR_DEPLOYMENT_ID/exec",
    customerId: 1,
    leadTimeDays: 5
};
```

### Backend (`Code.gs`)
```javascript
const CONFIG = {
  STOCK_LEVELS_SHEET: "StockLevels",
  ORDERS_SHEET: "Orders",
  LEAD_TIME_DAYS: 5
};
```

## Stock Calculation Logic

### Period-based Stock Pools
Each incoming delivery creates a new "period":
- Period 1: Initial stock until next delivery
- Period 2: Initial + delivery 1 until next delivery
- etc.

### Free Stock Calculation
```
freeStock = stockPool - committedOrders
```
Where committedOrders = all pending orders (not shipped/delivered) with planned_date before next incoming.

### Order Fulfillment Check
1. Find which period the order's planned date falls into
2. If `period.freeStock >= 0` → Order can be fulfilled on time
3. If `period.freeStock < 0` → Find first period where `freeStock >= 0` → That's the earliest delivery date
