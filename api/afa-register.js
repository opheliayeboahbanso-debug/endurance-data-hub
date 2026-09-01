export default async function handler(req, res) {
  if (req.method !== "POST") {
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

    const {
      full_name,
      phone,
      id_card_number,
      location
    } = req.body || {};

    if (!full_name || !phone || !id_card_number || !location) {
      return res.status(400).json({
        success: false,
        error: "Full name, phone, ID card number and location are required."
      });
    }

    if (!/^[0-9]{10}$/.test(String(phone).trim())) {
      return res.status(400).json({
        success: false,
        error: "Please enter a valid 10-digit Ghana phone number."
      });
    }

    const response = await fetch(
      "https://bbhubportal.com/api/v1/afa/register",
      {
        method: "POST",
        headers: {
          "Accept": "application/json",
          "Content-Type": "application/json",
          "X-API-KEY": process.env.BOSS_API_KEY
        },
        body: JSON.stringify({
          full_name: String(full_name).trim(),
          phone: String(phone).trim(),
          id_card_number: String(id_card_number).trim(),
          location: String(location).trim()
        })
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

    if (!response.ok) {
      console.error("BOSS AFA REGISTER FAILED:", {
        status: response.status,
        response: data
      });

      return res.status(response.status).json({
        success: false,
        boss_status: response.status,
        boss_response: data
      });
    }

    return res.status(200).json({
      success: true,
      boss_status: response.status,
      boss_response: data
    });

  } catch (error) {
    console.error("AFA REGISTER ERROR:", error);

    return res.status(500).json({
      success: false,
      error: "Unable to submit AFA registration.",
      details: error.message
    });
  }
}
