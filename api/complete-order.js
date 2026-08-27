export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  try {
    const {
      reference,
      email,
      expectedAmount,
      network,
      data_plan,
      beneficiary
    } = req.body || {};

    if (
      !reference ||
      !email ||
      expectedAmount === undefined ||
      !network ||
      !data_plan ||
      !beneficiary
    ) {
      return res.status(400).json({
        error: "Missing required order information"
      });
    }

    const cleanPhone = String(beneficiary).trim();

    if (!/^[0-9]{10}$/.test(cleanPhone)) {
      return res.status(400).json({
        error: "Invalid Ghana phone number"
      });
    }

    // 1. Verify the payment directly with Paystack.
    const paymentResponse = await fetch(
      `https://api.paystack.co/transaction/verify/${encodeURIComponent(reference)}`,
      {
        headers: {
          Accept: "application/json",
          Authorization: `Bearer ${process.env.PAYSTACK_SECRET_KEY}`
        }
      }
    );

    const payment = await paymentResponse.json();

    if (!paymentResponse.ok || !payment.status) {
      return res.status(400).json({
        error: "Unable to verify payment",
        details: payment.message || "Payment verification failed"
      });
    }

    const transaction = payment.data;

    // 2. Only continue when Paystack says the transaction succeeded.
    if (transaction.status !== "success") {
      return res.status(400).json({
        error: "Payment has not been completed",
        payment_status: transaction.status
      });
    }

    // 3. Make sure the paid amount matches the customer's selected price.
    const expectedPesewas = Math.round(Number(expectedAmount) * 100);

    if (
      !Number.isFinite(expectedPesewas) ||
      transaction.amount !== expectedPesewas
    ) {
      return res.status(400).json({
        error: "Payment amount does not match the order"
      });
    }

    // 4. Send the paid order to Boss Data Hub.
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
          data_plan,
          beneficiary: cleanPhone
        })
      }
    );

    const bossData = await bossResponse.json();

    if (!bossResponse.ok) {
      return res.status(502).json({
        error: "Payment succeeded, but the data order could not be placed.",
        payment_reference: reference,
        details: bossData
      });
    }

    return res.status(200).json({
      success: true,
      payment_reference: reference,
      boss_order: bossData
    });
  } catch (error) {
    return res.status(500).json({
      error: "Unable to complete order"
    });
  }
          }
