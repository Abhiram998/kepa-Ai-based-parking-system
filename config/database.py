import os
import logging
from sqlalchemy import create_engine, text
from sqlalchemy.orm import sessionmaker, Session
from dotenv import load_dotenv

# Load environment variables
load_dotenv(override=True)

DATABASE_URL = os.getenv("DATABASE_URL")
if not DATABASE_URL:
    raise ValueError("DATABASE_URL is not set in environment variables")

# Logging setup
logger = logging.getLogger(__name__)

# SQLAlchemy Engine Configuration for Supabase (Cloud Postgres)
# We add pool_size and max_overflow for better performance in a cloud environment
engine = create_engine(
    DATABASE_URL,
    pool_size=10,
    max_overflow=20,
    pool_pre_ping=True,  # ✅ Checks if connection is alive before using it
    pool_recycle=3600,   # ✅ Recycles connections every hour to avoid stale endpoints
)

# SessionLocal for DB operations
SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)

def get_db():
    """
    FastAPI Dependency: Yields a database session and ensures it's closed correctly.
    """
    db = SessionLocal()
    try:
        # ✅ Test connection on startup or first request
        # db.execute(text("SELECT 1")) 
        yield db
    except Exception as e:
        logger.error(f"Database connection error: {str(e)}")
        raise
    finally:
        db.close()

def test_connection():
    """
    Verifies if the connection to Supabase is active.
    """
    try:
        with engine.connect() as conn:
            conn.execute(text("SELECT 1"))
            conn.commit()
            print("Successfully connected to Supabase PostgreSQL!")
            return True
    except Exception as e:
        print(f"Failed to connect to Supabase: {str(e)}")
        return False

if __name__ == "__main__":
    test_connection()
