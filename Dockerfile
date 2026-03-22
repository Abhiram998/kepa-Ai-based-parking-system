# ==========================================
# Stage 1: Build Frontend (React/Vite)
# ==========================================
FROM node:20-alpine as frontend_builder

WORKDIR /app-frontend

# Install dependencies (cached)
COPY package.json package-lock.json ./
RUN npm ci

# Copy source and build
COPY vite.config.ts tsconfig.json package.json package-lock.json ./
COPY client ./client

# Environment variables for build (if any)
ARG VITE_API_URL
ENV VITE_API_URL=${VITE_API_URL}

RUN npm run build

# ==========================================
# Stage 2: Setup Backend (Python/FastAPI)
# ==========================================
FROM python:3.11-slim as backend_runner

WORKDIR /app

# Install system dependencies (e.g. for pgcrypto/psycopg2 if needed)
# libpq-dev is often needed for psycopg2
RUN apt-get update && apt-get install -y libpq-dev gcc && rm -rf /var/lib/apt/lists/*

# Install Python dependencies (cached)
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Copy Python Code Modules (CRITICAL)
COPY main.py db.py ./
COPY services ./services
COPY config ./config
COPY .env.example ./.env.example

# Copy Built Frontend from Stage 1 to the location expected by main.py
COPY --from=frontend_builder /app-frontend/client/dist ./client/dist

# Expose Port
EXPOSE 8000

# Run Application
CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8000"]
