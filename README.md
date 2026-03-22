# Nilakkal Parking Management System (NPMS)

A robust, AI-powered Parking Management System designed for local deployment.

## System Requirements
- **Python 3.10+** (for the FastAPI backend/AI)
- **Node.js 18+** (for building the React dashboard)
- **PostgreSQL 14+** (for the local database)

## Step-by-Step Installation

### 1. Database Setup
1. Install PostgreSQL and pgAdmin (optional but recommended).
2. Create a new empty database named `npms`.
3. Open a query tool in `npms` and execute the contents of the `setup.sql` file provided in this folder. This creates all necessary tables and extensions (like `pgcrypto`).

### 2. Configure Environment
1. Copy the `.env.example` file and rename it to `.env`.
2. Update the variables inside `.env`:
   - `DATABASE_URL`: Your PostgreSQL connection string (e.g., `postgresql://postgres:password@localhost:5432/npms`).
   - `GEMINI_API_KEY`: Your Google Gemini API key for AI license plate extraction.
   - `SECRET_KEY` *(Required for production)*: A long random string used to sign session cookies. Generate one with:
     ```bash
     python -c "import secrets; print(secrets.token_hex(32))"
     ```
   > ⚠️ If `SECRET_KEY` is not set, the backend will start with a warning and use a weak default. **Always set this before cloud deployment (Render).**

### 3. Build the Dashboard
*(This only needs to be done once, or whenever the UI code changes)*
1. Open a terminal in this project folder.
2. Install dependencies:
   `npm install`
3. Build the frontend into static files:
   `npm run build`
   *This magically compiles your React app into the `client/dist` folder, which the Python backend will automatically detect and serve!*

### 4. Install Backend Dependencies
1. Open your terminal in this folder.
2. (Optional but recommended) Create a virtual environment:
   ```bash
   python -m venv venv
   venv\Scripts\activate  # On Windows
   ```
3. Install required Python packages:
   ```bash
   pip install -r requirements.txt
   ```

### 5. Run the Application
You no longer need to run separate frontend and backend servers (`npm run dev`)!
Simply double click the **`run.bat`** file, or run the following command in your terminal:
```bash
uvicorn main:app --host 0.0.0.0 --port 8000
```

### Accessing the Dashboard
Open your web browser and go to:
👉 **[http://localhost:8000](http://localhost:8000)**

## Troubleshooting
- **Database Connection Error (401/500):** Check your `DATABASE_URL` in `.env`. Ensure your PostgreSQL service is running.
- **AI Scanner Failing (429 Quota Error):** Ensure your Gemini API Key has an active billing account linked in Google AI Studio, or use the free-tier `models/gemini-2.5-flash` model.
- **Blank White Screen / 404s:** This means the frontend hasn't been built. Make sure you run `npm run build` so that the `client/dist` folder is populated!
- **Admin Panel Blocked (403 Forbidden):** Your account may have `OFFICER` role instead of `ADMIN`. Contact your database administrator or run: `UPDATE officers SET role = 'ADMIN' WHERE email = 'your@email.com';` in your PostgreSQL client.
- **Check backend health:** Open `http://localhost:8000/api/health` — it will show if the database is connected.
- **Check your login role:** Open `http://localhost:8000/api/me` (while logged in) — it will show your `role` and `is_admin` status.
