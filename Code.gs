/**
 * CPortal Stock & Ordering System
 * Google Apps Script Backend
 *
 * Sheet structure:
 * - StockLevels: Date | Incoming KG | Description
 * - Orders: Timestamp | Customer ID | Ordered By | Customer | Quantity KG | Status | Planned Shipping Date | Comment
 */

const CONFIG = {
  STOCK_LEVELS_SHEET: "StockLevels",
  ORDERS_SHEET: "Orders",
  LEAD_TIME_DAYS: 5
};

// ============================================
// HTTP Handlers
// ============================================

function doGet(e) {
  const action = e.parameter.action || "dashboard";

  try {
    switch (action) {
      case "dashboard":
        return jsonResponse(getDashboard());
      case "check_availability":
        const qty = Number(e.parameter.quantity_kg);
        if (!qty || qty <= 0) {
          return jsonResponse({ success: false, error: "Invalid quantity" });
        }
        return jsonResponse(checkAvailability(qty));
      default:
        return jsonResponse({ success: false, error: "Unknown action" });
    }
  } catch (err) {
    return jsonResponse({ success: false, error: err.message });
  }
}

function doPost(e) {
  try {
    const payload = JSON.parse(e.parameter.payload);
    return jsonResponse(createOrder(payload));
  } catch (err) {
    return jsonResponse({ success: false, error: err.message });
  }
}

function jsonResponse(data) {
  return ContentService
    .createTextOutput(JSON.stringify(data))
    .setMimeType(ContentService.MimeType.JSON);
}

// ============================================
// Dashboard
// ============================================

function getDashboard() {
  const stockTimeline = getStockTimeline();
  const orders = getOrders();

  // Calculate fulfillment info for each order
  const ordersWithFulfillment = orders.map(order => {
    const fulfillment = calculateOrderFulfillment(order, stockTimeline, orders);
    return {
      ...order,
      can_fulfill_on_planned: fulfillment.canFulfillOnPlanned,
      earliest_fulfillment_date: fulfillment.earliestDate,
      delay_days: fulfillment.delayDays
    };
  });

  return {
    success: true,
    stock_timeline: stockTimeline,
    orders: ordersWithFulfillment
  };
}

// Calculate when an order can actually be fulfilled
function calculateOrderFulfillment(order, stockTimeline, allOrders) {
  const status = order.status.toLowerCase();

  // Already completed orders - no fulfillment calculation needed
  if (status === 'shipped' || status === 'delivered' || status === 'cancelled' || status === 'invoice sent') {
    return {
      canFulfillOnPlanned: true,
      earliestDate: order.planned_shipping_date,
      delayDays: 0
    };
  }

  if (!order.planned_shipping_date) {
    return {
      canFulfillOnPlanned: false,
      earliestDate: null,
      delayDays: null
    };
  }

  const plannedDate = new Date(order.planned_shipping_date);
  const stockPeriods = buildStockPeriods(stockTimeline, allOrders);

  // Find which period the planned date falls into
  let orderPeriod = null;

  for (const period of stockPeriods) {
    const periodStart = new Date(period.startDate);
    const periodEnd = period.endDate ? new Date(period.endDate) : null;

    // Check if planned date is in this period
    if (plannedDate >= periodStart && (!periodEnd || plannedDate < periodEnd)) {
      orderPeriod = period;
      break;
    }
  }

  // If period has freeStock >= 0, all orders in that period (including this one) can be fulfilled
  if (orderPeriod && orderPeriod.freeStock >= 0) {
    return {
      canFulfillOnPlanned: true,
      earliestDate: order.planned_shipping_date,
      delayDays: 0
    };
  }

  // Period has negative free stock - find earliest period where we could move this order
  // We need to find a period where adding this order still leaves freeStock >= 0
  // That means: period.freeStock + period.committedOrders >= period.committedOrders - order.quantity_kg + order.quantity_kg
  // Simplified: we need period.freeStock >= 0 already, OR we need a period with enough buffer

  for (const period of stockPeriods) {
    // Can this order fit in this period?
    // The period already has its own committed orders. If we ADD this order to this period:
    // newFreeStock = period.stockPool - period.committedOrders - order.quantity_kg (if order wasn't already counted)
    // But the order IS already counted in its original period, not in other periods
    // So for other periods, we check: period.freeStock >= order.quantity_kg

    if (period.freeStock >= order.quantity_kg) {
      const periodStart = new Date(period.startDate);

      // Find first weekday in this period that's after the planned date (or period start)
      let earliestDate = new Date(Math.max(periodStart, plannedDate));

      // Move to first weekday
      while (earliestDate.getDay() === 0 || earliestDate.getDay() === 6) {
        earliestDate.setDate(earliestDate.getDate() + 1);
      }

      const delayDays = Math.ceil((earliestDate - plannedDate) / (1000 * 60 * 60 * 24));

      return {
        canFulfillOnPlanned: false,
        earliestDate: Utilities.formatDate(earliestDate, Session.getScriptTimeZone(), "yyyy-MM-dd"),
        delayDays: delayDays > 0 ? delayDays : 0
      };
    }
  }

  // Cannot fulfill at all with current stock projections
  return {
    canFulfillOnPlanned: false,
    earliestDate: null,
    delayDays: null
  };
}

// ============================================
// Stock Timeline
// ============================================

function getStockTimeline() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName(CONFIG.STOCK_LEVELS_SHEET);

  if (!sheet) return [];

  const data = sheet.getDataRange().getValues();
  const timeline = [];

  // Skip header row
  for (let i = 1; i < data.length; i++) {
    const row = data[i];
    if (!row[0]) continue;

    const date = row[0] instanceof Date ?
      Utilities.formatDate(row[0], Session.getScriptTimeZone(), "yyyy-MM-dd") :
      String(row[0]);

    timeline.push({
      date: date,
      incoming_kg: Number(row[1]) || 0,
      description: row[2] || ""
    });
  }

  // Sort by date ascending
  timeline.sort((a, b) => new Date(a.date) - new Date(b.date));

  return timeline;
}

// ============================================
// Orders
// ============================================

function getOrders() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName(CONFIG.ORDERS_SHEET);

  if (!sheet) return [];

  const data = sheet.getDataRange().getValues();
  const headers = data[0];
  const orders = [];

  // Find column indices from headers
  const colIndex = {};
  headers.forEach((header, idx) => {
    const h = String(header).toLowerCase().trim();
    if (h === 'id') colIndex.id = idx;
    if (h === 'timestamp') colIndex.timestamp = idx;
    if (h === 'customer_id') colIndex.customer_id = idx;
    if (h === 'customer') colIndex.customer = idx;
    if (h === 'ordered_by') colIndex.ordered_by = idx;
    if (h === 'quantity_kg') colIndex.quantity_kg = idx;
    if (h === 'status') colIndex.status = idx;
    if (h === 'comment') colIndex.comment = idx;
    if (h === 'planned_shipping_date') colIndex.planned_shipping_date = idx;
  });

  // Skip header row
  for (let i = 1; i < data.length; i++) {
    const row = data[i];
    if (!row[colIndex.id] && !row[colIndex.timestamp]) continue;

    const timestampVal = row[colIndex.timestamp];
    const timestamp = timestampVal instanceof Date ?
      Utilities.formatDate(timestampVal, Session.getScriptTimeZone(), "yyyy-MM-dd HH:mm:ss") :
      String(timestampVal || "");

    const plannedDate = parseDate(row[colIndex.planned_shipping_date]);

    orders.push({
      timestamp: timestamp,
      customer_id: row[colIndex.customer_id] || "",
      ordered_by: row[colIndex.ordered_by] || "",
      customer: row[colIndex.customer] || "",
      quantity_kg: Number(row[colIndex.quantity_kg]) || 0,
      status: String(row[colIndex.status] || "reserved").toLowerCase(),
      planned_shipping_date: plannedDate,
      comment: row[colIndex.comment] || ""
    });
  }

  // Sort by timestamp descending (most recent first)
  orders.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));

  return orders;
}

// ============================================
// Availability Calculation
// ============================================

function checkAvailability(requestedKg) {
  const result = findFirstAvailableDate(requestedKg);
  return {
    success: true,
    requested_kg: requestedKg,
    first_available_date: result.date,
    available_kg_on_date: result.available_kg,
    message: result.message
  };
}

function findFirstAvailableDate(requestedKg) {
  const stockTimeline = getStockTimeline();
  const orders = getOrders();

  // Find minimum date (today + 5 business days)
  const minDate = getMinimumOrderDate();

  // Build stock periods: each period starts at an incoming date and has a stock pool
  const stockPeriods = buildStockPeriods(stockTimeline, orders);

  // Check each period to find where the new order fits
  for (const period of stockPeriods) {
    // Skip periods that end before minDate
    if (period.endDate && new Date(period.endDate) < minDate) continue;

    // Calculate free stock in this period (pool - committed orders)
    const freeStock = period.stockPool - period.committedOrders;

    if (freeStock >= requestedKg) {
      // Find first valid delivery date in this period
      const startDate = new Date(Math.max(new Date(period.startDate), minDate));
      const endDate = period.endDate ? new Date(period.endDate) : new Date(startDate.getTime() + 365 * 24 * 60 * 60 * 1000);

      // Find first weekday >= startDate
      let deliveryDate = new Date(startDate);
      while (deliveryDate <= endDate) {
        const dayOfWeek = deliveryDate.getDay();
        if (dayOfWeek !== 0 && dayOfWeek !== 6) {
          // Also must be >= minDate
          if (deliveryDate >= minDate) {
            return {
              date: Utilities.formatDate(deliveryDate, Session.getScriptTimeZone(), "yyyy-MM-dd"),
              available_kg: freeStock,
              message: null
            };
          }
        }
        deliveryDate.setDate(deliveryDate.getDate() + 1);
      }
    }
  }

  // No date found with sufficient stock
  const maxFree = getMaxFreeStock(stockPeriods);
  return {
    date: null,
    available_kg: maxFree,
    message: `Insufficient stock. Maximum available for new orders: ${maxFree}kg`
  };
}

// Build stock periods: each period has a cumulative stock pool and cumulative committed orders
function buildStockPeriods(stockTimeline, orders) {
  const periods = [];

  // Sort timeline by date
  const sortedTimeline = [...stockTimeline].sort((a, b) => new Date(a.date) - new Date(b.date));

  for (let i = 0; i < sortedTimeline.length; i++) {
    const entry = sortedTimeline[i];
    const nextEntry = sortedTimeline[i + 1];

    const periodStart = entry.date;
    const periodEnd = nextEntry ? nextEntry.date : null;

    // Calculate cumulative stock up to and including this entry
    let stockPool = 0;
    for (let j = 0; j <= i; j++) {
      stockPool += sortedTimeline[j].incoming_kg;
    }

    // Calculate cumulative committed orders up to the END of this period
    // An order consumes from the stock pool if its planned date is before the next incoming
    let committedOrders = 0;
    orders.forEach(order => {
      const status = order.status.toLowerCase();
      if (status === 'shipped' || status === 'delivered' || status === 'cancelled') return;

      if (order.planned_shipping_date) {
        const plannedDate = new Date(order.planned_shipping_date);
        const periodEndDate = periodEnd ? new Date(periodEnd) : null;

        // Order consumes from this pool if planned before next incoming (or no next incoming)
        if (!periodEndDate || plannedDate < periodEndDate) {
          committedOrders += order.quantity_kg;
        }
      }
    });

    periods.push({
      startDate: periodStart,
      endDate: periodEnd,
      stockPool: stockPool,
      committedOrders: committedOrders,
      freeStock: stockPool - committedOrders
    });
  }

  return periods;
}

function getMaxFreeStock(stockPeriods) {
  let maxFree = 0;
  stockPeriods.forEach(period => {
    const free = period.stockPool - period.committedOrders;
    if (free > maxFree) maxFree = free;
  });
  return maxFree;
}

function buildCumulativeStockMap(stockTimeline, orders) {
  const stockByDate = {};

  // Add stock timeline entries
  stockTimeline.forEach(entry => {
    if (!stockByDate[entry.date]) {
      stockByDate[entry.date] = 0;
    }
    stockByDate[entry.date] += entry.incoming_kg;
  });

  // Add order dates (to ensure we check those dates)
  orders.forEach(order => {
    if (order.planned_shipping_date &&
        order.status !== 'shipped' &&
        order.status !== 'cancelled') {
      if (!stockByDate[order.planned_shipping_date]) {
        stockByDate[order.planned_shipping_date] = 0;
      }
    }
  });

  return stockByDate;
}

function calculateAvailableOnDate(targetDateStr, stockTimeline, orders) {
  const targetDate = new Date(targetDateStr);
  let available = 0;

  // Add all incoming stock up to and including target date
  stockTimeline.forEach(entry => {
    if (new Date(entry.date) <= targetDate) {
      available += entry.incoming_kg;
    }
  });

  // Subtract all pending orders up to and including target date
  orders.forEach(order => {
    if (order.status !== 'shipped' && order.status !== 'cancelled') {
      if (order.planned_shipping_date && new Date(order.planned_shipping_date) <= targetDate) {
        available -= order.quantity_kg;
      }
    }
  });

  return available;
}

function getMaxAvailableStock(stockTimeline, orders) {
  // Calculate total incoming stock
  let totalStock = 0;
  stockTimeline.forEach(entry => {
    totalStock += entry.incoming_kg;
  });

  // Subtract all pending orders
  let pendingOrders = 0;
  orders.forEach(order => {
    if (order.status !== 'shipped' && order.status !== 'cancelled') {
      pendingOrders += order.quantity_kg;
    }
  });

  return totalStock - pendingOrders;
}

function getMinimumOrderDate() {
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  let date = new Date(today);
  let businessDays = 0;

  while (businessDays < CONFIG.LEAD_TIME_DAYS) {
    date.setDate(date.getDate() + 1);
    const dayOfWeek = date.getDay();
    if (dayOfWeek !== 0 && dayOfWeek !== 6) {
      businessDays++;
    }
  }

  return date;
}

function generateDateRange(startDate, days) {
  const dates = [];
  const current = new Date(startDate);

  for (let i = 0; i < days; i++) {
    const dateStr = Utilities.formatDate(current, Session.getScriptTimeZone(), "yyyy-MM-dd");
    dates.push(dateStr);
    current.setDate(current.getDate() + 1);
  }

  return dates;
}

// Parse date from various formats (Date object, DD-MM-YYYY string, etc.)
function parseDate(value) {
  if (!value) return null;

  // If it's already a Date object
  if (value instanceof Date) {
    return Utilities.formatDate(value, Session.getScriptTimeZone(), "yyyy-MM-dd");
  }

  const str = String(value).trim();
  if (!str) return null;

  // Try DD-MM-YYYY or D-M-YYYY format
  const ddmmyyyy = str.match(/^(\d{1,2})-(\d{1,2})-(\d{4})$/);
  if (ddmmyyyy) {
    const day = ddmmyyyy[1].padStart(2, '0');
    const month = ddmmyyyy[2].padStart(2, '0');
    const year = ddmmyyyy[3];
    return `${year}-${month}-${day}`;
  }

  // Try YYYY-MM-DD format (already correct)
  const yyyymmdd = str.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (yyyymmdd) {
    return str;
  }

  // Fallback: try to parse as date
  const parsed = new Date(str);
  if (!isNaN(parsed.getTime())) {
    return Utilities.formatDate(parsed, Session.getScriptTimeZone(), "yyyy-MM-dd");
  }

  return null;
}

// ============================================
// Order Creation
// ============================================

function createOrder(payload) {
  // Validate required fields
  const required = ['customer_id', 'ordered_by', 'customer_name', 'quantity_kg'];
  for (const field of required) {
    if (!payload[field]) {
      return { success: false, error: `Missing required field: ${field}` };
    }
  }

  const quantityKg = Number(payload.quantity_kg);

  // Validate quantity is multiple of 20
  if (quantityKg % 20 !== 0) {
    return { success: false, error: "Quantity must be a multiple of 20kg" };
  }

  // Determine shipping date
  let shippingDate = payload.planned_shipping_date;

  if (!shippingDate) {
    // Auto-assign earliest available date
    const availability = findFirstAvailableDate(quantityKg);
    if (!availability.date) {
      return { success: false, error: availability.message };
    }
    shippingDate = availability.date;
  } else {
    // Validate against calculated availability
    const stockTimeline = getStockTimeline();
    const orders = getOrders();
    const availableOnDate = calculateAvailableOnDate(shippingDate, stockTimeline, orders);

    if (availableOnDate < quantityKg) {
      return {
        success: false,
        error: `Insufficient stock on ${shippingDate}. Available: ${availableOnDate}kg, Requested: ${quantityKg}kg`
      };
    }

    // Validate date is not before minimum
    const minDate = getMinimumOrderDate();
    const selectedDate = new Date(shippingDate);
    if (selectedDate < minDate) {
      const minDateStr = Utilities.formatDate(minDate, Session.getScriptTimeZone(), "yyyy-MM-dd");
      return { success: false, error: `Shipping date must be ${minDateStr} or later` };
    }

    // Validate date is a weekday
    const dayOfWeek = selectedDate.getDay();
    if (dayOfWeek === 0 || dayOfWeek === 6) {
      return { success: false, error: "Shipping date must be a weekday" };
    }
  }

  // Create the order
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sheet = ss.getSheetByName(CONFIG.ORDERS_SHEET);

  if (!sheet) {
    sheet = ss.insertSheet(CONFIG.ORDERS_SHEET);
    sheet.appendRow(['Timestamp', 'Customer ID', 'Ordered By', 'Customer', 'Quantity KG', 'Status', 'Planned Shipping Date', 'Comment']);
  }

  const timestamp = new Date();
  const newRow = [
    timestamp,
    payload.customer_id,
    payload.ordered_by,
    payload.customer_name,
    quantityKg,
    'Reserved',
    shippingDate,
    payload.comment || ''
  ];

  sheet.appendRow(newRow);

  return {
    success: true,
    message: "Order created successfully",
    order: {
      timestamp: Utilities.formatDate(timestamp, Session.getScriptTimeZone(), "yyyy-MM-dd HH:mm:ss"),
      quantity_kg: quantityKg,
      planned_shipping_date: shippingDate,
      status: 'Reserved'
    }
  };
}

// ============================================
// Test Functions (for development)
// ============================================

function testCheckAvailability() {
  const result = findFirstAvailableDate(500);
  Logger.log(JSON.stringify(result, null, 2));
}

function testDashboard() {
  const result = getDashboard();
  Logger.log(JSON.stringify(result, null, 2));
}
