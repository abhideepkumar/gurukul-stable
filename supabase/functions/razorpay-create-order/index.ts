// supabase/functions/razorpay-create-order/index.ts
// Creates a Razorpay order and stores a payment_intent in our DB.

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { verify } from "https://deno.land/x/djwt@v2.9.1/mod.ts";

serve(async (req) => {
  const origin = req.headers.get("origin") || "*";
  
  const corsHeaders = {
    "Access-Control-Allow-Origin": origin, // Dynamic origin instead of wildcard
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
    const jwtSecret = Deno.env.get("SUPABASE_JWT_SECRET"); // Automatically provided by Supabase
    
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
        // Verify JWT locally
        await verify(token, key);
      } catch (e) {
        return new Response(
          JSON.stringify({ success: false, error: "Unauthorized: invalid or expired session" }),
          { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }
    } else {
      // Fallback to API check if secret isn't available in this environment
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

    const { student_id, amount, allocations } = await req.json();

    // ── Validate inputs ──────────────────────────────────────
    if (!student_id || !amount || !allocations) {
      throw new Error("Missing required fields: student_id, amount, allocations");
    }
    if (amount <= 0) {
      throw new Error("Amount must be greater than 0");
    }
    if (!Array.isArray(allocations) || allocations.length === 0) {
      throw new Error("Allocations must be a non-empty array");
    }

    // ── Read secrets ─────────────────────────────────────────
    const razorpayKeyId = Deno.env.get("RAZORPAY_KEY_ID");
    const razorpayKeySecret = Deno.env.get("RAZORPAY_KEY_SECRET");

    if (!razorpayKeyId || !razorpayKeySecret) {
      throw new Error("Razorpay credentials not configured on the server");
    }

    // Use service role for DB operations (bypasses RLS)
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    // ── Create a payment_intent row first ────────────────────
    const { data: intentData, error: intentError } = await supabase
      .from("payment_intents")
      .insert({
        student_id,
        amount,
        allocations,
        status: "pending",
      })
      .select()
      .single();

    if (intentError) {
      throw new Error(`DB Error: ${intentError.message}`);
    }

    const receiptId = intentData.id;

    // ── Call Razorpay Orders API ──────────────────────────────
    const amountInPaise = Math.round(amount * 100);
    const basicAuth = btoa(`${razorpayKeyId}:${razorpayKeySecret}`);

    const razorpayRes = await fetch("https://api.razorpay.com/v1/orders", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Basic ${basicAuth}`,
      },
      body: JSON.stringify({
        amount: amountInPaise,
        currency: "INR",
        receipt: receiptId,
        notes: {
          student_id,
          intent_id: receiptId,
        },
      }),
    });

    const razorpayOrder = await razorpayRes.json();

    if (!razorpayRes.ok) {
      // Clean up the intent row since order creation failed
      await supabase
        .from("payment_intents")
        .delete()
        .eq("id", receiptId);

      throw new Error(
        razorpayOrder.error?.description ||
          razorpayOrder.message ||
          "Razorpay order creation failed"
      );
    }

    // ── Update payment_intent with Razorpay order_id ─────────
    const { error: updateError } = await supabase
      .from("payment_intents")
      .update({ gateway_order_id: razorpayOrder.id })
      .eq("id", receiptId);

    if (updateError) {
      console.error("Failed to update payment_intent with order_id:", updateError);
    }

    // ── Return data to frontend ──────────────────────────────
    return new Response(
      JSON.stringify({
        success: true,
        order_id: razorpayOrder.id,
        amount: razorpayOrder.amount,
        currency: razorpayOrder.currency,
        key_id: razorpayKeyId,
        intent_id: receiptId,
      }),
      {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  } catch (err: any) {
    console.error("razorpay-create-order error:", err);
    return new Response(
      JSON.stringify({ success: false, error: err.message }),
      {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  }
});
