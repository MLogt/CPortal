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

  return {
    success: true,
    stock_timeline: stockTimeline,
    orders: orders
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

  // Build cumulative stock map by date
  const stockByDate = buildCumulativeStockMap(stockTimeline, orders);

  // Find minimum date (today + 5 business days)
  const minDate = getMinimumOrderDate();

  // Get all dates from the stock map, sorted
  const allDates = Object.keys(stockByDate).sort();

  // Also generate dates from minDate forward (in case stock is available before any timeline entry)
  const checkDates = generateDateRange(minDate, 365); // Check up to 1 year ahead

  // Merge and deduplicate dates
  const datesToCheck = [...new Set([...allDates, ...checkDates])].sort();

  for (const dateStr of datesToCheck) {
    const checkDate = new Date(dateStr);

    // Must be >= minimum date
    if (checkDate < minDate) continue;

    // Must be a weekday
    const dayOfWeek = checkDate.getDay();
    if (dayOfWeek === 0 || dayOfWeek === 6) continue;

    // Calculate available stock on this date
    const availableKg = calculateAvailableOnDate(dateStr, stockTimeline, orders);

    if (availableKg >= requestedKg) {
      return {
        date: dateStr,
        available_kg: availableKg,
        message: null
      };
    }
  }

  // No date found with sufficient stock
  const maxAvailable = getMaxAvailableStock(stockTimeline, orders);
  return {
    date: null,
    available_kg: maxAvailable,
    message: `Insufficient stock. Maximum available: ${maxAvailable}kg`
  };
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
