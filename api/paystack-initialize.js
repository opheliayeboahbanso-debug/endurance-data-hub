export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  try {
    const { email, amount, network, data_plan, beneficiary } = req.body || {};

    if (!email || !amount || !network || !data_plan || !beneficiary) {
      return res.status(400).json({
        error: "email, amount, network, data_plan and beneficiary are required"
      });
    }

    const response = await fetch(
      "https://api.paystack.co/transaction/initialize",
      {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${process.env.PAYSTACK_SECRET_KEY}`,
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          email,
          amount: Math.round(Number(amount) * 100),
          currency: "GHS",
          metadata: {
            network,
            data_plan,
            beneficiary
          }
        })
      }
    );

    const data = await response.json();

    return res.status(response.status).json(data);
  } catch (error) {
    return res.status(500).json({
      error: "Unable to initialize payment"
    });
  }
}
