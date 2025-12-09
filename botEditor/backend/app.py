import os
import uuid
from datetime import datetime, timedelta

import jwt
from fastapi import Depends, FastAPI, HTTPException, Response, status
from fastapi.middleware.cors import CORSMiddleware
from fastapi import Request
from passlib.context import CryptContext
from psycopg2.extras import Json
from psycopg2 import Error as PsycopgError


from .db import get_connection

JWT_SECRET = os.getenv("JWT_SECRET", "dev-secret-change-me")
JWT_ALG = "HS256"
JWT_TTL_MINUTES = int(os.getenv("JWT_TTL_MINUTES", "1440"))

pwd_context = CryptContext(schemes=["bcrypt"], deprecated="auto")

app = FastAPI(title="Bot Editor Backend")

FRONTEND_ORIGIN = os.getenv("FRONTEND_ORIGIN", "http://localhost:5173")
origins_env = os.getenv("FRONTEND_ORIGIN", "http://localhost:5173")
origins = [o.strip() for o in origins_env.split(",") if o.strip()]

app.add_middleware(
    CORSMiddleware,
    allow_origins=origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


def create_session_token(user_id: int) -> str:
    payload = {
        "sub": str(user_id),
        "exp": datetime.utcnow() + timedelta(minutes=JWT_TTL_MINUTES),
    }
    return jwt.encode(payload, JWT_SECRET, algorithm=JWT_ALG)


def parse_session_token(token: str) -> int:
    try:
        payload = jwt.decode(token, JWT_SECRET, algorithms=[JWT_ALG])
    except jwt.ExpiredSignatureError:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Session expired")
    except jwt.PyJWTError:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid token")

    user_id = int(payload.get("sub"))
    return user_id


def set_session_cookie(response: Response, token: str) -> None:
  response.set_cookie(
      key="session",
      value=token,
      httponly=True,
      samesite="lax",
      secure=False,
      max_age=JWT_TTL_MINUTES * 60,
  )


def clear_session_cookie(response: Response) -> None:
  response.delete_cookie("session")


async def current_user(request: Request):
    token = request.cookies.get("session")
    if not token:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Not authenticated")
    user_id = parse_session_token(token)
    return {"id": user_id}



@app.post("/api/auth/register")
async def register(payload: dict, response: Response):
    email = (payload.get("email") or "").strip().lower()
    password = payload.get("password") or ""

    if not email or not password:
        raise HTTPException(status_code=400, detail="Email and password are required")

    password_hash = pwd_context.hash(password)

    conn = get_connection()
    try:
        with conn:
            with conn.cursor() as cur:
                cur.execute("SELECT id FROM app_user WHERE email = %s", (email,))
                if cur.fetchone():
                    raise HTTPException(status_code=400, detail="User already exists")

                cur.execute(
                    "INSERT INTO app_user (email, password_hash) VALUES (%s, %s) RETURNING id, email",
                    (email, password_hash),
                )
                row = cur.fetchone()
    finally:
        conn.close()

    token = create_session_token(row["id"])
    set_session_cookie(response, token)

    return {"id": row["id"], "email": row["email"]}


@app.post("/api/auth/login")
async def login(payload: dict, response: Response):
    email = (payload.get("email") or "").strip().lower()
    password = payload.get("password") or ""

    if not email or not password:
        raise HTTPException(status_code=400, detail="Email and password are required")

    conn = get_connection()
    try:
        with conn:
            with conn.cursor() as cur:
                cur.execute("SELECT id, email, password_hash FROM app_user WHERE email = %s", (email,))
                row = cur.fetchone()
    finally:
        conn.close()

    if not row or not pwd_context.verify(password, row["password_hash"]):
        raise HTTPException(status_code=401, detail="Invalid credentials")

    token = create_session_token(row["id"])
    set_session_cookie(response, token)

    return {"id": row["id"], "email": row["email"]}


@app.get("/api/auth/me")
async def me(user = Depends(current_user)):
    user_id = user["id"]
    conn = get_connection()
    try:
        with conn:
            with conn.cursor() as cur:
                cur.execute("SELECT id, email, created_at FROM app_user WHERE id = %s", (user_id,))
                row = cur.fetchone()
    finally:
        conn.close()

    if not row:
        raise HTTPException(status_code=404, detail="User not found")

    return {
        "id": row["id"],
        "email": row["email"],
        "created_at": row["created_at"].isoformat(),
    }


@app.post("/api/auth/logout")
async def logout(response: Response):
    clear_session_cookie(response)
    return {"ok": True}


@app.post("/api/bots")
async def create_bot(payload: dict, user = Depends(current_user)):
    user_id = user["id"]
    name = (payload.get("name") or "").strip() or "Новый бот"
    scenario = payload.get("scenario") or {}

    bot_id = str(uuid.uuid4())

    conn = get_connection()
    try:
        with conn:
            with conn.cursor() as cur:
                try:
                    cur.execute(
                        """
                        INSERT INTO bot_model (id, user_id, name, scenario)
                        VALUES (%s::uuid, %s, %s, %s::jsonb)
                        RETURNING id, name, scenario, created_at, updated_at
                        """,
                        (bot_id, user_id, name, Json(scenario)),
                    )

                except PsycopgError as e:
                    raise HTTPException(
                        status_code=400,
                        detail=f"DB error while creating bot: {e.pgerror or str(e)}"
                    )

                row = cur.fetchone()
    finally:
        conn.close()

    if not row:
        raise HTTPException(status_code=500, detail="Failed to create bot")

    return {
        "id": str(row["id"]),
        "name": row["name"],
        "scenario": row["scenario"],
        "created_at": row["created_at"].isoformat(),
        "updated_at": row["updated_at"].isoformat(),
    }

@app.get("/api/bots")
async def get_bots(user = Depends(current_user)):
    user_id = user["id"]

    conn = get_connection()
    try:
        with conn:
            with conn.cursor() as cur:
                cur.execute(
                    """
                    SELECT id, name, scenario, created_at, updated_at
                    FROM bot_model
                    WHERE user_id = %s
                    ORDER BY created_at DESC
                    """,
                    (user_id,),
                )
                rows = cur.fetchall()
    finally:
        conn.close()

    return [
        {
            "id": str(row["id"]),
            "name": row["name"],
            "scenario": row["scenario"],
            "created_at": row["created_at"].isoformat(),
            "updated_at": row["updated_at"].isoformat(),
        }
        for row in rows
    ]


@app.put("/api/bots/{bot_id}")
async def update_bot(bot_id: str, payload: dict, user = Depends(current_user)):
    user_id = user["id"]
    name = (payload.get("name") or "").strip() or "Без имени"
    scenario = payload.get("scenario") or {}

    conn = get_connection()
    try:
        with conn:
            with conn.cursor() as cur:
                cur.execute(
                    """
                    UPDATE bot_model
                    SET name = %s,
                        scenario = %s,
                        updated_at = now()
                    WHERE id = %s AND user_id = %s
                    RETURNING id, name, scenario, created_at, updated_at
                    """,
                    (name, Json(scenario), bot_id, user_id),
                )

                row = cur.fetchone()
    finally:
        conn.close()

    if not row:
        raise HTTPException(status_code=404, detail="Bot not found")

    return {
        "id": str(row["id"]),
        "name": row["name"],
        "scenario": row["scenario"],
        "created_at": row["created_at"].isoformat(),
        "updated_at": row["updated_at"].isoformat(),
    }


@app.delete("/api/bots/{bot_id}")
async def delete_bot(bot_id: str, user = Depends(current_user)):
    user_id = user["id"]

    conn = get_connection()
    try:
        with conn:
            with conn.cursor() as cur:
                cur.execute(
                    "DELETE FROM bot_model WHERE id = %s AND user_id = %s",
                    (bot_id, user_id),
                )
                if cur.rowcount == 0:
                    raise HTTPException(status_code=404, detail="Bot not found")
    finally:
        conn.close()

    return {"ok": True}
