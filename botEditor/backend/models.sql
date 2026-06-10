
CREATE TABLE IF NOT EXISTS app_user (
    id          SERIAL PRIMARY KEY,
    email       TEXT NOT NULL UNIQUE,
    password_hash TEXT NOT NULL,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS bot_model (
    id          UUID PRIMARY KEY,
    user_id     INTEGER NOT NULL REFERENCES app_user(id) ON DELETE CASCADE,
    name        TEXT NOT NULL,
    scenario    JSONB NOT NULL,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_bot_model_user_id ON bot_model(user_id);



CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- Добавим версионирование в bot_model
ALTER TABLE bot_model ADD COLUMN IF NOT EXISTS version INT NOT NULL DEFAULT 0;

-- Активные сессии совместного редактирования
CREATE TABLE IF NOT EXISTS edit_sessions (
    id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    scenario_id UUID NOT NULL REFERENCES bot_model(id) ON DELETE CASCADE,
    version     INT NOT NULL DEFAULT 0,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE(scenario_id)
);

CREATE TABLE IF NOT EXISTS operation_log (
    op_id       UUID PRIMARY KEY,
    scenario_id UUID NOT NULL REFERENCES bot_model(id) ON DELETE CASCADE,
    user_id     INTEGER NOT NULL REFERENCES app_user(id),
    version     INT NOT NULL,
    op_type     VARCHAR(32) NOT NULL,
    op_data     JSONB NOT NULL,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE(scenario_id, version)
);

CREATE TABLE IF NOT EXISTS session_participants (
    session_id  UUID REFERENCES edit_sessions(id) ON DELETE CASCADE,
    user_id     INTEGER REFERENCES app_user(id) ON DELETE CASCADE,
    joined_at   TIMESTAMPTZ DEFAULT now(),
    status      VARCHAR(16) DEFAULT 'active',
    PRIMARY KEY (session_id, user_id)
);

CREATE TABLE IF NOT EXISTS field_locks (
    block_id    UUID NOT NULL,
    field_name  VARCHAR(64) NOT NULL,
    locked_by   INTEGER REFERENCES app_user(id) ON DELETE CASCADE,
    acquired_at TIMESTAMPTZ DEFAULT now(),
    PRIMARY KEY (block_id, field_name)
);
