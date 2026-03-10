-- Job queue for background rescoring (processed by Railway scheduler)
CREATE TABLE IF NOT EXISTS rescore_jobs (
    id          BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    job_type    TEXT NOT NULL DEFAULT 'full',      -- 'full' | 'single' | 'stale'
    address     TEXT,                               -- NULL for full/stale, specific for single
    status      TEXT NOT NULL DEFAULT 'pending',    -- 'pending' | 'running' | 'completed' | 'failed'
    progress    INTEGER DEFAULT 0,                  -- wallets scored so far
    total       INTEGER DEFAULT 0,                  -- total wallets to score
    error       TEXT,
    created_at  TIMESTAMPTZ DEFAULT now(),
    updated_at  TIMESTAMPTZ DEFAULT now()
);

-- RLS: anyone can read + insert (dashboard uses anon key), service key can update
ALTER TABLE rescore_jobs ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Public read rescore_jobs" ON rescore_jobs FOR SELECT USING (true);
CREATE POLICY "Public insert rescore_jobs" ON rescore_jobs FOR INSERT WITH CHECK (true);
CREATE POLICY "Service update rescore_jobs" ON rescore_jobs FOR UPDATE USING (true);
CREATE POLICY "Service delete rescore_jobs" ON rescore_jobs FOR DELETE USING (true);
