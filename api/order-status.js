export default async function handler(req, res) {
if (req.method !== "GET") { return res.status(405).json({ error: "Method not allowed" }); }
try {
const { reference } = req.query;

if (!reference) {
  return res.status(400).json({
    error: "Order reference is required"
  });
}

if (!process.env.BOSS_API_KEY) {
  return res.status(500).json({
    error: "Boss Data Hub API key is not configured"
  });
}

const bossResponse = await fetch(
  `https://bbhubportal.com/api/v1/order-status?reference=${encodeURIComponent(reference)}`,
  {
    method: "GET",
    headers: {
      Accept: "application/json",
      "X-API-KEY": process.env.BOSS_API_KEY
    }
  }
);

const bossText = await bossResponse.text();

let bossResult;

try {
  bossResult = JSON.parse(bossText);
} catch {
  bossResult = {
    raw_response: bossText
  };
}

console.log(
  "BOSS ORDER STATUS:",
  {
    reference,
    status: bossResponse.status,
    response: bossResult
  }
);

if (!bossResponse.ok) {

  return res.status(bossResponse.status).json({

    success: false,

    error:
      "Boss could not find or check this order.",

    boss_status:
      bossResponse.status,

    reference,

    details:
      bossResult

  });

}

return res.status(200).json({

  success: true,

  reference,

  data:
    bossResult.data || bossResult
