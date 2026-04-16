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

function normalizeUsername(value: string) {
  return value.trim().replace(/\s+/g, ' ');
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
  let password = '';
  let username = '';

  try {
    const body = await request.json();
    email = String(body?.email ?? '').trim().toLowerCase();
    password = String(body?.password ?? '');
    username = normalizeUsername(String(body?.username ?? ''));
  } catch {
    return jsonResponse({ error: 'Invalid request body' }, 400);
  }

  if (!email || !password || !username) {
    return jsonResponse({ error: 'Email, password and username are required' }, 400);
  }

  if (password.length < 8) {
    return jsonResponse({ error: 'Password must be at least 8 characters long' }, 400);
  }

  if (username.length < 3) {
    return jsonResponse({ error: 'Username must be at least 3 characters long' }, 400);
  }

  const { data: existingUserRows, error: existingUserError } = await supabase.rpc('find_user_for_signup_confirmation', { lookup_email: email });
  if (existingUserError) {
    return jsonResponse({ error: `Could not inspect the signup request: ${existingUserError.message}` }, 500);
  }

  const existingUser = Array.isArray(existingUserRows) ? existingUserRows[0] : existingUserRows;

  if (!existingUser?.user_id) {
    const { data: existingUsernameRows, error: existingUsernameError } = await supabase
      .rpc('find_profile_by_username', { lookup_username: username });

    if (existingUsernameError) {
      return jsonResponse({ error: `Could not validate username: ${existingUsernameError.message}` }, 500);
    }

    if ((existingUsernameRows ?? []).length) {
      return jsonResponse({ error: 'Username-ul este deja folosit' }, 400);
    }
  }

  let userId = existingUser?.user_id as string | undefined;
  let greetingName = existingUser?.full_name?.trim() || existingUser?.username?.trim() || username;

  if (existingUser?.user_id) {
    if (existingUser.email_confirmed_at) {
      return jsonResponse({ error: 'Exista deja un cont cu acest email' }, 400);
    }

    if (existingUser.username && normalizeUsername(existingUser.username) !== username) {
      const { data: usernameRows, error: usernameError } = await supabase
        .rpc('find_profile_by_username', { lookup_username: username });

      if (usernameError) {
        return jsonResponse({ error: `Could not validate username: ${usernameError.message}` }, 500);
      }

      const conflictingUser = Array.isArray(usernameRows) ? usernameRows[0] : null;
      if (conflictingUser?.id && conflictingUser.id !== existingUser.user_id) {
        return jsonResponse({ error: 'Username-ul este deja folosit' }, 400);
      }

      await supabase
        .from('profiles')
        .update({ username, full_name: username })
        .eq('id', existingUser.user_id);

      greetingName = username;
    }

    const { error: updateUserError } = await supabase.auth.admin.updateUserById(existingUser.user_id, {
      password,
      user_metadata: {
        username: existingUser.username && existingUser.username !== username ? username : (existingUser.username ?? username),
        full_name: greetingName,
      },
      email_confirm: false,
    });

    if (updateUserError) {
      return jsonResponse({ error: `Could not update pending account: ${updateUserError.message}` }, 500);
    }
  } else {
    const { data: createdUser, error: createUserError } = await supabase.auth.admin.createUser({
      email,
      password,
      email_confirm: false,
      user_metadata: { username, full_name: username },
    });

    if (createUserError || !createdUser.user?.id) {
      return jsonResponse({ error: createUserError?.message ?? 'Could not create the account' }, 500);
    }

    userId = createdUser.user.id;
    greetingName = username;
  }

  if (!userId) {
    return jsonResponse({ error: 'Could not create the pending account' }, 500);
  }

  const { data: recentCodes } = await supabase
    .from('signup_verification_codes')
    .select('id, created_at')
    .eq('user_id', userId)
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
    .from('signup_verification_codes')
    .update({ used_at: new Date().toISOString() })
    .eq('user_id', userId)
    .is('used_at', null);

  const { error: insertError } = await supabase.from('signup_verification_codes').insert({
    user_id: userId,
    email,
    code_hash: codeHash,
    expires_at: expiresAt,
  });

  if (insertError) {
    return jsonResponse({ error: `Could not create the verification code: ${insertError.message}` }, 500);
  }

  const html = `
    <div style="font-family:Arial,sans-serif;max-width:560px;margin:0 auto;padding:24px;color:#17352D;">
      <h2 style="margin:0 0 12px;">${appName} - Confirmare cont</h2>
      <p style="margin:0 0 12px;">Salut ${greetingName},</p>
      <p style="margin:0 0 12px;">Codul tau pentru confirmarea contului este:</p>
      <div style="font-size:32px;font-weight:800;letter-spacing:6px;padding:16px 20px;background:#EAF7F1;border-radius:14px;text-align:center;margin:16px 0;">${code}</div>
      <p style="margin:0 0 8px;">Codul expira in 15 minute.</p>
      <p style="margin:0;color:#5B6B66;">Introdu acest cod direct in aplicatia mobila pentru a activa contul.</p>
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
      subject: `${appName} - Cod confirmare cont`,
      html,
    }),
  });

  if (!resendResponse.ok) {
    const resendErrorText = await resendResponse.text();
    await supabase
      .from('signup_verification_codes')
      .delete()
      .eq('user_id', userId)
      .eq('code_hash', codeHash);

    return jsonResponse({
      error: resendErrorText
        ? `Could not send the confirmation email: ${resendErrorText}`
        : `Could not send the confirmation email: provider returned ${resendResponse.status}`,
    }, 500);
  }

  return jsonResponse({ success: true });
});