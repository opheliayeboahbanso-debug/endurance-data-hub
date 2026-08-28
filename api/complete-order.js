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

    // Verify payment with Paystack
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

    // Payment must be successful
    if (transaction.status !== "success") {
      return res.status(400).json({
        error: "Payment was not successful",
        payment_status: transaction.status
      });
    }

    const metadata = transaction.metadata || {};

    const network = metadata.network;
    const dataPlan = metadata.data_plan;
    const beneficiary = String(metadata.beneficiary || "");

    if (!network || !dataPlan || !beneficiary) {
      return res.status(400).json({
        error: "Payment information is incomplete"
      });
    }

    // Selling prices
    const PRICES = {
      MTN: {
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

      AirtelTigo: {
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

      Telecel: {
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

    const expectedPrice = PRICES[network]?.[dataPlan];

    if (expectedPrice === undefined) {
      return res.status(400).json({
        error: "Invalid network or data plan"
      });
    }

    // Paystack amount is in pesewas
    const amountPaid = Number(transaction.amount);
    const expectedAmount = Math.round(expectedPrice * 100);

    if (amountPaid !== expectedAmount) {
      return res.status(400).json({
        error: "Payment amount does not match the selected bundle"
      });
    }

    // Validate Ghana phone number
    if (!/^[0-9]{10}$/.test(beneficiary)) {
      return res.status(400).json({
        error: "Invalid beneficiary phone number"
      });
    }

    if (!process.env.BOSS_API_KEY) {
      return res.status(500).json({
        error: "Boss Data Hub API key is not configured"
      });
    }

    // Place order with Boss
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
          beneficiary
        })
      }
    );

    const bossResult = await bossResponse.json();

    if (!bossResponse.ok) {
      console.error("BOSS ORDER FAILED:", {
        status: bossResponse.status,
        response: bossResult,
        payment_reference: reference
      });

      return res.status(502).json({
        error: "Payment succeeded but the data order could not be placed.",
        payment_reference: reference,
        boss_status: bossResponse.status,
        details: bossResult
      });
    }

    // Return both references.
    // The Boss reference should be used for order-status checks.
    return res.status(200).json({
      success: true,
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
