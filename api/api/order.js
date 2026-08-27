export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  try {
    const { network, data_plan, beneficiary } = req.body || {};

    if (!network || !data_plan || !beneficiary) {
      return res.status(400).json({
        error: "network, data_plan and beneficiary are required"
      });
    }

    const response = await fetch("https://bbhubportal.com/api/v1/order", {
      method: "POST",
      headers: {
        "Accept": "application/json",
        "Content-Type": "application/json",
        "X-API-KEY": process.env.BOSS_API_KEY
      },
      body: JSON.stringify({
        network,
        data_plan,
        beneficiary
      })
    });

    const data = await response.json();

    return res.status(response.status).json(data);
  } catch (error) {
    return res.status(500).json({
      error: "Unable to place order"
    });
  }
}
