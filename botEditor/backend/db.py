import os
import psycopg2
from psycopg2.extras import RealDictCursor

DATABASE_URL = os.getenv("DATABASE_URL")

if not DATABASE_URL:
  raise RuntimeError("DATABASE_URL env var is required")


def get_connection():
  conn = psycopg2.connect(DATABASE_URL, cursor_factory=RealDictCursor)
  return conn

