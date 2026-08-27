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

    // Verify the transaction directly with Paystack
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

    // Payment must actually be successful
    if (transaction.status !== "success") {
      return res.status(400).json({
        error: "Payment was not successful",
        payment_status: transaction.status
      });
    }

    // Read order information from Paystack metadata
    const metadata = transaction.metadata || {};

    const network = metadata.network;
    const dataPlan = metadata.data_plan;
    const beneficiary = metadata.beneficiary;

    if (!network || !dataPlan || !beneficiary) {
      return res.status(400).json({
        error: "Payment metadata is incomplete"
      });
    }

    if (!/^[0-9]{10}$/.test(String(beneficiary))) {
      return res.status(400).json({
        error: "Invalid beneficiary phone number"
      });
    }

    // Confirm that the payment amount matches the selected price
    const amountPaid = Number(transaction.amount);

    if (!Number.isFinite(amountPaid) || amountPaid <= 0) {
      return res.status(400).json({
        error: "Invalid payment amount"
      });
    }

    // Send the verified order to Boss Data Hub
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
      return res.status(502).json({
        error: "Payment succeeded but the data order could not be placed.",
        payment_reference: reference,
        details: bossResult
      });
    }

    return res.status(200).json({
      success: true,
      payment_reference: reference,
      boss_order: bossResult
    });

  } catch (error) {
    console.error(error);

    return res.status(500).json({
      error: "Unable to complete order"
    });
  }
}
