import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS'
};

const MERCHANT_ID = Deno.env.get('PHONEPE_MERCHANT_ID')!;
const MERCHANT_KEY = Deno.env.get('PHONEPE_SALT_KEY')!;
const SALT_INDEX = Deno.env.get('PHONEPE_SALT_INDEX') || '1';

const STATUS_URL = Deno.env.get('PHONEPE_ENV') === 'production'
  ? 'https://api.phonepe.com/apis/hermes/pg/v1/status'
  : 'https://api-preprod.phonepe.com/apis/pg-sandbox/pg/v1/status';

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const url = new URL(req.url);
    const merchantTransactionId = url.pathname.split('/').pop();
    if (!merchantTransactionId) throw new Error("Missing transaction ID");

    // Phonepe S2S callback might be a POST with payload, but the redirect URL is a GET or POST.
    // The typical way is to check the status utilizing the transaction ID securely on the backend.
    const stringToSign = `/pg/v1/status/${MERCHANT_ID}/${merchantTransactionId}${MERCHANT_KEY}`;
    const hash = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(stringToSign));
    const checksum = `${Array.from(new Uint8Array(hash)).map(b => b.toString(16).padStart(2, "0")).join("")}###${SALT_INDEX}`;

    const response = await fetch(`${STATUS_URL}/${MERCHANT_ID}/${merchantTransactionId}`, {
      method: "GET",
      headers: {
        accept: "application/json",
        "Content-Type": "application/json",
        "X-VERIFY": checksum,
        "X-MERCHANT-ID": MERCHANT_ID
      }
    });

    const result = await response.json();
    console.log("PhonePe Status Response:", result);

    const isSuccess = response.ok && result.success && result.code === 'PAYMENT_SUCCESS';

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseServiceRole = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseServiceRole);

    const { data: record, error } = await supabase
      .from("payment_intents")
      .select("*")
      .eq("id", merchantTransactionId)
      .single();

    if (error || !record) throw new Error("No payment record found");

    if (record.status !== 'pending') {
         // Already processed
         const clientRedirect = `${req.headers.get('origin') || Deno.env.get('FRONTEND_URL') || 'http://localhost:5173'}/payments?payment_status=${record.status}&order_id=${merchantTransactionId}`;
         return new Response(null, { status: 302, headers: { ...corsHeaders, Location: clientRedirect } });
    }

    if (isSuccess) {
      // Process successful payment
      await supabase.from('payment_intents').update({ status: 'success' }).eq('id', record.id);
      
      const rpcPayload = {
        p_student_id: record.student_id,
        p_amount: record.amount,
        p_payment_method: 'online',
        p_reference_id: result.data?.transactionId || merchantTransactionId,
        p_comment: `PhonePe Online Payment`,
        p_date: new Date().toISOString().split('T')[0],
        p_allocations: typeof record.allocations === 'string' ? JSON.parse(record.allocations) : record.allocations
      };

      const { data: rpcData, error: rpcError } = await supabase.rpc('process_payment', rpcPayload);
      if (rpcError) {
        console.error("RPC Error processing successful payment:", rpcError);
        // We still consider it paid from PhonePe's side, but internal error tracking may be required.
      }
    } else if (result.code === 'PAYMENT_FAILED' || result.success === false) {
      await supabase.from('payment_intents').update({ status: 'failed' }).eq('id', record.id);
    }

    const finalStatus = isSuccess ? 'success' : 'failed';
    // Redirect to frontend
    // Assuming Frontend URL is where the request originated or set in env
    const clientRedirect = `${req.headers.get('origin') || Deno.env.get('FRONTEND_URL') || 'http://localhost:5173'}/payments?payment_status=${finalStatus}&order_id=${merchantTransactionId}`;
    return new Response(null, { status: 302, headers: { ...corsHeaders, Location: clientRedirect } });

  } catch (err: any) {
    console.error(err);
    return new Response(JSON.stringify({ success: false, error: err.message }), {
      status: 400,
      headers: { ...corsHeaders, "Content-Type": "application/json" }
    });
  }
});
