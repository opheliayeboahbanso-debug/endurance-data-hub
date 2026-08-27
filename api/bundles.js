export default async function handler(req, res) {
  try {
    const network = req.query.network;

    const url = network
      ? `https://bbhubportal.com/api/v1/bundles?network=${encodeURIComponent(network)}`
      : `https://bbhubportal.com/api/v1/bundles`;

    const response = await fetch(url, {
      headers: {
        "Accept": "application/json",
        "X-API-KEY": process.env.BOSS_API_KEY
      }
    });

    const data = await response.json();

    res.status(response.status).json(data);
  } catch (error) {
    res.status(500).json({
      error: "Unable to retrieve data bundles"
    });
  }
}
