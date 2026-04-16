const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

function jsonResponse(body: Record<string, unknown>, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      ...corsHeaders,
      'Content-Type': 'application/json',
    },
  });
}

async function sha256(value: string) {
  const data = new TextEncoder().encode(value);
  const hashBuffer = await crypto.subtle.digest('SHA-256', data);
  return Array.from(new Uint8Array(hashBuffer)).map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

Deno.serve(async (request) => {
  if (request.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  if (request.method !== 'POST') {
    return jsonResponse({ error: 'Method not allowed' }, 405);
  }

  const supabaseUrl = Deno.env.get('SUPABASE_URL');
  const serviceRoleKey = Deno.env.get('SERVICE_ROLE_KEY') ?? Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');

  if (!supabaseUrl || !serviceRoleKey) {
    const missing = [
      !supabaseUrl ? 'SUPABASE_URL' : null,
      !serviceRoleKey ? 'SERVICE_ROLE_KEY' : null,
    ].filter(Boolean);
    return jsonResponse({ error: `Missing server configuration: ${missing.join(', ')}` }, 500);
  }

  const { createClient } = await import('npm:@supabase/supabase-js@2');
  const supabase = createClient(supabaseUrl, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  let email = '';
  let code = '';

  try {
    const body = await request.json();
    email = String(body?.email ?? '').trim().toLowerCase();
    code = String(body?.code ?? '').trim();
  } catch {
    return jsonResponse({ error: 'Invalid request body' }, 400);
  }

  if (!email || !code) {
    return jsonResponse({ error: 'Email and code are required' }, 400);
  }

  const { data: userRows, error: userError } = await supabase.rpc('find_user_for_signup_confirmation', { lookup_email: email });
  if (userError) {
    return jsonResponse({ error: `Could not validate the account: ${userError.message}` }, 500);
  }

  const user = Array.isArray(userRows) ? userRows[0] : userRows;
  if (!user?.user_id) {
    return jsonResponse({ error: 'Invalid or expired code' }, 400);
  }

  if (user.email_confirmed_at) {
    return jsonResponse({ success: true });
  }

  const codeHash = await sha256(code);
  const nowIso = new Date().toISOString();

  const { data: matchingCodes, error: codeError } = await supabase
    .from('signup_verification_codes')
    .select('id')
    .eq('user_id', user.user_id)
    .eq('email', email)
    .eq('code_hash', codeHash)
    .is('used_at', null)
    .gt('expires_at', nowIso)
    .order('created_at', { ascending: false })
    .limit(1);

  if (codeError) {
    return jsonResponse({ error: `Could not validate the code: ${codeError.message}` }, 500);
  }

  const matchingCode = matchingCodes?.[0];
  if (!matchingCode?.id) {
    return jsonResponse({ error: 'Invalid or expired code' }, 400);
  }

  const { error: markUsedError } = await supabase
    .from('signup_verification_codes')
    .update({ used_at: nowIso })
    .eq('id', matchingCode.id)
    .is('used_at', null);

  if (markUsedError) {
    return jsonResponse({ error: `Could not consume the code: ${markUsedError.message}` }, 500);
  }

  const { error: updateError } = await supabase.auth.admin.updateUserById(user.user_id, {
    email_confirm: true,
  });

  if (updateError) {
    return jsonResponse({ error: updateError.message }, 500);
  }

  await supabase
    .from('signup_verification_codes')
    .update({ used_at: nowIso })
    .eq('user_id', user.user_id)
    .is('used_at', null);

  return jsonResponse({ success: true });
});