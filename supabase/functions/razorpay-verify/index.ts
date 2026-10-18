// supabase/functions/razorpay-verify/index.ts
// Verifies the Razorpay payment signature using HMAC-SHA256,
// then finalizes the payment by calling process_payment RPC.

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { verify } from "https://deno.land/x/djwt@v2.9.1/mod.ts";

/**
 * Compute HMAC-SHA256 using Web Crypto API (available natively in Deno).
 * Returns the hex-encoded digest.
 */
async function hmacSha256Hex(
  secret: string,
  message: string
): Promise<string> {
  const encoder = new TextEncoder();

  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );

  const signature = await crypto.subtle.sign(
    "HMAC",
    key,
    encoder.encode(message)
  );

  return Array.from(new Uint8Array(signature))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

serve(async (req) => {
  const origin = req.headers.get("origin") || "*";
  
  const corsHeaders = {
    "Access-Control-Allow-Origin": origin,
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
  };

  // Handle CORS preflight
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    // ── AUTH CHECK (Local verification to avoid API roundtrip) ──
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      return new Response(
        JSON.stringify({ success: false, error: "Missing authorization header" }),
        { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const token = authHeader.replace("Bearer ", "");
    const jwtSecret = Deno.env.get("SUPABASE_JWT_SECRET");
    
    if (jwtSecret) {
      try {
        const encoder = new TextEncoder();
        const key = await crypto.subtle.importKey(
          "raw",
          encoder.encode(jwtSecret),
          { name: "HMAC", hash: "SHA-256" },
          false,
          ["verify"]
        );
        await verify(token, key);
      } catch (e) {
        return new Response(
          JSON.stringify({ success: false, error: "Unauthorized: invalid or expired session" }),
          { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }
    } else {
      const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
      const supabaseAnonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
      const supabaseAuth = createClient(supabaseUrl, supabaseAnonKey, {
        global: { headers: { Authorization: authHeader } },
      });
      const { data: { user }, error: authError } = await supabaseAuth.auth.getUser();
      if (authError || !user) {
        return new Response(
          JSON.stringify({ success: false, error: "Unauthorized: invalid or expired session" }),
          { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }
    }
    // ── END AUTH CHECK ─────────────────────────────────────────

    const {
      razorpay_order_id,
      razorpay_payment_id,
      razorpay_signature,
    } = await req.json();

    if (!razorpay_order_id || !razorpay_payment_id || !razorpay_signature) {
      throw new Error(
        "Missing required fields: razorpay_order_id, razorpay_payment_id, razorpay_signature"
      );
    }

    const razorpayKeySecret = Deno.env.get("RAZORPAY_KEY_SECRET");
    if (!razorpayKeySecret) {
      throw new Error("Razorpay key secret not configured on the server");
    }

    const expectedSignature = await hmacSha256Hex(
      razorpayKeySecret,
      `${razorpay_order_id}|${razorpay_payment_id}`
    );

    if (expectedSignature !== razorpay_signature) {
      throw new Error("Payment signature verification failed — possible tampering");
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    // ── Atomic TOCTOU Check ───────────────────────────────────
    // Atomically claim this payment intent to process it
    const { data: record, error: claimError } = await supabase
      .from("payment_intents")
      .update({ status: 'processing' })
      .eq("gateway_order_id", razorpay_order_id)
      .eq("status", "pending")
      .select("*")
      .single();

    if (claimError || !record) {
      // Check if it's already successful → idempotent replay
      const { data: existing } = await supabase
        .from("payment_intents")
        .select("*")
        .eq("gateway_order_id", razorpay_order_id)
        .single();

      if (existing && existing.status === "success") {
        // Return the original transaction (+ its receipt number if allocated)
        let transactionId = existing.id;
        let receiptNo = null;
        const { data: txn } = await supabase
          .from("transactions")
          .select("id, receipt_id")
          .eq("idempotency_key", razorpay_payment_id)
          .maybeSingle();
        if (txn) {
          transactionId = txn.id;
          if (txn.receipt_id) {
            const { data: rc } = await supabase
              .from("receipts")
              .select("receipt_no")
              .eq("id", txn.receipt_id)
              .maybeSingle();
            receiptNo = rc?.receipt_no ?? null;
          }
        }
        return new Response(
          JSON.stringify({
            success: true,
            message: "Payment already processed",
            transaction_id: transactionId,
            receipt_no: receiptNo,
          }),
          { headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }
      throw new Error(`Failed to claim payment intent for order ${razorpay_order_id}`);
    }

    // ── Call process_payment RPC ──────────────────────────────
    const allocations =
      typeof record.allocations === "string"
        ? JSON.parse(record.allocations)
        : record.allocations;

    const rpcPayload = {
      p_student_id: record.student_id,
      p_amount: record.amount,
      p_payment_method: "razorpay",
      p_reference_id: razorpay_payment_id,
      p_comment: `Razorpay Online Payment (${razorpay_order_id})`,
      p_date: new Date().toISOString().split("T")[0],
      p_allocations: allocations,
      // Idempotent retry: same payment_id never creates a 2nd transaction
      p_idempotency_key: razorpay_payment_id,
    };

    const { data: rpcData, error: rpcError } = await supabase.rpc(
      "process_payment",
      rpcPayload
    );

    if (rpcError) {
      console.error("RPC process_payment error:", rpcError);
      await supabase
        .from("payment_intents")
        .update({ status: "failed" })
        .eq("id", record.id);
      throw new Error(`Payment processing failed: ${rpcError.message}`);
    }

    // ── Mark intent as successful ────────────────────────────
    await supabase
      .from("payment_intents")
      .update({ status: "success" })
      .eq("id", record.id);

    // ── Attach an AY-scoped receipt number (best-effort) ─────
    // The payment is already committed; if receipt allocation fails we
    // still return success — a later finalize_transaction_receipt() call
    // backfills it from the Payments screen / admin console.
    let receiptNo: string | null = null;
    try {
      const { data: rcpt, error: rcptError } = await supabase.rpc(
        "finalize_transaction_receipt",
        {
          p_transaction_id: rpcData?.transaction_id,
          p_collected_by: "razorpay-auto",
        }
      );
      if (rcptError) {
        console.error("finalize_transaction_receipt error:", rcptError);
      } else {
        receiptNo = rcpt?.receipt_no ?? null;
      }
    } catch (rcptErr) {
      console.error("finalize_transaction_receipt failed:", rcptErr);
    }

    return new Response(
      JSON.stringify({
        success: true,
        transaction_id: rpcData?.transaction_id,
        cleared_dues: rpcData?.cleared_dues || [],
        receipt_no: receiptNo,
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (err: any) {
    console.error("razorpay-verify error:", err);
    return new Response(
      JSON.stringify({ success: false, error: err.message }),
      {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  }
});
