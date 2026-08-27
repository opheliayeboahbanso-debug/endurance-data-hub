export default async function handler(req, res) {
  if (req.method !== "GET") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  try {
    const { reference } = req.query;

    if (!reference) {
      return res.status(400).json({
        error: "Order reference is required"
      });
    }

    const response = await fetch(
      `https://bbhubportal.com/api/v1/order-status?reference=${encodeURIComponent(reference)}`,
      {
        headers: {
          "Accept": "application/json",
          "X-API-KEY": process.env.BOSS_API_KEY
        }
      }
    );

    const data = await response.json();

    return res.status(response.status).json(data);
  } catch (error) {
    return res.status(500).json({
      error: "Unable to check order status"
    });
  }
}
