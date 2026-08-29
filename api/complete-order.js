export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  try {
    const { reference } = req.body || {};

    if (!reference) {
      return res.status(400).json({
        error: "Payment reference is required"
      });
    }

    // ==========================================
    // YOUR CUSTOMER SELLING PRICES
    // ==========================================

    const PRICES = {
      "MTN": {
        "1GB": 6,
        "2GB": 11,
        "3GB": 15,
        "4GB": 20,
        "5GB": 25,
        "6GB": 28,
        "7GB": 32,
        "8GB": 35,
        "9GB": 39,
        "10GB": 42,
        "12GB": 55,
        "15GB": 66,
        "20GB": 87,
        "25GB": 110,
        "30GB": 130,
        "40GB": 172,
        "50GB": 215,
        "100GB": 424
      },

      "Express(MTN)": {
        "1GB": 6.1,
        "2GB": 11.2,
        "3GB": 15.3,
        "4GB": 20.4,
        "5GB": 25.5,
        "6GB": 28.6,
        "7GB": 32.7,
        "8GB": 35.8,
        "10GB": 44,
        "12GB": 54.6,
        "15GB": 68.5,
        "20GB": 89,
        "25GB": 112.5,
        "30GB": 133,
        "40GB": 212,
        "50GB": 220,
        "100GB": 434
      },

      "AirtelTigo": {
        "1GB": 5.5,
        "2GB": 10,
        "3GB": 14,
        "4GB": 18.5,
        "5GB": 22,
        "6GB": 27,
        "8GB": 34,
        "10GB": 42,
        "15GB": 62,
        "20GB": 84
      },

      "Telecel": {
        "10GB": 43,
        "15GB": 65,
        "20GB": 85,
        "25GB": 105,
        "30GB": 130,
        "40GB": 150,
        "50GB": 185,
        "100GB": 355
      }
    };

    // ==========================================
    // 1. VERIFY PAYMENT WITH PAYSTACK
    // ==========================================

    const paystackResponse = await fetch(
      `https://api.paystack.co/transaction/verify/${encodeURIComponent(reference)}`,
      {
        method: "GET",
        headers: {
          Accept: "application/json",
          Authorization: `Bearer ${process.env.PAYSTACK_SECRET_KEY}`
        }
      }
    );

    const paystackResult = await paystackResponse.json();

    if (!paystackResponse.ok || !paystackResult.status) {
      return res.status(400).json({
        error: "Unable to verify payment",
        details: paystackResult.message || "Verification failed"
      });
    }

    const transaction = paystackResult.data;

    if (transaction.status !== "success") {
      return res.status(400).json({
        error: "Payment was not successful",
        payment_status: transaction.status
      });
    }

    // ==========================================
    // 2. GET ORDER INFORMATION
    // ==========================================

    const metadata = transaction.metadata || {};

    const network = metadata.network;
    const dataPlan = metadata.data_plan;
    const beneficiary = metadata.beneficiary;

    if (!network || !dataPlan || !beneficiary) {
      return res.status(400).json({
        error: "Payment information is incomplete"
      });
    }

    // ==========================================
    // 3. VERIFY CUSTOMER PRICE
    // ==========================================

    const expectedPrice = PRICES[network]?.[dataPlan];

    if (expectedPrice === undefined) {
      return res.status(400).json({
        error: "Invalid network or data plan",
        network,
        data_plan: dataPlan
      });
    }

    // Paystack amount is in pesewas
    const amountPaid = Number(transaction.amount);
    const expectedAmount = Math.round(expectedPrice * 100);

    if (amountPaid !== expectedAmount) {
      return res.status(400).json({
        error: "Payment amount does not match the selected bundle",
        expected_amount: expectedAmount,
        amount_paid: amountPaid
      });
    }

    // ==========================================
    // 4. VERIFY PHONE NUMBER
    // ==========================================

    if (!/^[0-9]{10}$/.test(String(beneficiary))) {
      return res.status(400).json({
        error: "Invalid beneficiary phone number"
      });
    }

    // ==========================================
    // 5. CHECK ENVIRONMENT VARIABLES
    // ==========================================

    if (!process.env.BOSS_API_KEY) {
      return res.status(500).json({
        error: "Boss Data Hub API key is not configured"
      });
    }

    if (
      !process.env.KV_REST_API_URL ||
      !process.env.KV_REST_API_TOKEN
    ) {
      return res.status(500).json({
        error: "Duplicate protection database is not configured"
      });
    }

    // ==========================================
    // 6. PERMANENT DUPLICATE CHECK
    // ==========================================

    const redisKey = `paystack:processed:${reference}`;

    const redisGetResponse = await fetch(
      `${process.env.KV_REST_API_URL}/get/${encodeURIComponent(redisKey)}`,
      {
        method: "GET",
        headers: {
          Authorization: `Bearer ${process.env.KV_REST_API_TOKEN}`
        }
      }
    );

    if (!redisGetResponse.ok) {
      console.error(
        "REDIS GET FAILED:",
        await redisGetResponse.text()
      );

      return res.status(500).json({
        error: "Unable to check payment processing status"
      });
    }

    const redisData = await redisGetResponse.json();

    // Already successfully processed
    if (redisData.result) {
      return res.status(200).json({
        success: true,
        already_processed: true,
        payment_reference: reference,
        boss_order: redisData.result
      });
    }

    // ==========================================
    // 7. ATOMIC SHORT-TERM LOCK
    // ==========================================
    // Prevents two simultaneous requests from
    // processing the same payment at the same time.
    //
    // The lock expires after 2 minutes so that
    // a failed/crashed request does not permanently
    // block the payment.

    const lockKey = `paystack:lock:${reference}`;

    const lockResponse = await fetch(
      `${process.env.KV_REST_API_URL}/set/${encodeURIComponent(
        lockKey
      )}/${encodeURIComponent("processing")}/NX/EX/120`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${process.env.KV_REST_API_TOKEN}`
        }
      }
    );

    if (!lockResponse.ok) {
      console.error(
        "REDIS LOCK FAILED:",
        await lockResponse.text()
      );

      return res.status(500).json({
        error: "Unable to secure payment processing"
      });
    }

    const lockResult = await lockResponse.json();

    // Another request is already processing this payment
    if (lockResult.result !== "OK") {
      return res.status(409).json({
        error: "This payment is already being processed.",
        payment_reference: reference
      });
    }

    // ==========================================
    // 8. PLACE ORDER WITH BOSS
    // ==========================================

    const bossResponse = await fetch(
      "https://bbhubportal.com/api/v1/order",
      {
        method: "POST",
        headers: {
          Accept: "application/json",
          "Content-Type": "application/json",
          "X-API-KEY": process.env.BOSS_API_KEY
        },
        body: JSON.stringify({
          network,
          data_plan: dataPlan,
          beneficiary: String(beneficiary)
        })
      }
    );

    const bossResult = await bossResponse.json();

    if (!bossResponse.ok) {
      console.error("BOSS ORDER FAILED:", {
        status: bossResponse.status,
        response: bossResult,
        network,
        dataPlan,
        beneficiary
      });

      // Remove the temporary lock so a failed order
      // can be retried.
      await fetch(
        `${process.env.KV_REST_API_URL}/del/${encodeURIComponent(lockKey)}`,
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${process.env.KV_REST_API_TOKEN}`
          }
        }
      );

      return res.status(502).json({
        error: "Payment succeeded but the data order could not be placed.",
        payment_reference: reference,
        boss_status: bossResponse.status,
        details: bossResult
      });
    }

    // ==========================================
    // 9. PERMANENTLY SAVE SUCCESSFUL ORDER
    // ==========================================

    const redisSaveResponse = await fetch(
      `${process.env.KV_REST_API_URL}/set/${encodeURIComponent(
        redisKey
      )}/${encodeURIComponent(JSON.stringify(bossResult))}`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${process.env.KV_REST_API_TOKEN}`
        }
      }
    );

    if (!redisSaveResponse.ok) {
      console.error(
        "REDIS SAVE FAILED:",
        await redisSaveResponse.text()
      );

      // IMPORTANT:
      // Boss has already received the order.
      // We DO NOT send the order again.

      return res.status(200).json({
        success: true,
        warning:
          "Order completed, but the duplicate-protection record could not be saved.",
        payment_reference: reference,
        boss_order: bossResult
      });
    }

    // ==========================================
    // 10. REMOVE TEMPORARY LOCK
    // ==========================================

    await fetch(
      `${process.env.KV_REST_API_URL}/del/${encodeURIComponent(lockKey)}`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${process.env.KV_REST_API_TOKEN}`
        }
      }
    );

    // ==========================================
    // 11. SUCCESS
    // ==========================================

    return res.status(200).json({
      success: true,
      already_processed: false,
      payment_reference: reference,
      boss_order: bossResult
    });

  } catch (error) {
    console.error("COMPLETE ORDER ERROR:", error);

    return res.status(500).json({
      error: "Unable to complete order"
    });
  }
        }
