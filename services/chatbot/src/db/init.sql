-- ============================================================
-- Service 8: AI Chatbot — chatbot_db
-- Port: 3008
-- ============================================================

CREATE TABLE IF NOT EXISTS chat_session (
    id BIGINT PRIMARY KEY GENERATED ALWAYS AS IDENTITY,
    user_id BIGINT NOT NULL,
    user_type TEXT NOT NULL DEFAULT 'customer'
        CHECK (user_type IN ('customer', 'employee')),
    store_id BIGINT,
    started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    ended_at TIMESTAMPTZ,
    is_active BOOLEAN NOT NULL DEFAULT TRUE
);

CREATE TABLE IF NOT EXISTS chat_message (
    id BIGINT PRIMARY KEY GENERATED ALWAYS AS IDENTITY,
    session_id BIGINT NOT NULL REFERENCES chat_session(id),
    role TEXT NOT NULL CHECK (role IN ('user', 'assistant', 'system')),
    content TEXT NOT NULL,
    intent TEXT,
    metadata JSONB,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_chat_session_user ON chat_session(user_id);
CREATE INDEX IF NOT EXISTS idx_chat_session_active ON chat_session(is_active) WHERE is_active = TRUE;
CREATE INDEX IF NOT EXISTS idx_chat_message_session ON chat_message(session_id);
