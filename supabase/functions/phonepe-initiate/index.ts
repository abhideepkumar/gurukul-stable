import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS'
};

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const { student_id, amount, allocations, mobile } = await req.json();

    if (!student_id || !amount || !allocations) throw new Error("Missing required fields");
    if (amount <= 0) throw new Error("Amount must be greater than 0");
    const mobileStr = mobile || "9999999999";

    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseKey = Deno.env.get('SUPABASE_ANON_KEY')!; // Note: could use ANON since permissions allow INSERT
    const supabase = createClient(supabaseUrl, supabaseKey);

    // Create payment intent
    const { data: intentData, error: intentError } = await supabase
      .from('payment_intents')
      .insert({ student_id, amount, allocations })
      .select()
      .single();

    if (intentError) throw new Error(intentError.message);
    
    const merchantTransactionId = intentData.id;

    const paymentPayload = {
      merchantId: Deno.env.get('PHONEPE_MERCHANT_ID'),
      merchantTransactionId,
      merchantUserId: `MUID_${student_id.slice(0, 8)}`,
      amount: Math.round(amount * 100), // in paise
      redirectUrl: `${Deno.env.get('SUPABASE_URL')}/functions/v1/phonepe-callback/${merchantTransactionId}`,
      redirectMode: "POST",
      mobileNumber: mobileStr,
      paymentInstrument: { type: "PAY_PAGE" }
    };

    const base64Payload = btoa(JSON.stringify(paymentPayload));
    const saltKey = Deno.env.get('PHONEPE_SALT_KEY');
    const keyIndex = Deno.env.get('PHONEPE_SALT_INDEX') || 1;

    // Fast webcrypto for Deno
    const toSign = `${base64Payload}/pg/v1/pay${saltKey}`;
    const hash = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(toSign));
    const checksum = `${Array.from(new Uint8Array(hash)).map(b => b.toString(16).padStart(2, '0')).join('')}###${keyIndex}`;

    const phonepeBase = Deno.env.get('PHONEPE_ENV') === 'production'
      ? 'https://api.phonepe.com/apis/hermes'
      : 'https://api-preprod.phonepe.com/apis/pg-sandbox';

    const res = await fetch(`${phonepeBase}/pg/v1/pay`, {
      method: "POST",
      headers: {
        accept: "application/json",
        "Content-Type": "application/json",
        "X-VERIFY": checksum
      },
      body: JSON.stringify({ request: base64Payload })
    });

    const result = await res.json();
    if (!res.ok) throw new Error(result.message || "Payment initiation failed");

    return new Response(JSON.stringify({
      success: true,
      redirectUrl: result.data.instrumentResponse.redirectInfo.url,
      transaction_id: merchantTransactionId
    }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });

  } catch (err: any) {
    console.error(err);
    return new Response(JSON.stringify({ success: false, error: err.message }), {
      status: 400,
      headers: { ...corsHeaders, "Content-Type": "application/json" }
    });
  }
});
