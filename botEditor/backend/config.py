import os

JWT_SECRET = os.getenv("JWT_SECRET", "dev-secret-change-me")
JWT_ALG = "HS256"
JWT_TTL_MINUTES = int(os.getenv("JWT_TTL_MINUTES", "1440"))
