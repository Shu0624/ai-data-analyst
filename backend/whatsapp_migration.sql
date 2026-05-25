-- WhatsApp Chatbot — Database Migration
-- Run this AFTER the base schema is created (supabase_schema.sql)
-- These tables extend the AI Data Analyst platform with WhatsApp automation

-- ==========================================
-- 15. CLIENTS (WhatsApp Business Owners)
-- ==========================================
CREATE TABLE IF NOT EXISTS clients (
    id                UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
    user_id           UUID REFERENCES users(id) ON DELETE CASCADE NOT NULL,
    business_name     VARCHAR(200) NOT NULL,
    niche             VARCHAR(50) NOT NULL,         -- gym | coaching | clinic | realestate | d2c | other
    whatsapp_number   VARCHAR(20) NOT NULL UNIQUE,
    document_id       UUID REFERENCES documents(id) ON DELETE SET NULL,
    greeting_message  TEXT,                          -- Custom greeting when customer says "Hi"
    qualification_flow JSONB,                        -- Chatbot flow config (future use)
    is_active         BOOLEAN NOT NULL DEFAULT TRUE,
    created_at        TIMESTAMP NOT NULL DEFAULT NOW(),
    updated_at        TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_clients_user_id ON clients(user_id);
CREATE INDEX idx_clients_whatsapp ON clients(whatsapp_number);

-- ==========================================
-- 16. LEADS (Captured from WhatsApp)
-- ==========================================
CREATE TABLE IF NOT EXISTS leads (
    id              UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
    client_id       UUID REFERENCES clients(id) ON DELETE CASCADE NOT NULL,
    phone           VARCHAR(20) NOT NULL,
    name            VARCHAR(100),
    interest        VARCHAR(100),
    status          VARCHAR(20) NOT NULL DEFAULT 'new',     -- new | contacted | qualified | converted | lost
    source          VARCHAR(50) NOT NULL DEFAULT 'whatsapp',
    lead_score      INTEGER,                                 -- 0-100 AI-generated quality score
    last_message_at TIMESTAMP,
    created_at      TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_leads_client_id ON leads(client_id);
CREATE INDEX idx_leads_phone ON leads(phone);
CREATE INDEX idx_leads_status ON leads(status);
CREATE INDEX idx_leads_created ON leads(created_at DESC);

-- Composite unique: one lead per phone per client
CREATE UNIQUE INDEX idx_leads_client_phone ON leads(client_id, phone);

-- ==========================================
-- 17. LEAD MESSAGES (WhatsApp Conversation Log)
-- ==========================================
CREATE TABLE IF NOT EXISTS lead_messages (
    id            UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
    lead_id       UUID REFERENCES leads(id) ON DELETE CASCADE NOT NULL,
    direction     VARCHAR(10) NOT NULL,              -- inbound | outbound
    message_text  TEXT NOT NULL,
    message_type  VARCHAR(20) NOT NULL DEFAULT 'text', -- text | button_reply | image | template
    wa_message_id VARCHAR(100),                       -- WhatsApp message ID for delivery tracking
    created_at    TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_lead_messages_lead_id ON lead_messages(lead_id);
CREATE INDEX idx_lead_messages_created ON lead_messages(created_at DESC);

-- ==========================================
-- USEFUL VIEWS
-- ==========================================

-- Client dashboard summary view
CREATE OR REPLACE VIEW client_lead_summary AS
SELECT
    c.id AS client_id,
    c.business_name,
    c.niche,
    COUNT(l.id) AS total_leads,
    COUNT(l.id) FILTER (WHERE l.status = 'new') AS new_leads,
    COUNT(l.id) FILTER (WHERE l.status = 'contacted') AS contacted_leads,
    COUNT(l.id) FILTER (WHERE l.status = 'qualified') AS qualified_leads,
    COUNT(l.id) FILTER (WHERE l.status = 'converted') AS converted_leads,
    COUNT(l.id) FILTER (WHERE l.status = 'lost') AS lost_leads,
    COUNT(l.id) FILTER (WHERE l.created_at >= NOW() - INTERVAL '1 day') AS leads_today,
    COUNT(l.id) FILTER (WHERE l.created_at >= NOW() - INTERVAL '7 days') AS leads_this_week,
    CASE WHEN COUNT(l.id) > 0
        THEN ROUND(COUNT(l.id) FILTER (WHERE l.status = 'converted')::NUMERIC / COUNT(l.id) * 100, 1)
        ELSE 0
    END AS conversion_rate_pct
FROM clients c
LEFT JOIN leads l ON l.client_id = c.id
GROUP BY c.id, c.business_name, c.niche;

-- Daily lead report view
CREATE OR REPLACE VIEW daily_lead_report AS
SELECT
    c.id AS client_id,
    c.business_name,
    DATE(l.created_at) AS lead_date,
    COUNT(l.id) AS leads_count,
    COUNT(DISTINCT l.phone) AS unique_phones
FROM clients c
LEFT JOIN leads l ON l.client_id = c.id
WHERE l.created_at >= NOW() - INTERVAL '30 days'
GROUP BY c.id, c.business_name, DATE(l.created_at)
ORDER BY lead_date DESC;
