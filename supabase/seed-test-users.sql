-- Seed 3 test agent users with realistic historical activity data
-- Password for all: Watt-TEST (bcrypt hash of 'Watt-TEST')
-- $2b$10$8KzaNdKwMx9MhE3R5y1OauVnGXOQr8oE6v4Q3vZbYsJlWp9yFxmQe

-- Agent 1: Carlos Rivera — consistently meets goals (high performer)
INSERT INTO users (id, username, password_hash, name, email, role, manager_id, must_change_password, is_active, hire_date)
VALUES (
  'a1000000-0000-0000-0000-000000000001',
  'crivera',
  '$2b$10$8KzaNdKwMx9MhE3R5y1OauVnGXOQr8oE6v4Q3vZbYsJlWp9yFxmQe',
  'Carlos Rivera',
  NULL,
  'agent',
  NULL,
  false,
  true,
  '2025-06-15'
) ON CONFLICT (username) DO NOTHING;

-- Agent 2: Ana Martínez — sometimes meets goals (average performer)
INSERT INTO users (id, username, password_hash, name, email, role, manager_id, must_change_password, is_active, hire_date)
VALUES (
  'a2000000-0000-0000-0000-000000000002',
  'amartinez',
  '$2b$10$8KzaNdKwMx9MhE3R5y1OauVnGXOQr8oE6v4Q3vZbYsJlWp9yFxmQe',
  'Ana Martínez',
  NULL,
  'agent',
  NULL,
  false,
  true,
  '2025-09-01'
) ON CONFLICT (username) DO NOTHING;

-- Agent 3: Pedro Sánchez — does not meet goals (low performer)
INSERT INTO users (id, username, password_hash, name, email, role, manager_id, must_change_password, is_active, hire_date)
VALUES (
  'a3000000-0000-0000-0000-000000000003',
  'psanchez',
  '$2b$10$8KzaNdKwMx9MhE3R5y1OauVnGXOQr8oE6v4Q3vZbYsJlWp9yFxmQe',
  'Pedro Sánchez',
  NULL,
  'agent',
  NULL,
  false,
  true,
  '2025-11-10'
) ON CONFLICT (username) DO NOTHING;

-- Generate 30 days of activity for each agent
-- Agent 1 (Carlos): D2D, high numbers, ~30% conversion
DO $$
DECLARE
  d DATE;
  i INT := 0;
BEGIN
  FOR d IN SELECT generate_series(CURRENT_DATE - INTERVAL '30 days', CURRENT_DATE - INTERVAL '1 day', '1 day')::DATE LOOP
    -- Skip weekends
    IF EXTRACT(DOW FROM d) IN (0, 6) THEN CONTINUE; END IF;
    INSERT INTO activity_entries (agent_id, date, campaign_type, knocks, contacts, bills, sales, stops, zipcodes, credit_checks, zip_code, first_activity_at, last_activity_at)
    VALUES (
      'a1000000-0000-0000-0000-000000000001',
      d, 'D2D',
      80 + (random() * 40)::INT,   -- knocks: 80-120
      25 + (random() * 15)::INT,   -- contacts: 25-40
      5 + (random() * 10)::INT,    -- bills: 5-15
      6 + (random() * 6)::INT,     -- sales: 6-12 (~30% of contacts)
      0, 0, 0,
      '7' || (5000 + (random() * 5000)::INT)::TEXT,
      d + TIME '08:30:00',
      d + TIME '17:30:00'
    ) ON CONFLICT (agent_id, date) DO NOTHING;
    i := i + 1;
  END LOOP;
END $$;

-- Agent 2 (Ana): Retail, medium numbers, ~18% conversion
DO $$
DECLARE
  d DATE;
BEGIN
  FOR d IN SELECT generate_series(CURRENT_DATE - INTERVAL '30 days', CURRENT_DATE - INTERVAL '1 day', '1 day')::DATE LOOP
    IF EXTRACT(DOW FROM d) IN (0, 6) THEN CONTINUE; END IF;
    INSERT INTO activity_entries (agent_id, date, campaign_type, knocks, contacts, bills, sales, stops, zipcodes, credit_checks, store_chain, store_address, first_activity_at, last_activity_at)
    VALUES (
      'a2000000-0000-0000-0000-000000000002',
      d, 'Retail',
      0, 0, 0,
      2 + (random() * 4)::INT,     -- sales: 2-6 (~18% of zipcodes)
      60 + (random() * 30)::INT,   -- stops: 60-90
      18 + (random() * 12)::INT,   -- zipcodes: 18-30
      8 + (random() * 8)::INT,     -- credit_checks: 8-16
      (ARRAY['Walmart','HEB','Sam''s Club','Fiesta Mart'])[1 + (random() * 3)::INT],
      '123 Main St',
      d + TIME '09:00:00',
      d + TIME '18:00:00'
    ) ON CONFLICT (agent_id, date) DO NOTHING;
  END LOOP;
END $$;

-- Agent 3 (Pedro): D2D, low numbers, ~8% conversion
DO $$
DECLARE
  d DATE;
BEGIN
  FOR d IN SELECT generate_series(CURRENT_DATE - INTERVAL '30 days', CURRENT_DATE - INTERVAL '1 day', '1 day')::DATE LOOP
    IF EXTRACT(DOW FROM d) IN (0, 6) THEN CONTINUE; END IF;
    -- Skip some days randomly (inconsistent attendance)
    IF random() < 0.2 THEN CONTINUE; END IF;
    INSERT INTO activity_entries (agent_id, date, campaign_type, knocks, contacts, bills, sales, stops, zipcodes, credit_checks, zip_code, first_activity_at, last_activity_at)
    VALUES (
      'a3000000-0000-0000-0000-000000000003',
      d, 'D2D',
      30 + (random() * 30)::INT,   -- knocks: 30-60
      8 + (random() * 10)::INT,    -- contacts: 8-18
      2 + (random() * 5)::INT,     -- bills: 2-7
      0 + (random() * 3)::INT,     -- sales: 0-3 (~8% of contacts)
      0, 0, 0,
      '7' || (5000 + (random() * 5000)::INT)::TEXT,
      d + TIME '10:00:00',
      d + TIME '15:30:00'
    ) ON CONFLICT (agent_id, date) DO NOTHING;
  END LOOP;
END $$;
