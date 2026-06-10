import json
from ..db import get_connection

def get_session_scenario_id(session_id: str) -> str:
    """Возвращает ID бота (scenario_id) по ID сессии"""
    conn = get_connection()
    try:
        with conn:
            with conn.cursor() as cur:
                cur.execute("SELECT scenario_id FROM edit_sessions WHERE id = %s", (session_id,))
                row = cur.fetchone()
                return str(row["scenario_id"]) if row else None
    finally:
        conn.close()

def get_current_scenario_version(scenario_id: str) -> int:
    conn = get_connection()
    try:
        with conn:
            with conn.cursor() as cur:
                cur.execute("SELECT version FROM edit_sessions WHERE scenario_id = %s", (scenario_id,))
                row = cur.fetchone()
                return row["version"] if row else 0
    finally:
        conn.close()

def update_scenario_version(scenario_id: str, new_version: int):
    """Теперь это строгий UPDATE. Создание сессии происходит только через API."""
    conn = get_connection()
    try:
        with conn:
            with conn.cursor() as cur:
                cur.execute(
                    "UPDATE edit_sessions SET version = %s WHERE scenario_id = %s",
                    (new_version, scenario_id)
                )
    finally:
        conn.close()

def save_operation(scenario_id: str, user_id: int, version: int, op_type: str, op_data: dict):
    conn = get_connection()
    try:
        with conn:
            with conn.cursor() as cur:
                cur.execute(
                    """
                    INSERT INTO operation_log (op_id, scenario_id, user_id, version, op_type, op_data)
                    VALUES (%s, %s, %s, %s, %s, %s)
                    """,
                    (op_data.get("op_id"), scenario_id, user_id, version, op_type, json.dumps(op_data))
                )
    finally:
        conn.close()

def get_operations_since_version(scenario_id: str, version: int) -> list:
    conn = get_connection()
    try:
        with conn:
            with conn.cursor() as cur:
                cur.execute(
                    """
                    SELECT op_type, op_data FROM operation_log 
                    WHERE scenario_id = %s AND version > %s 
                    ORDER BY version ASC
                    """,
                    (scenario_id, version)
                )
                rows = cur.fetchall()
                return [{"op_type": r["op_type"], "data": r["op_data"]} for r in rows]
    finally:
        conn.close()