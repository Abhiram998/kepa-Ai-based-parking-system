from config.database import get_db, SessionLocal, engine, test_connection

# Backward compatibility for existing code.
# All DB configuration is now encapsulated in config/database.py.

if __name__ == "__main__":
    if test_connection():
        print("NPMS Database Module ready for Supabase.")
    else:
        print("CRITICAL: NPMS Database Module could not connect to database.")
