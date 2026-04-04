// supabase/functions/razorpay-verify/index.ts
// Verifies the Razorpay payment signature using HMAC-SHA256,
// then finalizes the payment by calling process_payment RPC.

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

/**
 * Compute HMAC-SHA256 using Web Crypto API (available natively in Deno).
 * Returns the hex-encoded digest.
 */
async function hmacSha256Hex(
  secret: string,
  message: string
): Promise<string> {
  const encoder = new TextEncoder();

  // Import the secret as a CryptoKey
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );

  // Sign the message
  const signature = await crypto.subtle.sign(
    "HMAC",
    key,
    encoder.encode(message)
  );

  // Convert ArrayBuffer to hex string
  return Array.from(new Uint8Array(signature))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

serve(async (req) => {
  // Handle CORS preflight
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const {
      razorpay_order_id,
      razorpay_payment_id,
      razorpay_signature,
    } = await req.json();

    // ── Validate inputs ──────────────────────────────────────
    if (!razorpay_order_id || !razorpay_payment_id || !razorpay_signature) {
      throw new Error(
        "Missing required fields: razorpay_order_id, razorpay_payment_id, razorpay_signature"
      );
    }

    // ── Read secrets ─────────────────────────────────────────
    const razorpayKeySecret = Deno.env.get("RAZORPAY_KEY_SECRET");
    if (!razorpayKeySecret) {
      throw new Error("Razorpay key secret not configured on the server");
    }

    // ── Verify signature ─────────────────────────────────────
    // Razorpay docs: HMAC_SHA256(order_id + "|" + payment_id, key_secret)
    // https://razorpay.com/docs/payments/server-integration/nodejs/payment-gateway/build-integration/
    const expectedSignature = await hmacSha256Hex(
      razorpayKeySecret,
      `${razorpay_order_id}|${razorpay_payment_id}`
    );

    if (expectedSignature !== razorpay_signature) {
      throw new Error("Payment signature verification failed — possible tampering");
    }

    // ── Signature is valid — process the payment ─────────────
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    // Look up the payment intent by gateway_order_id
    const { data: record, error: fetchError } = await supabase
      .from("payment_intents")
      .select("*")
      .eq("gateway_order_id", razorpay_order_id)
      .single();

    if (fetchError || !record) {
      throw new Error(
        `No payment intent found for order ${razorpay_order_id}`
      );
    }

    if (record.status === "success") {
      // Already processed — return idempotent success
      return new Response(
        JSON.stringify({
          success: true,
          message: "Payment already processed",
          transaction_id: record.id,
        }),
        {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    // ── Call process_payment RPC ──────────────────────────────
    // This atomically creates the transaction, allocations, and
    // updates dues — using SERVICE_ROLE_KEY to bypass RLS.
    const allocations =
      typeof record.allocations === "string"
        ? JSON.parse(record.allocations)
        : record.allocations;

    const rpcPayload = {
      p_student_id: record.student_id,
      p_amount: record.amount,
      p_payment_method: "online",
      p_reference_id: razorpay_payment_id,
      p_comment: `Razorpay Online Payment (${razorpay_order_id})`,
      p_date: new Date().toISOString().split("T")[0],
      p_allocations: allocations,
    };

    const { data: rpcData, error: rpcError } = await supabase.rpc(
      "process_payment",
      rpcPayload
    );

    if (rpcError) {
      console.error("RPC process_payment error:", rpcError);
      // Mark as failed if RPC fails
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

    // ── Return success with transaction details ──────────────
    return new Response(
      JSON.stringify({
        success: true,
        transaction_id: rpcData?.transaction_id,
        cleared_dues: rpcData?.cleared_dues || [],
      }),
      {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
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
