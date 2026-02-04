-- CPortal Database Schema for Supabase
-- Run this in the SQL Editor

-- Drop existing tables if they exist (careful in production!)
DROP TABLE IF EXISTS orders;
DROP TABLE IF EXISTS stock_levels;

-- StockLevels tabel
CREATE TABLE stock_levels (
  id SERIAL PRIMARY KEY,
  date DATE NOT NULL,
  incoming_kg INTEGER NOT NULL,
  description TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Orders tabel
CREATE TABLE orders (
  id SERIAL PRIMARY KEY,
  timestamp TIMESTAMPTZ DEFAULT NOW(),
  customer_id INTEGER,
  customer TEXT NOT NULL,
  ordered_by TEXT NOT NULL,
  quantity_kg INTEGER NOT NULL,
  status TEXT DEFAULT 'reserved',
  comment TEXT,
  planned_shipping_date DATE,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Enable Row Level Security
ALTER TABLE stock_levels ENABLE ROW LEVEL SECURITY;
ALTER TABLE orders ENABLE ROW LEVEL SECURITY;

-- Public access policies (anyone can read and write for now)
CREATE POLICY "Allow public read stock_levels" ON stock_levels FOR SELECT USING (true);
CREATE POLICY "Allow public insert stock_levels" ON stock_levels FOR INSERT WITH CHECK (true);
CREATE POLICY "Allow public update stock_levels" ON stock_levels FOR UPDATE USING (true);

CREATE POLICY "Allow public read orders" ON orders FOR SELECT USING (true);
CREATE POLICY "Allow public insert orders" ON orders FOR INSERT WITH CHECK (true);
CREATE POLICY "Allow public update orders" ON orders FOR UPDATE USING (true);

-- Insert your existing stock levels data
INSERT INTO stock_levels (date, incoming_kg, description) VALUES
  ('2026-01-01', 6000, 'Initial stock'),
  ('2026-03-16', 2000, 'First forecast stock update'),
  ('2026-04-16', 4800, 'Additional stock for Impacd'),
  ('2026-06-01', 960, 'Second forecast stock update'),
  ('2026-09-01', 4800, 'Third forecast stock update');

-- Insert your existing orders
INSERT INTO orders (timestamp, customer_id, customer, ordered_by, quantity_kg, status, comment, planned_shipping_date) VALUES
  ('2026-01-21 15:36:43', 1, 'CEAD BV', 'Maarten 4', 480, 'Invoice Sent', 'Wordt gebruikt CEAD internal', '2026-01-28'),
  ('2026-02-02 10:55:17', 1, 'HAVOC AI', 'Hugo', 1920, 'Invoice Sent', 'Havoc is still to pay CEAD.', '2026-02-13'),
  ('2026-02-03 16:35:17', 1, 'CEAD BV', 'Bob', 480, 'Waiting PO', 'We willen graag printmateriaal meenemen naar AM Village.', '2026-02-25'),
  ('2026-02-04 15:04:36', 1, 'Culmar', 'Maarten L', 900, 'Waiting PO', 'Culmar materiaal reservering', '2026-02-08'),
  ('2026-02-04 15:04:36', 1, 'Impacd', 'Maarten 4', 1440, 'Waiting PO', 'in totaal 8 pallets (3840kg)', '2026-02-11'),
  ('2026-02-04 15:08:12', 1, 'Impacd', 'Maarten 4', 4800, 'Waiting PO', 'Vraag is levering in Maart', '2026-03-16'),
  ('2026-02-04 15:08:12', 1, 'Impacd', 'Maarten 4', 6360, 'Waiting PO', 'TBD wanneer we dit kunnen leveren', '2026-05-16');
