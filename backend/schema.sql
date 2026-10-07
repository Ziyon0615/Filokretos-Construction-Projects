CREATE TABLE IF NOT EXISTS users (
  id SERIAL PRIMARY KEY,
  email TEXT NOT NULL UNIQUE,
  display_name TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'director',
  password_hash TEXT NOT NULL,
  password_salt TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS sessions (
  id TEXT PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash TEXT NOT NULL UNIQUE,
  expires_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS trips (
  id TEXT PRIMARY KEY,
  farm TEXT NOT NULL,
  start_date TEXT NOT NULL,
  end_date TEXT NOT NULL,
  batch_size INTEGER NOT NULL CHECK (batch_size > 0),
  flight_cost_cents INTEGER NOT NULL CHECK (flight_cost_cents >= 0),
  accommodation_cents INTEGER NOT NULL CHECK (accommodation_cents >= 0),
  allowance_cents INTEGER NOT NULL CHECK (allowance_cents >= 0),
  nz_labour_cents INTEGER NOT NULL CHECK (nz_labour_cents >= 0),
  au_cost_cents INTEGER NOT NULL CHECK (au_cost_cents >= 0)
);

CREATE TABLE IF NOT EXISTS sheds (
  id TEXT PRIMARY KEY,
  farm TEXT NOT NULL,
  trip_id TEXT NOT NULL REFERENCES trips(id),
  area_sqm REAL NOT NULL CHECK (area_sqm > 0),
  direct_cost_cents INTEGER NOT NULL CHECK (direct_cost_cents >= 0),
  revenue_cents INTEGER NOT NULL CHECK (revenue_cents >= 0),
  completion_date TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'Complete'
);

CREATE TABLE IF NOT EXISTS import_batches (
  id TEXT PRIMARY KEY,
  source TEXT NOT NULL,
  filename TEXT NOT NULL,
  row_count INTEGER NOT NULL CHECK (row_count > 0),
  imported_by INTEGER NOT NULL REFERENCES users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS import_rows (
  id SERIAL PRIMARY KEY,
  batch_id TEXT NOT NULL REFERENCES import_batches(id) ON DELETE CASCADE,
  row_number INTEGER NOT NULL,
  data_json JSONB NOT NULL
);

CREATE INDEX IF NOT EXISTS sessions_token_hash_idx ON sessions(token_hash);
CREATE INDEX IF NOT EXISTS sessions_expires_at_idx ON sessions(expires_at);
CREATE INDEX IF NOT EXISTS sheds_farm_idx ON sheds(farm);
CREATE INDEX IF NOT EXISTS sheds_trip_id_idx ON sheds(trip_id);
