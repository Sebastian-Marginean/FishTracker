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

function generateCode() {
  return String(Math.floor(100000 + Math.random() * 900000));
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
  const resendApiKey = Deno.env.get('RESEND_API_KEY');
  const resetEmailFrom = Deno.env.get('RESET_EMAIL_FROM') ?? 'FishTracker <onboarding@resend.dev>';
  const appName = Deno.env.get('APP_NAME') ?? 'FishTracker';

  if (!supabaseUrl || !serviceRoleKey || !resendApiKey) {
    const missing = [
      !supabaseUrl ? 'SUPABASE_URL' : null,
      !serviceRoleKey ? 'SERVICE_ROLE_KEY' : null,
      !resendApiKey ? 'RESEND_API_KEY' : null,
    ].filter(Boolean);
    return jsonResponse({ error: `Missing server configuration: ${missing.join(', ')}` }, 500);
  }

  const { createClient } = await import('npm:@supabase/supabase-js@2');
  const supabase = createClient(supabaseUrl, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  let email = '';

  try {
    const body = await request.json();
    email = String(body?.email ?? '').trim().toLowerCase();
  } catch {
    return jsonResponse({ error: 'Invalid request body' }, 400);
  }

  if (!email) {
    return jsonResponse({ error: 'Email is required' }, 400);
  }

  const { data: userRows, error: userError } = await supabase.rpc('find_user_for_password_reset', { lookup_email: email });
  if (userError) {
    return jsonResponse({ error: `Could not process reset request: ${userError.message}` }, 500);
  }

  const user = Array.isArray(userRows) ? userRows[0] : userRows;

  // Generic success to avoid leaking whether the email exists.
  if (!user?.user_id) {
    return jsonResponse({ success: true });
  }

  const { data: recentCodes } = await supabase
    .from('password_reset_codes')
    .select('id, created_at')
    .eq('user_id', user.user_id)
    .order('created_at', { ascending: false })
    .limit(1);

  const latestRequest = recentCodes?.[0];
  if (latestRequest) {
    const elapsedMs = Date.now() - new Date(latestRequest.created_at).getTime();
    if (elapsedMs < 60_000) {
      return jsonResponse({ error: 'Too many requests. Wait a bit and try again.' }, 429);
    }
  }

  const code = generateCode();
  const codeHash = await sha256(code);
  const expiresAt = new Date(Date.now() + 15 * 60_000).toISOString();

  await supabase
    .from('password_reset_codes')
    .update({ used_at: new Date().toISOString() })
    .eq('user_id', user.user_id)
    .is('used_at', null);

  const { error: insertError } = await supabase.from('password_reset_codes').insert({
    user_id: user.user_id,
    email,
    code_hash: codeHash,
    expires_at: expiresAt,
  });

  if (insertError) {
    return jsonResponse({ error: `Could not create reset code: ${insertError.message}` }, 500);
  }

  const greetingName = user.full_name?.trim() || user.username?.trim() || user.email;
  const html = `
    <div style="font-family:Arial,sans-serif;max-width:560px;margin:0 auto;padding:24px;color:#17352D;">
      <h2 style="margin:0 0 12px;">${appName} - Resetare parola</h2>
      <p style="margin:0 0 12px;">Salut ${greetingName},</p>
      <p style="margin:0 0 12px;">Codul tau pentru resetarea parolei este:</p>
      <div style="font-size:32px;font-weight:800;letter-spacing:6px;padding:16px 20px;background:#EAF7F1;border-radius:14px;text-align:center;margin:16px 0;">${code}</div>
      <p style="margin:0 0 8px;">Codul expira in 15 minute.</p>
      <p style="margin:0;color:#5B6B66;">Introdu acest cod direct in aplicatia mobila, la resetarea parolei.</p>
    </div>
  `;

  const resendResponse = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${resendApiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      from: resetEmailFrom,
      to: [email],
      subject: `${appName} - Cod resetare parola`,
      html,
    }),
  });

  if (!resendResponse.ok) {
    const resendErrorText = await resendResponse.text();
    await supabase
      .from('password_reset_codes')
      .delete()
      .eq('user_id', user.user_id)
      .eq('code_hash', codeHash);

    return jsonResponse({
      error: resendErrorText
        ? `Could not send reset email: ${resendErrorText}`
        : `Could not send reset email: provider returned ${resendResponse.status}`,
    }, 500);
  }

  return jsonResponse({ success: true });
});