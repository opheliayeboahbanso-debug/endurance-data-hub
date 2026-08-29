export default async function handler(req, res) {
  if (req.method !== "GET") {
    return res.status(405).json({
      success: false,
      error: "Method not allowed"
    });
  }

  try {
    /* ==========================================
       1. CHECK BOSS API KEY
       ========================================== */

    const apiKey = process.env.BOSS_API_KEY;

    if (!apiKey) {
      return res.status(500).json({
        success: false,
        error: "BOSS_API_KEY is not configured"
      });
    }

    /* ==========================================
       2. GET REFERENCE
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
       3. CALL BOSS
       ========================================== */

    const url =
      "https://bbhubportal.com/api/v1/order-status" +
      "?reference=" +
      encodeURIComponent(reference);

    const bossResponse = await fetch(url, {
      method: "GET",

      headers: {
        Accept: "application/json",
        "X-API-KEY": apiKey
      }
    });

    /* ==========================================
       4. READ RESPONSE SAFELY
       ========================================== */

    const rawText = await bossResponse.text();

    let bossData;

    try {
      bossData = JSON.parse(rawText);
    } catch {
      bossData = {
        raw_response: rawText
      };
    }

    console.log("BOSS ORDER STATUS:", {
      reference,
      http_status: bossResponse.status,
      response: bossData
    });

    /* ==========================================
       5. BOSS ERROR
       ========================================== */

    if (!bossResponse.ok) {
      return res.status(200).json({
        success: false,

        reference,

        status: "unavailable",

        error:
          "Boss could not find or check this order.",

        boss_http_status:
          bossResponse.status,

        boss_response:
          bossData
      });
    }

    /* ==========================================
       6. TRY TO FIND STATUS
       ========================================== */

    let status = null;

    if (bossData && typeof bossData === "object") {
      status =
        bossData.status ??
        bossData.data?.status ??
        bossData.order?.status ??
        bossData.data?.order?.status ??
        null;
    }

    /* ==========================================
       7. RETURN EVERYTHING
       ========================================== */

    return res.status(200).json({
      success: true,

      reference,

      status:

        status !== null
          ? String(status)
          : "unknown",

      boss_response:
        bossData
    });

  } catch (error) {

    console.error(
      "ORDER STATUS ERROR:",
      error
    );

    return res.status(500).json({
      success: false,

      reference:
        req.query?.reference || null,

      status:
        "error",

      error:
        "Unable to check order status",

      details:
        error.message
    });
  }
      }
