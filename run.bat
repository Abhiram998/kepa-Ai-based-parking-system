@echo off
echo Starting Nilakkal Parking Management System...
echo Note: If this fails, ensure you have activated your python virtual environment (venv\Scripts\activate).
echo Access the dashboard at: http://localhost:8000
uvicorn main:app --host 0.0.0.0 --port 8000
pause
