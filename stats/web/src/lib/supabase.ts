import { createClient } from '@supabase/supabase-js';
import { env } from '$env/dynamic/public';

export function db() {
  const url = env.PUBLIC_SUPABASE_URL;
  const key = env.PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !key) throw new Error('PUBLIC_SUPABASE_URL och PUBLIC_SUPABASE_ANON_KEY saknas');
  return createClient(url, key, { auth: { persistSession: false } });
}
