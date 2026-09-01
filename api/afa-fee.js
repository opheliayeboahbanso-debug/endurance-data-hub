export default async function handler(req, res) {
  if (req.method !== "GET") {
    return res.status(405).json({
      success: false,
      error: "Method not allowed"
    });
  }

  try {
    if (!process.env.BOSS_API_KEY) {
      return res.status(500).json({
        success: false,
        error: "BOSS_API_KEY is not configured"
      });
    }

    const response = await fetch(
      "https://bbhubportal.com/api/v1/afa/fee",
      {
        method: "GET",
        headers: {
          Accept: "application/json",
          "X-API-KEY": process.env.BOSS_API_KEY
        }
      }
    );

    const text = await response.text();

    let data;

    try {
      data = JSON.parse(text);
    } catch {
      data = {
        raw_response: text
      };
    }

    return res.status(response.status).json({
      success: response.ok,
      boss_status: response.status,
      boss_response: data
    });

  } catch (error) {
    console.error("AFA FEE ERROR:", error);

    return res.status(500).json({
      success: false,
      error: "Unable to get AFA fee",
      details: error.message
    });
  }
}
