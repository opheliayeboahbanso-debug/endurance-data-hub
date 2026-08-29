export default async function handler(req, res) {

if (req.method !== "GET") {
return res.status(405).json({
success: false,
error: "Method not allowed"
});
}

try {

const { reference } = req.query;

if (!reference) {
  return res.status(400).json({
    success: false,
    error: "Order reference is required"
  });
}

if (!process.env.BOSS_API_KEY) {
  return res.status(500).json({
    success: false,
    error: "Boss Data Hub API key is not configured"
  });
}

const url =
  `https://bbhubportal.com/api/v1/order-status?reference=` +
  `${encodeURIComponent(reference)}`;

const response = await fetch(url, {
  method: "GET",

  headers: {
    "Accept": "application/json",
    "X-API-KEY": process.env.BOSS_API_KEY
  }
});

/* Get the response as TEXT first.
   This prevents JSON parsing errors if Boss
   returns a plain-text error. */

const text = await response.text();

let data;

try {
  data = JSON.parse(text);
} catch {

  console.error(
    "BOSS RETURNED NON-JSON:",
    text
  );

  return res.status(502).json({
    success: false,
    error: "Boss returned a non-JSON response",
    boss_status: response.status,
    boss_response: text
  });
}

console.log(
  "BOSS ORDER STATUS RESPONSE:",
  {
    reference,
    status: response.status,
    data
  }
);

if (!response.ok) {

  return res.status(response.status).json({
    success: false,
    error:
      "Boss could not find or check this order.",
    boss_status:
      response.status,
    reference,
    details:
      data
  });
}

return res.status(200).json({

  success: true,

  reference,

  data:
    data.data || data

});

} catch (error) {

console.error(
  "ORDER STATUS SERVER ERROR:",
  error
);

return res.status(500).json({

  success: false,

  error:
    "Unable to check order",

  details:
    error.message

});

}

}
