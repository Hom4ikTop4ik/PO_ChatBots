def noop(op: dict, reason):
    """Возвращает операцию-заглушку, которую клиент должен проигнорировать"""
    return {"op_id": op.get("op_id"), "op_type": "noop", "reason": reason}

def transform(op_new, op_old):
    """
    op_new: новая операция, пришедшая от клиента
    op_old: уже примененная операция, которая была выполнена между созданием op_new и сейчас
    """
    
    # Если разные цели — конфликта нет
    if op_new.get("data", {}).get("block_id") != op_old.get("data", {}).get("block_id"):
        return op_new

    # Если оба перемещают блок — побеждает последний (Last-write-wins)
    if op_new.get("op_type") == "BLOCK_MOVE" and op_old.get("op_type") == "BLOCK_MOVE":
        return op_new

    # Правка удаленного блока — отклоняется
    if op_old.get("op_type") == "BLOCK_DELETE" and op_new.get("op_type") == "BLOCK_UPDATE":
        return noop(op_new, reason="target_deleted")

    # Связь с удаленным блоком — отклоняется
    if op_old.get("op_type") == "BLOCK_DELETE" and op_new.get("op_type") == "EDGE_ADD":
        if op_old.get("data", {}).get("block_id") in [op_new.get("data", {}).get("source_id"), op_new.get("data", {}).get("target_id")]:
            return noop(op_new, reason="endpoint_deleted")

    return op_new
