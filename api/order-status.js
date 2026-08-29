export default async function handler(req, res) {
  if (req.method !== "GET") {
    return res.status(405).json({
      success: false,
      error: "Method not allowed"
    });
  }

  try {
    /* ==========================================
       1. CHECK API KEY
       ========================================== */

    if (!process.env.BOSS_API_KEY) {
      return res.status(500).json({
        success: false,
        error: "BOSS_API_KEY is not configured"
      });
    }

    /* ==========================================
       2. GET ORDER REFERENCE
       ========================================== */

    const reference = String(
      req.query?.reference || ""
    ).trim();

    if (!reference) {
      return res.status(400).json({
        success: false,
        error: "Order reference is required"
      });
    }

    /* ==========================================
       3. CALL BOSS ORDER STATUS API
       ========================================== */

    const bossUrl =
      "https://bbhubportal.com/api/v1/order-status" +
      "?reference=" +
      encodeURIComponent(reference);

    const response = await fetch(bossUrl, {
      method: "GET",

      headers: {
        Accept: "application/json",
        "X-API-KEY": process.env.BOSS_API_KEY
      }
    });

    /* ==========================================
       4. SAFELY READ BOSS RESPONSE
       ========================================== */

    const text = await response.text();

    let data;

    try {
      data = JSON.parse(text);
    } catch {
      data = {
        raw_response: text
      };
    }

    /* ==========================================
       5. RETURN COMPLETE BOSS RESPONSE
       ========================================== */

    if (!response.ok) {
      console.error(
        "BOSS ORDER STATUS FAILED:",
        {
          status: response.status,
          reference,
          response: data
        }
      );

      return res.status(response.status).json({
        success: false,

        error:
          "Boss could not find or check this order.",

        reference,

        boss_status:
          response.status,

        boss_response:
          data
      });
    }

    /* ==========================================
       6. SUCCESSFUL STATUS RESPONSE
       ========================================== */

    return res.status(200).json({
      success: true,

      reference,

      boss_response:
        data
    });

  } catch (error) {

    console.error(
      "ORDER STATUS ERROR:",
      error
    );

    return res.status(500).json({
      success: false,

      error:
        "Unable to check order status",

      details:
        error.message
    });
  }
}
