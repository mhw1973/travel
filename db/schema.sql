PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS trips (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  destination TEXT NOT NULL,
  start_date TEXT NOT NULL,
  end_date TEXT NOT NULL,
  currency TEXT NOT NULL DEFAULT 'JPY',
  memo TEXT,
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'active', 'done')),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS days (
  id TEXT PRIMARY KEY,
  trip_id TEXT NOT NULL,
  day_no INTEGER NOT NULL,
  date TEXT NOT NULL,
  title TEXT,
  note TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (trip_id) REFERENCES trips(id) ON DELETE CASCADE,
  UNIQUE (trip_id, day_no),
  UNIQUE (trip_id, date)
);

CREATE TABLE IF NOT EXISTS plans (
  id TEXT PRIMARY KEY,
  trip_id TEXT NOT NULL,
  day_id TEXT NOT NULL,
  start_min INTEGER,
  end_min INTEGER,
  place TEXT NOT NULL,
  detail TEXT,
  map_url TEXT,
  food TEXT,
  transport TEXT,
  cost_estimate INTEGER,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (trip_id) REFERENCES trips(id) ON DELETE CASCADE,
  FOREIGN KEY (day_id) REFERENCES days(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS expenses (
  id TEXT PRIMARY KEY,
  trip_id TEXT NOT NULL,
  day_id TEXT,
  item TEXT NOT NULL,
  amount INTEGER NOT NULL,
  currency TEXT NOT NULL DEFAULT 'JPY',
  category TEXT,
  spent_at TEXT NOT NULL,
  note TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (trip_id) REFERENCES trips(id) ON DELETE CASCADE,
  FOREIGN KEY (day_id) REFERENCES days(id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS flights (
  id TEXT PRIMARY KEY,
  trip_id TEXT NOT NULL,
  leg_type TEXT NOT NULL DEFAULT 'multi',
  leg_order INTEGER NOT NULL DEFAULT 1,
  from_code TEXT NOT NULL,
  from_airport TEXT,
  to_code TEXT NOT NULL,
  to_airport TEXT,
  depart_at TEXT NOT NULL,
  arrive_at TEXT NOT NULL,
  airline TEXT NOT NULL,
  flight_no TEXT NOT NULL,
  price INTEGER,
  currency TEXT DEFAULT 'KRW',
  note TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (trip_id) REFERENCES trips(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS hotels (
  id TEXT PRIMARY KEY,
  trip_id TEXT NOT NULL,
  name TEXT NOT NULL,
  city TEXT NOT NULL,
  check_in_date TEXT NOT NULL,
  check_out_date TEXT NOT NULL,
  confirmation_no TEXT,
  total_price INTEGER,
  currency TEXT DEFAULT 'JPY',
  note TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (trip_id) REFERENCES trips(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS app_meta (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_trips_updated_at ON trips(updated_at);
CREATE INDEX IF NOT EXISTS idx_days_trip_day_no ON days(trip_id, day_no);
CREATE INDEX IF NOT EXISTS idx_plans_day_sort ON plans(day_id, sort_order, start_min);
CREATE INDEX IF NOT EXISTS idx_expenses_trip_spent_at ON expenses(trip_id, spent_at);
CREATE INDEX IF NOT EXISTS idx_flights_trip_depart_at ON flights(trip_id, depart_at);
CREATE INDEX IF NOT EXISTS idx_hotels_trip_checkin ON hotels(trip_id, check_in_date);
