import { createClient } from '@supabase/supabase-js';
import fs from 'fs';
import path from 'path';

require('dotenv').config({ path: '.env.local' });

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseKey) {
    console.error("Missing Supabase credentials in .env.local");
    process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseKey);

async function runMigration() {
    const sqlPath = path.join(__dirname, 'supabase', 'migrations', '20240304_matchmaking_queue.sql');
    const sql = fs.readFileSync(sqlPath, 'utf8') + `
-- Phase 2: Matches Record Table
CREATE TABLE IF NOT EXISTS public.matches (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    winner_address TEXT NOT NULL,
    room_code TEXT NOT NULL,
    game_mode TEXT NOT NULL,
    participants JSONB NOT NULL,
    created_at TIMESTAMPTZ DEFAULT NOW()
);
  `;

    console.log("Running SQL Migration...");
    // Use RPC to execute raw SQL (requires a helper function on supabase usually, or REST)
    // Since we might not have 'exec_sql', we'll try the standard approach, 
    // but Supabase JS doesn't have a direct 'run raw SQL' without a postgres function.
    // Instead, we will print a message for the user.
    console.log("Raw SQL execution via REST is restricted by Supabase for security.");
    console.log("Please paste the contents of implementation_plan.md into your Supabase SQL Editor.");
}

runMigration();
