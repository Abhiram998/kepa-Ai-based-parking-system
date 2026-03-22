import json
import os
from datetime import datetime, date
from pathlib import Path
from typing import Optional, List, Dict, Any

from starlette.middleware.sessions import SessionMiddleware
from fastapi import FastAPI, HTTPException, Depends, Body, Query, Request, Response
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse, JSONResponse
from fastapi.middleware.gzip import GZipMiddleware  # Added GZip
from dotenv import load_dotenv
from sqlalchemy import text
from sqlalchemy.orm import Session
from pydantic import BaseModel, Field

from db import get_db
from services.gemini_service import extract_plate_from_image, extract_vehicle_details
from services.forecast_service import hybrid_forecast

# =================================================================
# INPUT VALIDATION (PYDANTIC MODELS)
# =================================================================

class ZoneLimits(BaseModel):
    heavy: int = Field(0, ge=0)
    medium: int = Field(0, ge=0)
    light: int = Field(0, ge=0)

class ZonePayload(BaseModel):
    name: str = Field(..., min_length=2, max_length=100)
    limits: ZoneLimits

class TicketCreate(BaseModel):
    vehicle: str = Field(..., min_length=3, max_length=20)
    type: str = Field("Light", pattern="^(Heavy|Medium|Light|heavy|medium|light)$")
    zone: Optional[str] = None
    slot: Optional[str] = None

class LoginPayload(BaseModel):
    email: str
    password: str

class OfficerCreate(BaseModel):
    name: str
    policeId: str
    email: str
    password: str

# =================================================================
# ENVIRONMENT & INITIALIZATION
# =================================================================
import logging

# Configure Logging
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(message)s",
    handlers=[logging.StreamHandler()]
)
logger = logging.getLogger(__name__)

load_dotenv(override=True)
DATABASE_URL = os.getenv("DATABASE_URL")
ALLOWED_ORIGINS = os.getenv("ALLOWED_ORIGINS", "http://localhost:5173").split(",")
logger.info(f"Allowed Origins: {ALLOWED_ORIGINS}")

logger.info("FastAPI booting (Production Mode)")
logger.info("System: Nilakkal Parking Management")

# =================================================================
# FASTAPI APP CONFIGURATION
# =================================================================
app = FastAPI(
    title="Nilakkal Parking Backend",
    description="Backend API for managing parking zones, vehicle entries, exits, and reporting.",
    version="1.2.0"
)

# Enable CORS for frontend communication
app.add_middleware(
    CORSMiddleware,
    allow_origins=ALLOWED_ORIGINS,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Enable Session Middleware for Cookies
# SECURITY: SECRET_KEY is critical for session integrity.
# It is loaded from an environment variable.
# In LOCAL mode, it can come from .env file (via load_dotenv above).
# In PRODUCTION (Render), set it in the Environment Variables dashboard.
SECRET_KEY = os.getenv("SECRET_KEY")
if not SECRET_KEY:
    # Allow local development with a warning — but log loudly so it's not missed
    SECRET_KEY = "local-dev-insecure-key-change-me"
    logger.warning("="*60)
    logger.warning("⚠️  WARNING: SECRET_KEY is not set in environment!")
    logger.warning("   Sessions are using an insecure default key.")
    logger.warning("   Set SECRET_KEY in your .env or Render environment vars.")
    logger.warning("="*60)

app.add_middleware(
    SessionMiddleware, 
    secret_key=SECRET_KEY,
    max_age=86400, # 24 hours
    same_site="none",
    https_only=True
)

# Enable GZip Compression for Network Optimization
app.add_middleware(GZipMiddleware, minimum_size=1000)

# =================================================================
# PERFORMANCE CACHING
# =================================================================
import time
query_cache = {}

def get_cached_response(key: str, ttl: int = 30):
    if key in query_cache:
        data, timestamp = query_cache[key]
        if time.time() - timestamp < ttl:
            return data
    return None

def set_cached_response(key: str, data: dict):
    query_cache[key] = (data, time.time())

# =================================================================
# SECURITY: HARDENING MIDDLEWARE
# =================================================================
@app.middleware("http")
async def add_security_headers(request, call_next):
    """
    Adds security headers to every response to prevent common attacks.
    - X-Content-Type-Options: Prevents MIME-sniffing.
    - X-Frame-Options: Prevents Clickjacking (DENY).
    - Referrer-Policy: Controls referrer information.
    """
    response = await call_next(request)
    response.headers["X-Content-Type-Options"] = "nosniff"
    response.headers["X-Frame-Options"] = "DENY" 
    response.headers["Referrer-Policy"] = "strict-origin-when-cross-origin"
    response.headers["Connection"] = "keep-alive" # HTTP Keep-Alive
    # Note: CSP is omitted to prevent breaking external fonts/scripts without deep analysis
    return response

# =================================================================
# HELPERS & SYSTEM UTILITIES
# =================================================================

def get_current_admin(request: Request):
    """
    Security Dependency: Verifies session cookie and checks for ADMIN or OFFICER roles.
    Both roles now have equal access in this environment.
    """
    user = request.session.get("user")
    if not user:
        raise HTTPException(status_code=401, detail="Authentication Required")
    
    # Both ADMIN and OFFICER roles have identical management permissions.
    if user.get("role") not in ["ADMIN", "OFFICER"]:
        logger.warning(f"Unauthorized access attempt by {user.get('email')}")
        raise HTTPException(status_code=403, detail="System Access level required.")
        
    return user

def trigger_auto_snapshot(db: Session):
    """
    Captures the full system state (count + actual vehicle records).
    This ensures the 'data' column is never NULL and provides a point-in-time
    reference for ground staff and administrators.
    """
    # Ensure the snapshots table exists before attempting an insert
    db.execute(text("""
        CREATE TABLE IF NOT EXISTS snapshots (
            id SERIAL PRIMARY KEY,
            snapshot_time TIMESTAMP DEFAULT NOW(),
            records_count INTEGER,
            data TEXT NOT NULL
        )
    """))

    # Select all vehicles currently inside (exit_time is NULL)
    rows = db.execute(text("""
        SELECT 
            v.vehicle_number AS plate,
            z.zone_id AS zone,
            z.zone_name AS zone_name,
            pt.entry_time AS "timeIn",
            vt.type_name AS type
        FROM parking_tickets pt
        JOIN vehicles v ON pt.vehicle_id = v.vehicle_id
        JOIN vehicle_types vt ON v.vehicle_type_id = vt.id
        JOIN parking_zones z ON pt.zone_id = z.zone_id
        WHERE pt.exit_time IS NULL
          AND z.status = 'ACTIVE'
    """)).mappings().all()

    records = []
    for r in rows:
        item = dict(r)
        if item["timeIn"]:
            # Convert datetime objects to ISO strings for JSON serialization
            item["timeIn"] = item["timeIn"].isoformat()
        records.append(item)

    # Persist the snapshot to the database
    db.execute(text("""
        INSERT INTO snapshots (records_count, data) 
        VALUES (:count, :data)
    """), {
        "count": len(records), 
        "data": json.dumps(records)
    })

# =================================================================
# STARTUP EVENT HANDLERS
# =================================================================

@app.on_event("startup")
def startup_db_check():
    """
    Core system initialization. This ensures that essential tables exist
    and that the vehicle types (Heavy, Medium, Light) are seeded if the
    database is fresh or has been cleared.
    """
    print("Performing Startup Database Check...")
    with next(get_db()) as db:

        db.execute(text("CREATE EXTENSION IF NOT EXISTS pgcrypto"))

        # 1. Ensure vehicle_types table exists
        db.execute(text("""
            CREATE TABLE IF NOT EXISTS vehicle_types (
                id SERIAL PRIMARY KEY,
                type_name VARCHAR(50) UNIQUE NOT NULL
            )
        """))

        # 2. Ensure parking_zones table exists
        db.execute(text("""
            CREATE TABLE IF NOT EXISTS parking_zones (
                zone_id VARCHAR(10) PRIMARY KEY,
                zone_name VARCHAR(100) NOT NULL,
                total_capacity INTEGER DEFAULT 0,
                current_occupied INTEGER DEFAULT 0,
                status VARCHAR(20) DEFAULT 'ACTIVE',
                created_at TIMESTAMP DEFAULT NOW()
            )
        """))

        # 3. Ensure vehicles table exists
        db.execute(text("""
            CREATE TABLE IF NOT EXISTS vehicles (
                vehicle_id SERIAL PRIMARY KEY,
                vehicle_number VARCHAR(20) UNIQUE NOT NULL,
                vehicle_type_id INTEGER REFERENCES vehicle_types(id),
                created_at TIMESTAMP DEFAULT NOW()
            )
        """))

        # 4. Ensure zone_type_limits table exists
        db.execute(text("""
            CREATE TABLE IF NOT EXISTS zone_type_limits (
                id SERIAL PRIMARY KEY,
                zone_id VARCHAR(10) REFERENCES parking_zones(zone_id) ON DELETE CASCADE,
                vehicle_type_id INTEGER REFERENCES vehicle_types(id),
                max_vehicles INTEGER DEFAULT 0,
                current_count INTEGER DEFAULT 0
            )
        """))

        # 5. Ensure parking_tickets table exists
        db.execute(text("""
            CREATE TABLE IF NOT EXISTS parking_tickets (
                ticket_id SERIAL PRIMARY KEY,
                ticket_code VARCHAR(50) UNIQUE NOT NULL,
                vehicle_id INTEGER REFERENCES vehicles(vehicle_id),
                zone_id VARCHAR(10) REFERENCES parking_zones(zone_id),
                entry_time TIMESTAMP DEFAULT NOW(),
                exit_time TIMESTAMP,
                status VARCHAR(20) DEFAULT 'ACTIVE'
            )
        """))

        # 6. Create Snapshots table if missing
        db.execute(text("""
            CREATE TABLE IF NOT EXISTS snapshots (
                id SERIAL PRIMARY KEY,
                snapshot_time TIMESTAMP DEFAULT NOW(),
                records_count INTEGER,
                data TEXT NOT NULL
            )
        """))

        # 7. Create officers table
        db.execute(text("""
            CREATE TABLE IF NOT EXISTS officers (
                officer_id SERIAL PRIMARY KEY,
                name TEXT NOT NULL,
                badge_number TEXT UNIQUE NOT NULL,
                email TEXT UNIQUE NOT NULL,
                password TEXT NOT NULL,
                role TEXT DEFAULT 'OFFICER',
                is_active BOOLEAN DEFAULT TRUE,
                created_at TIMESTAMP DEFAULT NOW()
            )
        """))

        # 8. Seed vehicle types if they don't exist
        db.execute(text("""
            INSERT INTO vehicle_types (type_name)
            SELECT unnest(ARRAY['Heavy', 'Medium', 'Light'])
            WHERE NOT EXISTS (SELECT 1 FROM vehicle_types LIMIT 1)
        """))

        # 9. Create default admin if no officers exist
        existing_admin = db.execute(text("SELECT COUNT(*) FROM officers WHERE role = 'ADMIN'")).scalar()
        if existing_admin == 0:
            print("Seeding default admin account...")
            db.execute(text("""
                INSERT INTO officers (name, badge_number, email, password, role, is_active)
                VALUES (
                    'Admin Officer',
                    'ADMIN001',
                    'admin@police.gov',
                    crypt('admin123', gen_salt('bf')),
                    'ADMIN',
                    TRUE
                )
            """))
        
        db.commit()
        print("Startup Check Complete. Tables verified and Seeded.")

# =================================================================
# ROOT, HEALTH, & DIAGNOSTICS
# =================================================================

@app.get("/api", tags=["General"])
def root():
    """Returns the basic service status."""
    return {
        "status": "ok", 
        "service": "Nilakkal Parking Admin API",
        "timestamp": datetime.now().isoformat()
    }

@app.get("/api/health", tags=["General"])
def health(db: Session = Depends(get_db)):
    """Diagnostic endpoint — pings the database to confirm connectivity."""
    try:
        db.execute(text("SELECT 1"))
        return {"status": "ok", "database": "connected"}
    except Exception as e:
        logger.error(f"Health check DB ping failed: {e}")
        return {"status": "degraded", "database": "disconnected", "error": str(e)}

@app.get("/api/me", tags=["Auth"])
def get_current_user(request: Request):
    """
    Returns the current authenticated user's role and identity from session.
    Safe to call from frontend to verify login state and role.
    """
    user = request.session.get("user")
    if not user:
        raise HTTPException(status_code=401, detail="Not authenticated")
    return {
        "id": user.get("id"),
        "email": user.get("email"),
        "role": user.get("role"),
        "is_admin": user.get("role") in ["ADMIN", "OFFICER"],
    }

# =================================================================
# AGGREGATED ENDPOINTS (PERFORMANCE OPTIMIZATION)
# =================================================================
@app.get("/api/dashboard-summary", tags=["Dashboard"])
def get_dashboard_summary(db: Session = Depends(get_db)):
    """Combines zones, total capacity, and occupancy into a single API call."""
    cached = get_cached_response("dashboard_summary", ttl=15)
    if cached:
        return cached

    zones = get_zones(db)
    total_capacity = sum(z["capacity"] for z in zones)
    total_occupied = sum(z["occupied"] for z in zones)
    
    response = {
        "zones": zones,
        "total_capacity": total_capacity,
        "total_occupied": total_occupied,
        "total_vacancy": total_capacity - total_occupied,
    }
    set_cached_response("dashboard_summary", response)
    return response

@app.get("/api/vehicles-summary", tags=["Dashboard"])
def get_vehicles_summary(db: Session = Depends(get_db)):
    """Groups vehicles inside and exited recently."""
    cached = get_cached_response("vehicles_summary", ttl=30)
    if cached:
        return cached

    # Aggregated query optimized with joins
    rows = db.execute(text("""
        SELECT
            vt.type_name as type,
            COUNT(*) as count
        FROM parking_tickets pt
        JOIN vehicles v ON pt.vehicle_id = v.vehicle_id
        JOIN vehicle_types vt ON v.vehicle_type_id = vt.id
        WHERE pt.exit_time IS NULL
        GROUP BY vt.type_name
    """)).fetchall()

    vehicles = {r.type.lower(): r.count for r in rows}
    set_cached_response("vehicles_summary", vehicles)
    return vehicles

@app.get("/api/tickets-summary", tags=["Dashboard"])
def get_tickets_summary(db: Session = Depends(get_db)):
    """Groups ticket revenue or total active tickets."""
    cached = get_cached_response("tickets_summary", ttl=30)
    if cached:
        return cached

    total = db.execute(text("SELECT COUNT(*) FROM parking_tickets WHERE exit_time IS NULL")).scalar()
    res = {"active_tickets": total}
    set_cached_response("tickets_summary", res)
    return res

# =================================================================
# LIVE DASHBOARD & ZONE MANAGEMENT (FRONTEND WRAPPERS)
# =================================================================
@app.get("/api/zones", tags=["Dashboard"])
def get_zones(db: Session = Depends(get_db)):


    rows = db.execute(text("""
        SELECT
            z.zone_id,
            z.zone_name,
            z.total_capacity,
            z.current_occupied,
            vt.type_name,
            zl.max_vehicles,
            zl.current_count
        FROM parking_zones z
        JOIN zone_type_limits zl ON zl.zone_id = z.zone_id
        JOIN vehicle_types vt ON vt.id = zl.vehicle_type_id
        WHERE UPPER(z.status) = 'ACTIVE'
        ORDER BY z.zone_name ASC
    """)).fetchall()

    zones = {}
    for r in rows:
        if r.zone_id not in zones:
            zones[r.zone_id] = {
                "id": r.zone_id,
                "name": r.zone_name,
                "capacity": r.total_capacity,
                "occupied": r.current_occupied,
                "limits": {"light": 0, "medium": 0, "heavy": 0},
                "stats": {"light": 0, "medium": 0, "heavy": 0},
            }
        vtype = r.type_name.lower()
        zones[r.zone_id]["limits"][vtype] = r.max_vehicles
        zones[r.zone_id]["stats"][vtype] = r.current_count

    return list(zones.values())

# FIX: Wrapper for frontend Add Parking Button
@app.post("/api/zones", tags=["Dashboard"])
def create_zone_public(payload: ZonePayload, db: Session = Depends(get_db), admin: dict = Depends(get_current_admin)):
    """
    Direct bridge for frontend 'Add Parking' button which calls /api/zones.
    Routes the request to the main administrative creation logic.
    """
    return create_zone(payload, db)

# FIX: Wrapper for frontend Edit Zone
@app.put("/api/zones/{zone_id}", tags=["Dashboard"])
def update_zone_public(
    zone_id: str,
    payload: ZonePayload,
    db: Session = Depends(get_db),
    admin: dict = Depends(get_current_admin)
):
    """
    Direct bridge for frontend 'Edit' functionality on the zone table.
    Ensures compatibility with standard REST patterns.
    """
    return update_zone(zone_id, payload, db)

# FIX: Wrapper for frontend Delete Zone
@app.delete("/api/zones/{zone_id}", tags=["Dashboard"])
def delete_zone_public(
    zone_id: str,
    db: Session = Depends(get_db),
    admin: dict = Depends(get_current_admin)
):
    """
    Direct bridge for frontend 'Delete' functionality.
    Forwards the request to the soft-delete administrative logic.
    """
    return delete_zone_admin(zone_id, db)

# =================================================================
# ADMIN: CORE ZONE BUSINESS LOGIC
# =================================================================

@app.post("/api/admin/zones", tags=["Admin"])
def create_zone(payload: ZonePayload, db: Session = Depends(get_db), admin: dict = Depends(get_current_admin)):
    """
    Creates a new parking zone and its associated vehicle type limits atomically.
    Calculates total capacity automatically from the provided limits.
    """
    try:
        name = payload.name
        l = payload.limits

        # Parse and validate numbers safely
        heavy = max(0, l.heavy)
        medium = max(0, l.medium)
        light = max(0, l.light)
        total = heavy + medium + light

        if total <= 0:
            raise HTTPException(400, "Total capacity must be greater than zero")

        # 1. Generate next sequential ID (Z1, Z2, Z3...)
        zone_no = db.execute(text("""
            SELECT COALESCE(MAX(CAST(SUBSTRING(zone_id, 2) AS INT)), 0) + 1 
            FROM parking_zones
        """)).scalar()
        zone_id = f"Z{zone_no}"

        # 2. Insert main zone record
        db.execute(text("""
            INSERT INTO parking_zones(zone_id, zone_name, total_capacity, current_occupied, status)
            VALUES (:id, :name, :cap, 0, 'ACTIVE')
        """), {
            "id": zone_id,
            "name": name,
            "cap": total
        })

        # 3. Get vehicle type IDs from DB and insert limits
        type_ids_rows = db.execute(text("SELECT type_name, id FROM vehicle_types")).fetchall()
        type_ids = {r.type_name: r.id for r in type_ids_rows}

        if not type_ids:
            raise Exception("Critical: vehicle_types table is empty. Cannot map limits.")

        for t_name, max_v in [("Heavy", heavy), ("Medium", medium), ("Light", light)]:
            if t_name in type_ids:
                db.execute(text("""
                    INSERT INTO zone_type_limits(zone_id, vehicle_type_id, max_vehicles, current_count)
                    VALUES (:z, :t, :m, 0)
                """), {
                    "z": zone_id,
                    "t": type_ids[t_name],
                    "m": max_v
                })

        db.commit()
        print(f"Created Zone {zone_id} with capacity {total}")
        return {"success": True, "zoneId": zone_id, "totalCapacity": total, "name": name}

    except Exception as e:
        db.rollback()
        print(f"Zone Creation Failed: {str(e)}")
        raise HTTPException(500, f"Failed to create zone: {str(e)}")

@app.put("/api/admin/zones/{zone_id}", tags=["Admin"])
def update_zone(
    zone_id: str,
    payload: ZonePayload,
    db: Session = Depends(get_db),
    admin: dict = Depends(get_current_admin)
):
    """
    Updates an existing zone's configuration. Includes logic to prevent
    reducing capacity below the current number of vehicles parked.
    """
    try:
        name = payload.name
        l = payload.limits

        # Fetch existing zone data
        zone = db.execute(text("""
            SELECT * FROM parking_zones WHERE zone_id = :z AND status='ACTIVE'
        """), {"z": zone_id}).mappings().first()

        if not zone:
            raise HTTPException(404, "Zone not found or inactive")

        # Fetch current occupancy counts per type
        rows = db.execute(text("""
            SELECT vt.type_name, zl.current_count
            FROM zone_type_limits zl
            JOIN vehicle_types vt ON zl.vehicle_type_id = vt.id
            WHERE zl.zone_id = :z
        """), {"z": zone_id}).fetchall()

        current_counts = {r.type_name.lower(): r.current_count for r in rows}

        heavy = l.heavy
        medium = l.medium
        light = l.light

        # SAFETY CHECK: Prevent reducing below active vehicles
        if heavy < current_counts.get("heavy", 0) \
           or medium < current_counts.get("medium", 0) \
           or light < current_counts.get("light", 0):
            raise HTTPException(
                400,
                "Cannot reduce capacity below current parked vehicles in this zone"
            )

        total_capacity = heavy + medium + light

        # Update core zone record
        db.execute(text("""
            UPDATE parking_zones
            SET zone_name = :name,
                total_capacity = :cap
            WHERE zone_id = :z
        """), {
            "name": name,
            "cap": total_capacity,
            "z": zone_id
        })

        # Update specific limits for each vehicle type
        for t_name, max_v in [("Heavy", heavy), ("Medium", medium), ("Light", light)]:
            db.execute(text("""
                UPDATE zone_type_limits
                SET max_vehicles = :m
                WHERE zone_id = :z
                  AND vehicle_type_id = (
                      SELECT id FROM vehicle_types WHERE type_name = :t
                  )
            """), {
                "m": max_v,
                "z": zone_id,
                "t": t_name
            })

        db.commit()
        return {"success": True, "message": f"Zone {zone_id} updated successfully"}

    except HTTPException:
        raise
    except Exception as e:
        db.rollback()
        raise HTTPException(500, f"Database error during update: {str(e)}")

@app.delete("/api/admin/zones/{zone_id}", tags=["Admin"])
def delete_zone_admin(zone_id: str, db: Session = Depends(get_db), admin: dict = Depends(get_current_admin)):
    """
    Deactivates a zone (Soft Delete).
    Fails if there are still vehicles parked inside.
    """
    try:
        zone = db.execute(text("""
            SELECT current_occupied FROM parking_zones
            WHERE zone_id = :z AND status='ACTIVE'
        """), {"z": zone_id}).scalar()

        if zone is None:
            raise HTTPException(404, "Zone not found")

        if zone > 0:
            raise HTTPException(
                400,
                "Access Denied: Cannot delete zone while vehicles are currently parked"
            )

        # Soft delete: change status so historical data is preserved
        db.execute(text("""
            UPDATE parking_zones
            SET status = 'INACTIVE'
            WHERE zone_id = :z
        """), {"z": zone_id})

        db.commit()
        return {"success": True, "message": f"Zone {zone_id} marked as inactive"}

    except HTTPException:
        raise
    except Exception as e:
        db.rollback()
        raise HTTPException(500, f"Database error during deletion: {str(e)}")
    

# =================================================================
# ADMIN: OFFICER MANAGEMENT
# =================================================================

# =================================================================
# ADMIN AUTH: LOGIN
# =================================================================

@app.post("/api/admin/login", tags=["Admin"])
def admin_login(request: Request, payload: LoginPayload, db: Session = Depends(get_db)):
    email = payload.email
    password = payload.password

    if not email or not password:
        raise HTTPException(status_code=400, detail="Email and password required")

    try:
        officer = db.execute(text("""
            SELECT
                officer_id,
                name,
                badge_number,
                email,
                role
            FROM officers
            WHERE email = :email
              AND password = crypt(:password, password)
              AND is_active = TRUE
            LIMIT 1
        """), {
            "email": email,
            "password": password
        }).mappings().first()

        if not officer:
            raise HTTPException(status_code=401, detail="Invalid email or password")

        # Set Session Cookie
        request.session["user"] = {
            "id": officer["officer_id"],
            "role": officer["role"],
            "email": officer["email"]
        }

        return {
            "success": True,
            "user": {
                "id": officer["officer_id"],
                "name": officer["name"],
                "policeId": officer["badge_number"],
                "email": officer["email"],
                "role": officer["role"]
            }
        }

    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(500, str(e))

@app.post("/api/admin/logout", tags=["Admin"])
def admin_logout(request: Request):
    """Clears the session cookie."""
    request.session.clear()
    return {"success": True}

@app.post("/api/admin/officers", tags=["Admin"])
def register_officer(payload: OfficerCreate, db: Session = Depends(get_db), admin: dict = Depends(get_current_admin)):
    """
    Registers a new parking officer.
    """

    name = payload.name
    police_id = payload.policeId
    email = payload.email
    password = payload.password

    # Basic validation
    if not name or not police_id or not email or not password:
        raise HTTPException(
            status_code=400,
            detail="name, policeId, email, and password are required"
        )

    try:
        # Store password safely (simple hash for now)
        hashed_password = db.execute(
            text("SELECT crypt(:p, gen_salt('bf'))"),
            {"p": password}
        ).scalar()

        db.execute(text("""
            INSERT INTO officers (
                name,
                badge_number,
                email,
                password,
                role,
                is_active
            )
            VALUES (
                :name,
                :badge,
                :email,
                :password,
                'OFFICER',
                TRUE
            )
        """), {
            "name": name,
            "badge": police_id,
            "email": email,
            "password": hashed_password
        })

        db.commit()
        return {
            "success": True,
            "message": "Officer registered successfully"
        }

    except Exception as e:
        db.rollback()

        # Duplicate police ID or email
        if "unique" in str(e).lower():
            raise HTTPException(
                status_code=400,
                detail="Officer with this Police ID or Email already exists"
            )

        raise HTTPException(500, str(e))


@app.get("/api/admin/officers", tags=["Admin"])
def list_officers(db: Session = Depends(get_db), admin: dict = Depends(get_current_admin)):
    """
    Returns all registered officers (safe fields only).
    """
    rows = db.execute(text("""
        SELECT
            officer_id,
            name,
            badge_number AS "policeId",
            email,
            role,
            is_active,
            created_at
        FROM officers
        ORDER BY created_at DESC
    """)).mappings().all()

    return rows

# =================================================================
# VEHICLE OPERATIONS (ENTER, EXIT, SEARCH)
# =================================================================

@app.get("/api/zones/{zone_id}/vehicles", tags=["Vehicles"])
def get_zone_vehicles(zone_id: str, db: Session = Depends(get_db)):
    
    rows = db.execute(text("""
        SELECT
            v.vehicle_number AS number,
            vt.type_name AS type,
            pt.ticket_code AS "ticketId",
            pt.entry_time AS "entryTime"
        FROM parking_tickets pt
        JOIN vehicles v ON pt.vehicle_id = v.vehicle_id
        JOIN vehicle_types vt ON v.vehicle_type_id = vt.id
        WHERE pt.zone_id = :zone_id
          AND pt.exit_time IS NULL
        ORDER BY pt.entry_time DESC
    """), {"zone_id": zone_id}).mappings().all()
    return rows

@app.get("/api/search", tags=["Vehicles"])
def search_vehicle(q: str = Query(...), db: Session = Depends(get_db)):
  
    search_term = q.strip().replace("-", "").replace(" ", "").upper()
    
    # helper for specific timestamp formatting
    def format_ts(ts):
        if not ts: return None
        val = ts.isoformat()
        if not val.endswith("Z") and "+" not in val:
            val += "Z"
        return val

    # 1. Look for LIVE vehicle (Currently Inside)
    row = db.execute(text("""
        SELECT 
            v.vehicle_number AS vehicle, vt.type_name as type, pt.ticket_code, pt.entry_time, z.zone_name, 'INSIDE' as current_status
        FROM parking_tickets pt
        JOIN vehicles v ON pt.vehicle_id = v.vehicle_id
        JOIN vehicle_types vt ON v.vehicle_type_id = vt.id
        JOIN parking_zones z ON pt.zone_id = z.zone_id
        WHERE REPLACE(REPLACE(UPPER(v.vehicle_number), '-', ''), ' ', '') LIKE :q 
          AND pt.exit_time IS NULL
        LIMIT 1
    """), {"q": f"%{search_term}%"}).mappings().first()

    # 2. If not inside, check HISTORY (Recently Exited)
    if not row:
        row = db.execute(text("""
            SELECT 
                v.vehicle_number AS vehicle, vt.type_name as type, pt.ticket_code, pt.entry_time, pt.exit_time, z.zone_name, 'EXITED' as current_status
            FROM parking_tickets pt
            JOIN vehicles v ON pt.vehicle_id = v.vehicle_id
            JOIN vehicle_types vt ON v.vehicle_type_id = vt.id
            JOIN parking_zones z ON pt.zone_id = z.zone_id
            WHERE REPLACE(REPLACE(UPPER(v.vehicle_number), '-', ''), ' ', '') LIKE :q 
            ORDER BY pt.exit_time DESC
            LIMIT 1
        """), {"q": f"%{search_term}%"}).mappings().first()

    if not row:
        raise HTTPException(404, "Vehicle record not found in live or historical data")
        
    return {
        "vehicle": row["vehicle"],
        "ticketId": row["ticket_code"],
        "status": row["current_status"],
        "type": row["type"].upper(),
        "entryTime": format_ts(row["entry_time"]),
        "exitTime": format_ts(row.get("exit_time")),
        "zone": row["zone_name"],
        "message": "Vehicle is inside" if row["current_status"] == 'INSIDE' else f"Vehicle exited at {row.get('exit_time')}"
    }

@app.post("/api/extract-plate", tags=["Operations"])
def extract_plate(payload: dict = Body(...)):
    """
    Extracts license plate text from an image using Gemini AI.
    Expected payload: { "image": "base64_string" }
    """
    image_base64 = payload.get("image")
    if not image_base64:
        raise HTTPException(status_code=400, detail="Image data is required")
    
    # Strip base64 prefix if present (e.g., data:image/jpeg;base64,...)
    if "," in image_base64:
        image_base64 = image_base64.split(",")[1]
    
    try:
        plate = extract_plate_from_image(image_base64)
        if not plate:
            raise HTTPException(status_code=500, detail="Plate extraction failed")
        return {"plate": plate}
    except ValueError as ve:
        raise HTTPException(status_code=500, detail=str(ve))
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Internal Server Error: {str(e)}")

@app.post("/api/extract-vehicle-details", tags=["Operations"])
def extract_vehicle_details_api(payload: dict = Body(...)):
    """
    Extracts license plate AND vehicle type using Gemini AI.
    Expected payload: { "image": "base64_string" }
    """
    image_base64 = payload.get("image")
    if not image_base64:
        raise HTTPException(status_code=400, detail="Image data is required")
    
    if "," in image_base64:
        image_base64 = image_base64.split(",")[1]
    
    try:
        details = extract_vehicle_details(image_base64)
        return details
    except ValueError as ve:
        raise HTTPException(status_code=500, detail=str(ve))
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Internal Server Error: {str(e)}")

@app.post("/api/enter", tags=["Operations"])
def enter_vehicle(payload: TicketCreate, db: Session = Depends(get_db)):
    """Registers a vehicle entry, assigns it to a zone, and triggers a snapshot."""
    try:
        vehicle = payload.vehicle
        vtype = payload.type.capitalize()
        zone = payload.zone

        if not vehicle:
            raise HTTPException(400, "Vehicle number required for entry")

        # -------------------------------
        # Select available zone with capacity validation
        # -------------------------------
        z = db.execute(text("""
            SELECT z.*
            FROM parking_zones z
            JOIN zone_type_limits zl ON z.zone_id = zl.zone_id
            JOIN vehicle_types vt ON zl.vehicle_type_id = vt.id
            WHERE z.status = 'ACTIVE'
              AND z.current_occupied < z.total_capacity
              AND zl.current_count < zl.max_vehicles
              AND vt.type_name = :vtype
              AND (:zone_filter IS NULL OR z.zone_id = :zone_filter)
            ORDER BY z.created_at ASC
            LIMIT 1
        """), {"vtype": vtype, "zone_filter": zone}).mappings().first()

        if not z:
            raise HTTPException(400, f"Capacity Alert: No available spots for {vtype} vehicles in requested zone(s)")

        # -------------------------------
        # Get vehicle type ID
        # -------------------------------
        vt = db.execute(text("""
            SELECT id FROM vehicle_types WHERE type_name = :t
        """), {"t": vtype}).scalar()

        # -------------------------------
        # Vehicle UPSERT
        # -------------------------------
        vehicle_id = db.execute(text("""
            SELECT vehicle_id
            FROM vehicles
            WHERE vehicle_number = :n
        """), {"n": vehicle}).scalar()

        if not vehicle_id:
            vehicle_id = db.execute(text("""
                INSERT INTO vehicles (vehicle_number, vehicle_type_id)
                VALUES (:n, :t)
                RETURNING vehicle_id
            """), {"n": vehicle, "t": vt}).scalar()

        # -------------------------------
        # ACTIVE TICKET CHECK (IMPORTANT)
        # -------------------------------
        active_ticket = db.execute(text("""
            SELECT ticket_code, zone_id
            FROM parking_tickets
            WHERE vehicle_id = :v
              AND exit_time IS NULL
            LIMIT 1
        """), {"v": vehicle_id}).mappings().first()

        if active_ticket:
            return {
                "success": False,
                "message": "Vehicle already inside parking",
                "ticket": active_ticket["ticket_code"],
                "zone": active_ticket["zone_id"]
            }

        # -------------------------------
        # CREATE NEW TICKET
        # -------------------------------
        ticket_code = f"TKT-{int(datetime.now().timestamp())}"

        db.execute(text("""
            INSERT INTO parking_tickets
            (ticket_code, vehicle_id, zone_id, entry_time, status)
            VALUES (:c, :v, :z, NOW(), 'ACTIVE')
        """), {
            "c": ticket_code,
            "v": vehicle_id,
            "z": z["zone_id"]
        })

        # -------------------------------
        # Update counters
        # -------------------------------
        db.execute(text("""
            UPDATE parking_zones
            SET current_occupied = current_occupied + 1
            WHERE zone_id = :z
        """), {"z": z["zone_id"]})

        db.execute(text("""
            UPDATE zone_type_limits
            SET current_count = current_count + 1
            WHERE zone_id = :z AND vehicle_type_id = :t
        """), {"z": z["zone_id"], "t": vt})

        db.flush()
        trigger_auto_snapshot(db)
        db.commit()

        return {
            "success": True,
            "ticket": ticket_code,
            "zone": z["zone_name"]
        }

    except HTTPException:
        raise
    except Exception as e:
        db.rollback()
        raise HTTPException(500, f"Entry Error: {str(e)}")

@app.post("/api/exit", tags=["Operations"])
def exit_vehicle(payload: dict = Body(...), db: Session = Depends(get_db)):
    """
    Processes vehicle exit using ticketId.
    """
    ticket_code = payload.get("ticketId") or payload.get("ticket_code")

    if not ticket_code:
        raise HTTPException(400, "ticketId is required")

    ticket = db.execute(text("""
        SELECT pt.*, v.vehicle_type_id
        FROM parking_tickets pt
        JOIN vehicles v ON pt.vehicle_id = v.vehicle_id
        WHERE pt.ticket_code = :c
          AND pt.exit_time IS NULL
    """), {"c": ticket_code}).mappings().first()

    if not ticket:
        raise HTTPException(404, "Active ticket not found")

    # Mark exit
    db.execute(text("""
        UPDATE parking_tickets
        SET exit_time = NOW(), status = 'EXITED'
        WHERE ticket_code = :c
    """), {"c": ticket_code})

    # Reduce zone occupancy
    db.execute(text("""
        UPDATE parking_zones
        SET current_occupied = current_occupied - 1
        WHERE zone_id = :z
    """), {"z": ticket["zone_id"]})

    # Reduce vehicle type count
    db.execute(text("""
        UPDATE zone_type_limits
        SET current_count = current_count - 1
        WHERE zone_id = :z
          AND vehicle_type_id = :t
    """), {
        "z": ticket["zone_id"],
        "t": ticket["vehicle_type_id"]
    })

    db.commit()

    return {
        "success": True,
        "message": "Vehicle exited successfully",
        "ticket": ticket_code
    }
# =================================================================
# REPORTS & ANALYTICS
# =================================================================

@app.get("/api/reports", tags=["Reporting"])
def get_reports(
    zone: Optional[str] = Query(default=None),
    report_date: Optional[date] = Query(default=None),
    db: Session = Depends(get_db),
):
    """Generates detailed reports for specific zones or dates."""
    query = """
        SELECT
            pt.ticket_code       AS ticketid,
            v.vehicle_number     AS vehicle,
            vt.type_name         AS type,
            z.zone_name          AS zone,
            pt.entry_time        AS entrytime,
            pt.exit_time          AS exittime
        FROM parking_tickets pt
        JOIN vehicles v ON pt.vehicle_id = v.vehicle_id
        JOIN vehicle_types vt ON v.vehicle_type_id = vt.id
        JOIN parking_zones z ON pt.zone_id = z.zone_id
        WHERE 1=1
    """
    params = {}

    if zone and zone not in ["All Zones", "all"]:
        query += " AND z.zone_id = :zone"
        params["zone"] = zone

    if report_date:
        query += """ 
            AND pt.entry_time < (:report_date + INTERVAL '1 day')
            AND (pt.exit_time IS NULL OR pt.exit_time >= :report_date)
        """
        params["report_date"] = report_date

    query += " ORDER BY pt.entry_time DESC"
    rows = db.execute(text(query), params).mappings().all()

    def format_ts(ts):
        if not ts: return None
        val = ts.isoformat()
        if not val.endswith("Z") and "+" not in val:
            val += "Z"
        return val

    return [
        {
            "ticketId": r["ticketid"],
            "vehicle": r["vehicle"],
            "type": r["type"],
            "zone": r["zone"],
            "entryTime": format_ts(r["entrytime"]),
            "exitTime": format_ts(r["exittime"]),
            "status": "INSIDE" if r["exittime"] is None else "EXITED",
        }
        for r in rows
    ]

@app.get("/api/predictions", tags=["Forecast"])
def get_predictions(db: Session = Depends(get_db)):
    """
    Advanced Hybrid Forecast: Combines rule-based logic with Linear Regression.
    Uses seasonal daily peaks and current load for optimized prediction.
    """
    try:
        # 1. Fetch past 7 days snapshot data for analysis
        snapshots = db.execute(text("""
            SELECT snapshot_time, records_count
            FROM snapshots
            WHERE snapshot_time >= NOW() - INTERVAL '7 days'
            ORDER BY snapshot_time DESC
        """)).mappings().all()

        # 2. Get current system capacity & load
        totals = db.execute(text("""
            SELECT 
                COALESCE(SUM(total_capacity), 1) as cap,
                COALESCE(SUM(current_occupied), 0) as occ
            FROM parking_zones
            WHERE status='ACTIVE'
        """)).mappings().first()
        
        cap = totals["cap"]
        occ = totals["occ"]
        load_percent = round((occ / cap) * 100, 1)

        # 3. Call Hybrid Forecast Model from service
        forecast_results = hybrid_forecast(snapshots, load_percent)

        # 4. Generate hourly curve for tomorrow (visual compatibility)
        final_p = forecast_results["final_prediction"]
        hourly = []
        base_occ = final_p * 0.4
        
        for h in range(6):
            hourly.append({
                "time": f"{4 + h * 4}:00",
                "probability": round(base_occ + (final_p - base_occ) * (h / 5))
            })

        # 5. Generate Past 7 Days trend
        import collections
        from datetime import datetime, timedelta
        
        days_names = [(datetime.now() - timedelta(days=i)).strftime("%a") for i in range(6, -1, -1)]
        daily_max = collections.defaultdict(int)
        for s in snapshots:
            day_str = s["snapshot_time"].strftime("%a")
            daily_max[day_str] = max(daily_max[day_str], s["records_count"])
            
        past7Days = []
        # If no snapshot data exists yet, provide some dummy data so the chart isn't completely empty
        default_baseline = [120, 150, 100, 180, 220, 300, 280]
        for i, d in enumerate(days_names):
            val = daily_max.get(d)
            if val is None or val == 0:
                val = default_baseline[i] if not daily_max else 0
            past7Days.append({"day": d, "occupancy": val})

        # 6. Generate zone array
        zones_data = db.execute(text("""
            SELECT zone_name, current_occupied, total_capacity
            FROM parking_zones
            WHERE status='ACTIVE'
        """)).mappings().all()
        
        zones_arr = []
        for z in zones_data:
            base_z_occ = (z["current_occupied"] / z["total_capacity"] * 100) if z["total_capacity"] > 0 else 0
            blend = round(base_z_occ * 0.5 + final_p * 0.5)
            zones_arr.append({
                "zone": z["zone_name"],
                "probability": min(blend, 100)
            })

        # Return required hybrid format
        return {
            "rule_prediction": forecast_results["rule_prediction"],
            "ml_prediction": forecast_results["ml_prediction"],
            "final_prediction": forecast_results["final_prediction"],
            "traffic_level": forecast_results["traffic_level"],
            "tomorrow": {
                "probability": final_p,
                "confidence": "HIGH" if final_p > 70 else "MEDIUM" if final_p > 40 else "LOW",
                "message": forecast_results["message"]
            },
            "hourly": hourly,
            "past7Days": past7Days,
            "zones": zones_arr,
            "load_current": load_percent
        }
    except Exception as e:
        print(f"Forecast Error: {str(e)}")
        raise HTTPException(500, f"Failed to generate forecast: {str(e)}")

# =================================================================
# SNAPSHOT HISTORY
# =================================================================

@app.get("/api/snapshots", tags=["Diagnostics"])
def get_snapshots(db: Session = Depends(get_db)):
    """Retrieves the last 20 automated snapshots for integrity checks."""
    try:
        rows = db.execute(text("""
            SELECT id, snapshot_time, records_count AS records, data
            FROM snapshots 
            ORDER BY snapshot_time DESC
            LIMIT 20
        """)).mappings().all()
        
        result = []
        for r in rows:
            item = dict(r)
            
            # Ensure timestamp is treated as UTC (Robust Fix)
            if item.get("snapshot_time"):
                ts = item["snapshot_time"]
                val = ts.isoformat() if isinstance(ts, datetime) else str(ts)
                if not val.endswith("Z") and "+" not in val:
                    val += "Z"
                item["snapshot_time"] = val
                
            if item.get("data"):
                item["data"] = json.loads(item["data"])
            result.append(item)
        return result
    except Exception:
        return []

@app.post("/api/snapshot", tags=["Diagnostics"])
def create_snapshot(db: Session = Depends(get_db)):
    """Manually triggers a system-wide record snapshot."""
    try:
        trigger_auto_snapshot(db)
        db.commit()
        return {"success": True, "message": "Manual snapshot captured"}
    except Exception as e:
        db.rollback()
        raise HTTPException(500, str(e))

@app.post("/api/snapshot/activate/{snapshot_id}", tags=["Diagnostics"])
def restore_snapshot(snapshot_id: int, db: Session = Depends(get_db)):
    """
    Time Travel: Restores the system to a previous state.
    1. Auto-saves current state (Safety Snapshot).
    2. Wipes all active tickets.
    3. Restores tickets from the selected snapshot.
    """
    try:
        # 1. Fetch the requested snapshot
        target_snap = db.execute(text("""
            SELECT data FROM snapshots WHERE id = :id
        """), {"id": snapshot_id}).mappings().first()

        if not target_snap:
            raise HTTPException(404, "Snapshot not found")

        # 2. Parse the target data (Vehicle List)
        vehicles_to_restore = json.loads(target_snap["data"])

        # 3. SAFETY: Save current state before wiping
        print("Creating safety snapshot before restore...")
        trigger_auto_snapshot(db)

        # 4. WIPE LIVE STATE
        print("Wiping live parking data...")
        
        # Mark all active tickets as 'SYSTEM_RESTORE_CLEARED' (Soft Wipe) or Delete
        # Here we soft-delete by setting exit_time = NOW to avoid losing history, 
        # or we can hard delete if we want a true "Time Travel" feel.
        # Given the "System Reset" requirement, we'll DELETE active tickets to clean the slate.
        db.execute(text("DELETE FROM parking_tickets WHERE exit_time IS NULL"))
        
        # Reset Zone Counters
        db.execute(text("UPDATE parking_zones SET current_occupied = 0"))
        db.execute(text("UPDATE zone_type_limits SET current_count = 0"))
        db.flush() # Ensure wipe is reflected before inserts
        
        # 5. REACTIVATE ZONES (If snapshot contains vehicles in deleted zones)
        # We ensure all zones referred to in the snapshot are ACTIVE before continuing.
        snapshot_zone_ids = list(set(v["zone"] for v in vehicles_to_restore if v.get("zone")))
        if snapshot_zone_ids:
            print(f"Ensuring status=ACTIVE for snapshot zones: {snapshot_zone_ids}")
            # Use IN instead of ANY for wider dialect compatibility
            db.execute(text("""
                UPDATE parking_zones 
                SET status = 'ACTIVE' 
                WHERE zone_id IN :ids
            """), {"ids": tuple(snapshot_zone_ids)})
            db.flush()

        # 6. RESTORE VEHICLES
        print(f"Restoring {len(vehicles_to_restore)} vehicles to database...")
        
        # Pre-fetch fallback zone and current active set with names for smart mapping
        active_zones_rows = db.execute(text("SELECT zone_id, zone_name FROM parking_zones WHERE status = 'ACTIVE'")).fetchall()
        active_zone_ids = {r.zone_id for r in active_zones_rows}
        name_to_id = {r.zone_name: r.zone_id for r in active_zones_rows}
        fallback_zone_id = active_zones_rows[0].zone_id if active_zones_rows else None
        
        restored_count: int = 0
        processed_v_ids = set() # Prevent duplicate entries using internal IDs
        
        for v in vehicles_to_restore:
            try:
                # v = { "plate": "...", "zone": "...", "zone_name": "...", "timeIn": "...", "type": "..." }
                
                # A. Resolve Vehicle and Type
                plate_cleaned = v["plate"].strip().upper()
                v_type_str = v.get("type", "Light").capitalize()
                
                v_type_id = db.execute(text("SELECT id FROM vehicle_types WHERE type_name = :t"), 
                                     {"t": v_type_str}).scalar() or 1 # Default to ID 1 if not found
                
                vehicle_id = db.execute(text("SELECT vehicle_id FROM vehicles WHERE vehicle_number = :n"), 
                                      {"n": plate_cleaned}).scalar()

                if not vehicle_id:
                    vehicle_id = db.execute(text("""
                        INSERT INTO vehicles (vehicle_number, vehicle_type_id) 
                        VALUES (:n, :t) RETURNING vehicle_id
                    """), {"n": plate_cleaned, "t": v_type_id}).scalar()

                # B. ID-Based Deduplication (Final Safety)
                if vehicle_id in processed_v_ids:
                    print(f"Skipping duplicate vehicle {plate_cleaned} (ID: {vehicle_id}) in snapshot")
                    continue
                processed_v_ids.add(vehicle_id)


                # C. Smart Zone Mapping
                # Priority 1: Map by Name (if available in snapshot)
                # Priority 2: Map by ID (if active)
                # Priority 3: Fallback
                target_zone = None
                snap_zone_name = v.get("zone_name")
                snap_zone_id = v.get("zone")

                if snap_zone_name and snap_zone_name in name_to_id:
                    target_zone = name_to_id[snap_zone_name]
                elif snap_zone_id in active_zone_ids:
                    target_zone = snap_zone_id
                
                if not target_zone:
                    print(f"Warning: Could not map vehicle {v['plate']} (Zone: {snap_zone_id}/{snap_zone_name}). Using fallback.")
                    target_zone = fallback_zone_id

                if not target_zone:
                    print(f"Warning: No active zone found for vehicle {v['plate']}. Skipping.")
                    continue # Hard failure: no zones active in system

                # D. Insert Active Ticket (Force previous entry time)
                ticket_code = f"RES-{int(datetime.now().timestamp())}-{restored_count}"
                
                db.execute(text("""
                    INSERT INTO parking_tickets (ticket_code, vehicle_id, zone_id, entry_time, status)
                    VALUES (:code, :vid, :zid, :time, 'RESTORED')
                """), {
                    "code": ticket_code,
                    "vid": vehicle_id,
                    "zid": target_zone,
                    "time": v["timeIn"]
                })

                # D. Increment Counters
                db.execute(text("""
                    UPDATE parking_zones SET current_occupied = current_occupied + 1 WHERE zone_id = :z
                """), {"z": target_zone})

                db.execute(text("""
                    UPDATE zone_type_limits 
                    SET current_count = current_count + 1 
                    WHERE zone_id = :z AND vehicle_type_id = :t
                """), {"z": target_zone, "t": v_type_id})
                db.flush() # Ensure counters are updated before next iteration

                restored_count = restored_count + 1
            except Exception as inner_e:
                print(f"Warning: Failed to restore vehicle {v.get('plate')}: {inner_e}")
                continue

        db.commit()
        print(f"Restore Successful. {restored_count} vehicles operational.")
        return {"success": True, "message": f"Restored {restored_count} vehicles from snapshot #{snapshot_id}"}

    except Exception as e:
        db.rollback()
        print(f"Restore Failed: {str(e)}")
        raise HTTPException(500, f"Restore failed: {str(e)}")

@app.delete("/api/snapshots/{snapshot_id}", tags=["Diagnostics"])
def delete_snapshot(snapshot_id: int, db: Session = Depends(get_db)):
    """Permanently deletes a snapshot from the server."""
    try:
        result = db.execute(text("DELETE FROM snapshots WHERE id = :id"), {"id": snapshot_id})
        db.commit()
        
        if result.rowcount == 0:
            raise HTTPException(404, "Snapshot not found")
            
        return {"success": True, "message": f"Snapshot #{snapshot_id} deleted"}
    except HTTPException:
        raise
    except Exception as e:
        db.rollback()
        raise HTTPException(500, str(e))

# =================================================================
# STATIC FRONTEND DELIVERY (SPA SUPPORT)
# =================================================================
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse
from pathlib import Path

BASE_DIR = Path(__file__).resolve().parent
PUBLIC_DIR = BASE_DIR / "client" / "dist"

if PUBLIC_DIR.exists():
    print(f"Serving static files from: {PUBLIC_DIR}")
    
    # Serve built assets (js, css)
    if (PUBLIC_DIR / "assets").exists():
        app.mount("/assets", StaticFiles(directory=PUBLIC_DIR / "assets"), name="assets")

    @app.get("/", include_in_schema=False)
    def serve_root():
        """Serves the primary index file for the Dashboard."""
        return FileResponse(PUBLIC_DIR / "index.html")

    @app.get("/{path:path}", include_in_schema=False)
    def serve_spa(path: str):
        """Redirects all non-API routes to index.html to support SPA routing."""
        if path.startswith("api"):
            raise HTTPException(status_code=404, detail="API endpoint not found")
            
        # Serve any root static files (like favicon.ico) if they exist
        file_path = PUBLIC_DIR / path
        if file_path.is_file():
            return FileResponse(file_path)
            
        return FileResponse(PUBLIC_DIR / "index.html")
else:
    print("Static directory 'client/dist' not found. API-only mode active.")

# Final note for developer maintenance:
# This main.py acts as the central hub. All SQL logic is kept in text() blocks 
# for maximum transparency and speed. Ensure 'db.py' provides a reliable 'get_db' generator.
# =================================================================
# END OF FILE
# =================================================================