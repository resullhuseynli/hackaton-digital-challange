#!/bin/sh
# Creates a separate database for the pytest suite (runs once, on first DB init).
set -e
psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname "$POSTGRES_DB" -c "CREATE DATABASE \"${POSTGRES_DB}_test\";"
psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname "${POSTGRES_DB}_test" -c "CREATE EXTENSION IF NOT EXISTS postgis;"
