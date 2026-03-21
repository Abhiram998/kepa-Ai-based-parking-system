
-- 1. Enable Crypto Extension
CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- 2. Vehicle Types
CREATE TABLE IF NOT EXISTS vehicle_types (
    id SERIAL PRIMARY KEY,
    type_name VARCHAR(50) UNIQUE NOT NULL
);

INSERT INTO vehicle_types (type_name) VALUES 
('Heavy'), ('Medium'), ('Light')
ON CONFLICT DO NOTHING;

-- 3. Parking Zones
CREATE TABLE IF NOT EXISTS parking_zones (
    zone_id VARCHAR(10) PRIMARY KEY,
    zone_name VARCHAR(100) NOT NULL,
    total_capacity INTEGER DEFAULT 0,
    current_occupied INTEGER DEFAULT 0,
    status VARCHAR(20) DEFAULT 'ACTIVE',
    created_at TIMESTAMP DEFAULT NOW() -- Added created_at based on main.py requirements
);

-- 4. Vehicles
CREATE TABLE IF NOT EXISTS vehicles (
    vehicle_id SERIAL PRIMARY KEY,
    vehicle_number VARCHAR(20) UNIQUE NOT NULL,
    vehicle_type_id INTEGER REFERENCES vehicle_types(id),
    created_at TIMESTAMP DEFAULT NOW()
);

-- 5. Zone Limits
CREATE TABLE IF NOT EXISTS zone_type_limits (
    id SERIAL PRIMARY KEY,
    zone_id VARCHAR(10) REFERENCES parking_zones(zone_id) ON DELETE CASCADE,
    vehicle_type_id INTEGER REFERENCES vehicle_types(id),
    max_vehicles INTEGER DEFAULT 0,
    current_count INTEGER DEFAULT 0
);

-- 6. Parking Tickets
CREATE TABLE IF NOT EXISTS parking_tickets (
    ticket_id SERIAL PRIMARY KEY,
    ticket_code VARCHAR(50) UNIQUE NOT NULL,
    vehicle_id INTEGER REFERENCES vehicles(vehicle_id),
    zone_id VARCHAR(10) REFERENCES parking_zones(zone_id),
    entry_time TIMESTAMP DEFAULT NOW(),
    exit_time TIMESTAMP,
    status VARCHAR(20) DEFAULT 'ACTIVE'
);

-- 7. Snapshots
CREATE TABLE IF NOT EXISTS snapshots (
    id SERIAL PRIMARY KEY,
    snapshot_time TIMESTAMP DEFAULT NOW(),
    records_count INTEGER,
    data TEXT NOT NULL
);

-- 8. Officers
CREATE TABLE IF NOT EXISTS officers (
    officer_id SERIAL PRIMARY KEY,
    name TEXT NOT NULL,
    badge_number TEXT UNIQUE NOT NULL,
    email TEXT UNIQUE NOT NULL,
    password TEXT NOT NULL,
    role TEXT DEFAULT 'OFFICER',
    is_active BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMP DEFAULT NOW()
);
