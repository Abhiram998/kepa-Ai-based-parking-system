@echo off
echo ================================================
echo  Nilakkal Parking Management System (NPMS)
echo ================================================
echo.

if not exist "client\dist\index.html" (
    echo WARNING: Frontend has not been built yet.
    echo Running 'npm install' and 'npm run build'...
    echo.
    call npm install
    call npm run build
)

echo Starting backend server...
echo Access the dashboard at: http://localhost:8000
echo.
echo Press Ctrl+C to stop the server.
echo.
.\.\venv\Scripts\python.exe -m uvicorn main:app --host 0.0.0.0 --port 8000
pause
