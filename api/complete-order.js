export default async function handler(req, res) {

if (req.method !== "POST") {
return res.status(405).json({
error: "Method not allowed"
});
}

try {

const { reference } = req.body || {};

if (!reference) {
  return res.status(400).json({
    error: "Payment reference is required"
  });
}


/* ==========================================
   CHECK ENVIRONMENT VARIABLES
   ========================================== */

if (!process.env.PAYSTACK_SECRET_KEY) {
  return res.status(500).json({
    error: "Paystack secret key is not configured"
  });
}

if (!process.env.BOSS_API_KEY) {
  return res.status(500).json({
    error: "Boss Data Hub API key is not configured"
  });
}

if (
  !process.env.KV_REST_API_URL ||
  !process.env.KV_REST_API_TOKEN
) {
  return res.status(500).json({
    error: "Duplicate protection database is not configured"
  });
}


/* ==========================================
   1. VERIFY PAYMENT WITH PAYSTACK
   ========================================== */

const paystackResponse = await fetch(
  `https://api.paystack.co/transaction/verify/${encodeURIComponent(reference)}`,
  {
    method: "GET",
    headers: {
      Accept: "application/json",
      Authorization:
        `Bearer ${process.env.PAYSTACK_SECRET_KEY}`
    }
  }
);

const paystackResult =
  await paystackResponse.json();


if (
  !paystackResponse.ok ||
  !paystackResult.status
) {

  return res.status(400).json({
    error: "Unable to verify payment",
    details:
      paystackResult.message ||
      "Verification failed"
  });

}


const transaction =
  paystackResult.data;


/* ==========================================
   2. PAYMENT MUST BE SUCCESSFUL
   ========================================== */

if (transaction.status !== "success") {

  return res.status(400).json({

    error:
      "Payment was not successful",

    payment_status:
      transaction.status

  });

}


/* ==========================================
   3. GET ORDER INFORMATION
   FROM PAYSTACK METADATA
   ========================================== */

const metadata =
  transaction.metadata || {};


const network =
  String(
    metadata.network || ""
  ).trim();


const dataPlan =
  String(
    metadata.data_plan || ""
  ).trim();


const beneficiary =
  String(
    metadata.beneficiary || ""
  ).trim();


if (
  !network ||
  !dataPlan ||
  !beneficiary
) {

  return res.status(400).json({

    error:
      "Payment information is incomplete",

    metadata

  });

}


/* ==========================================
   4. VERIFY BENEFICIARY
   ========================================== */

if (!/^[0-9]{10}$/.test(beneficiary)) {

  return res.status(400).json({

    error:
      "Invalid beneficiary phone number"

  });

}


/* ==========================================
   5. PAYMENT AMOUNT
   ========================================== */

const amountPaid =
  Number(transaction.amount);


if (
  !Number.isFinite(amountPaid) ||
  amountPaid <= 0
) {

  return res.status(400).json({

    error:
      "Invalid payment amount"

  });

}


/* ==========================================
   6. DUPLICATE CHECK
   ========================================== */

const redisKey =
  `paystack:processed:${reference}`;


const redisGetResponse =
  await fetch(

    `${process.env.KV_REST_API_URL}/get/` +
    `${encodeURIComponent(redisKey)}`,

    {
      method: "GET",

      headers: {
        Authorization:
          `Bearer ${process.env.KV_REST_API_TOKEN}`
      }
    }

  );


if (!redisGetResponse.ok) {

  console.error(
    "REDIS GET FAILED:",
    await redisGetResponse.text()
  );

  return res.status(500).json({

    error:
      "Unable to check payment processing status"

  });

}


const redisData =
  await redisGetResponse.json();


if (redisData.result) {

  return res.status(200).json({

    success: true,

    already_processed: true,

    payment_reference:
      reference,

    boss_order:
      redisData.result

  });

}


/* ==========================================
   7. TEMPORARY PROCESSING LOCK
   ========================================== */

const lockKey =
  `paystack:lock:${reference}`;


const lockResponse =
  await fetch(

    `${process.env.KV_REST_API_URL}/set/` +
    `${encodeURIComponent(lockKey)}/` +
    `${encodeURIComponent("processing")}/NX/EX/120`,

    {
      method: "POST",

      headers: {
        Authorization:
          `Bearer ${process.env.KV_REST_API_TOKEN}`
      }

    }

  );


if (!lockResponse.ok) {

  console.error(
    "REDIS LOCK FAILED:",
    await lockResponse.text()
  );

  return res.status(500).json({

    error:
      "Unable to secure payment processing"

  });

}


const lockResult =
  await lockResponse.json();


if (lockResult.result !== "OK") {

  return res.status(409).json({

    error:
      "This payment is already being processed.",

    payment_reference:
      reference

  });

}


/* ==========================================
   8. PLACE ORDER WITH BOSS DATA HUB
   ========================================== */

let bossResponse;
let bossResult;


try {

  bossResponse =
    await fetch(
      "https://bbhubportal.com/api/v1/order",
      {
        method: "POST",

        headers: {
          Accept:
            "application/json",

          "Content-Type":
            "application/json",

          "X-API-KEY":
            process.env.BOSS_API_KEY
        },

        body: JSON.stringify({

          network:
            network,

          data_plan:
            dataPlan,

          beneficiary:
            beneficiary

        })

      }
    );


  bossResult =
    await bossResponse.json();


} catch (bossError) {

  console.error(
    "BOSS CONNECTION ERROR:",
    bossError
  );


  /* Remove lock so it can be retried */

  await fetch(

    `${process.env.KV_REST_API_URL}/del/` +
    `${encodeURIComponent(lockKey)}`,

    {
      method: "POST",

      headers: {
        Authorization:
          `Bearer ${process.env.KV_REST_API_TOKEN}`
      }

    }

  );


  return res.status(502).json({

    error:
      "Payment succeeded but Boss could not be reached.",

    payment_reference:
      reference

  });

}


/* ==========================================
   9. BOSS REJECTED ORDER
   ========================================== */

if (!bossResponse.ok) {

  console.error(
    "BOSS ORDER FAILED:",
    {
      status:
        bossResponse.status,

      response:
        bossResult,

      network:
        network,

      dataPlan:
        dataPlan,

      beneficiary:
        beneficiary
    }
  );


  /* Remove lock because Boss rejected it */

  await fetch(

    `${process.env.KV_REST_API_URL}/del/` +
    `${encodeURIComponent(lockKey)}`,

    {
      method: "POST",

      headers: {
        Authorization:
          `Bearer ${process.env.KV_REST_API_TOKEN}`
      }

    }

  );


  /*
    IMPORTANT:

    We return the actual Boss response
    so we can see exactly why Boss rejected
    the order.

    This does NOT charge the customer again.
  */

  return res.status(502).json({

    success: false,

    error:
      "Boss rejected the order. See details below.",

    payment_reference:
      reference,

    boss_status:
      bossResponse.status,

    details:
      bossResult,

    order_sent: {
      network:
        network,

      data_plan:
        dataPlan,

      beneficiary:
        beneficiary
    }

  });

}


/* ==========================================
   10. SAVE SUCCESSFUL BOSS ORDER
   ========================================== */

const redisSaveResponse =
  await fetch(

    `${process.env.KV_REST_API_URL}/set/` +
    `${encodeURIComponent(redisKey)}/` +
    `${encodeURIComponent(
      JSON.stringify(bossResult)
    )}`,

    {
      method: "POST",

      headers: {
        Authorization:
          `Bearer ${process.env.KV_REST_API_TOKEN}`
      }

    }

  );


if (!redisSaveResponse.ok) {

  console.error(
    "REDIS SAVE FAILED:",
    await redisSaveResponse.text()
  );


  /*
    Boss already received the order.

    DO NOT send the order again.
  */

  return res.status(200).json({

    success: true,

    warning:
      "Order completed, but duplicate-protection record could not be saved.",

    payment_reference:
      reference,

    boss_order:
      bossResult

  });

}


/* ==========================================
   11. REMOVE PROCESSING LOCK
   ========================================== */

await fetch(

  `${process.env.KV_REST_API_URL}/del/` +
  `${encodeURIComponent(lockKey)}`,

  {
    method: "POST",

    headers: {
      Authorization:
        `Bearer ${process.env.KV_REST_API_TOKEN}`
    }

  }

);


/* ==========================================
   12. SUCCESS
   ========================================== */

return res.status(200).json({

  success: true,

  already_processed: false,

  payment_reference:
    reference,

  boss_order:
    bossResult

});

} catch (error) {

console.error(
  "COMPLETE ORDER ERROR:",
  error
);


return res.status(500).json({

  error:
    "Unable to complete order",

  details:
    error.message

});

}

}
