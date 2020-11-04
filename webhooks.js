require("dotenv").config();
const axios = require("axios");
const express = require("express");
const stripe = require("stripe")(process.env.STRIPE_LIVE_SECRET);
const Shopify = require("shopify-api-node");
const cors = require("cors");
const bodyParser = require("body-parser");
const http = require("http");
const app = express();

app.use(cors());

app.use(express.json({ extended: false }));

app.get("/api", (req, res) => res.send("WEBHOOK IS RUNNING"));

const shopify = new Shopify({
  shopName: "luciana-rose-couture.myshopify.com",
  apiKey: process.env.SHOPIFY_ADMIN_KEY,
  password: process.env.SHOPIFY_ADMIN_PASSWORD,
});

const prodEndPoint =
  "https://pc-ecommerce-server.herokuapp.com/api/store/processorder";
const devEndPoint = "http://localhost:5000/api/store/processorder";

const state = {
  order: null,
  interval: null,
  interval2: null,
  users: [],
};

console.log("NODE ENVIRONMENT:", process.env.NODE_ENV);

//call the order processing endpoint
const handleOrderProcessing = async (paymentIntent, foundUser) => {
  //Do not resend order request if order has been paid
  if (foundUser && foundUser.order) {
    if (foundUser.order.financial_status === "paid") {
      return new Error("Order has already been paid");
    }
  }

  try {
    //pass the paymentIntent data to the order endpoint
    const response = await axios.post(
      process.env.NODE_ENV === "production" ? prodEndPoint : devEndPoint,
      paymentIntent
    );

    console.log("successful order");

    return response.data;
  } catch (error) {
    return new Error(
      "Error processing your order, make sure your shipping info is correct!"
    );
  }
};

//Webhooks
//@route POST route
//@desc create webhook
//@access public
app.post(
  "/stripe",
  bodyParser.raw({ type: "application/json" }),
  async (request, response) => {
    const signature = request.headers["stripe-signature"];
    let event;
    let order;

    try {
      event = request.body;
      console.log(event);
    } catch (error) {
      console.log(`Webhook error while parsing basic request`, error);
      return response.status(500).json({ msg: "Webhook Error" });
    }

    console.log("this is the event object", event.data.object);

    //search array of users to find a matching active user to the ordering process
    const foundUser = state.users.filter((obj) => {
      return obj.user === event.data.object.metadata.shopifyToken;
    });
    //if there are no found users, fail to prevent double charging
    //or charging for items not listed in store
    // console.log("this is a found user:", foundUser);
    //if there is no connected user, fail the payment process
    if (foundUser.length <= 0) {
      return response.status(200).json({
        msg: "User is not connected to server, order will not be processed",
      });
    }

    try {
      switch (event.type) {
        case "payment_intent.created":
          console.log("paymentintent created");
          response.status(200);
          break;
        case "payment_intent.succeeded":
          const paymentIntent = event.data.object;

          if (foundUser) {
            //call to store api endpoint to trigger order processing
            order = await handleOrderProcessing(paymentIntent, foundUser);
          }

          //order processing error? break out of hook and send a failing response
          if (order instanceof Error) {
            console.log(
              "order error !!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!"
            );
            order = {
              msg: "Error processing order",
              type: "Error",
            };
            //mutate state of users
            state.users = state.users.map((obj) => {
              return obj.user === paymentIntent.metadata.shopifyToken
                ? { order: {}, user: obj.user, errors: [order] }
                : { order: {}, user: obj.user, errors: [] };
            });
            return response.status(200).json(order);
          }
          console.log(
            `PaymentIntent for ${paymentIntent.amount} was successful`
          );
          //if there is a current user, update their order object
          state.users = state.users.map((obj) => {
            return obj.user === paymentIntent.metadata.shopifyToken
              ? { order, user: obj.user, errors: [] }
              : { order: {}, user: obj.user, errors: [] };
          });
          // console.log(
          //   `UPDATED USER: ${
          //     state.users.filter(
          //       (obj) => obj.user === paymentIntent.metadata.shopifyToken
          //     )[0].user
          //   }`,
          //   state.users
          // );

          response.status(200);
          break;
        case "payment_method.attached":
          const paymentMethod = event.data.object;

          console.log(paymentMethod);
          break;
        default:
          console.log(`Unhandled event type ${event.type}`);
          response.status(200);
          break;
      }
    } catch (error) {
      console.log("ERROROROROROROROR", error);
      response.status(500).json({ msg: error.response });
    }

    response.status(200).json({ msg: "Order processed" });
  }
);
//@route POST route
//@desc cancelling whole order
//@access private
app.post("/shopify-webhook-cancel-order", async (req, res) => {
  const { note_attributes } = req.body;
  console.log("CANCELING ORDER:", note_attributes);

  if (!note_attributes || note_attributes.length === 0) {
    return res
      .status(400)
      .json({ msg: "Not a canceled order from the framework api" });
  }
  const stripeChargeID = note_attributes.filter(
    (attr) => attr.name.toLowerCase() === "stripe charge id"
  )[0].value;

  if (!stripeChargeID) {
    return res
      .status(400)
      .json({ msg: "Webhook failed to locate a stripe charge id" });
  }

  const foundCharge = await stripe.charges.retrieve(stripeChargeID);

  if (!foundCharge) {
    return res
      .status(400)
      .json({ msg: "Could not find a charge object with that id" });
  }

  if (foundCharge.refunded) {
    console.log("this is a found charge error!!!!!!!", foundCharge);
    return res.status(400).json({ msg: "Charge was already refunded" });
  }

  const refund = await stripe.refunds.create({
    charge: stripeChargeID,
  });

  console.log(
    "THIS IS THE REFUND OBJECT!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!"
  );
  console.log(refund.status);
  console.log(
    "!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!"
  );
  if (!refund) {
    res.status(400).json({ msg: "Charge already refunded" });
  }
  try {
    res.json(refund);
  } catch (error) {
    console.error("there was an error processing the refund", error);
    res.status(500).json({ msg: "Internal Server Error" });
  }
});
//@route POST route
//@desc refunding from shopify api
//@access private
app.post("/shopify-webhook-refund-order", async (req, res) => {
  const { refund_line_items, transactions, order_id } = req.body;
  console.log("TRANSACTIONSSSSSS!!!!!!", transactions);

  if (transactions.length <= 0) {
    console.log("Transactions are empty");
    return res.status(400).json({ msg: "No transactions" });
  }
  const amount = transactions.reduce((acc, lineItem) => {
    return acc + parseFloat(lineItem.amount);
  }, 0);

  const foundOrder = await shopify.order.get(order_id, []);
  const orderAttributes = foundOrder.note_attributes;

  console.log("FOUND AN ORDER ATTRIBUTES OBJECT:", orderAttributes);
  if (!foundOrder) {
    return res
      .status(400)
      .json({ msg: "Could not find an order for this refund attempt" });
  }

  const formattedAmt = Math.ceil(amount * 100);

  const stripeChargeID = orderAttributes.filter(
    (attr) => attr.name.toLowerCase() === "stripe charge id"
  )[0].value;

  console.log("THIS IS THE AMOUNT FGSDGDFGDSGFDSFSDFSDFSADFSFSDF", amount);
  if (!stripeChargeID) {
    return res
      .status(400)
      .json({ msg: "Webhook failed to locate a stripe charge id" });
  }

  const foundCharge = await stripe.charges.retrieve(stripeChargeID);

  if (!foundCharge) {
    console.error("could not find a charge");
    return res
      .status(400)
      .json({ msg: "Could not find a charge object with that id" });
  }

  if (foundCharge.refunded) {
    console.log("this is a found charge error!!!!!!!", foundCharge);
    return res.status(400).json({ msg: "Charge was already refunded" });
  }

  const refund = await stripe.refunds.create({
    charge: stripeChargeID,
    amount: formattedAmt ? formattedAmt : 0,
  });

  try {
    res.json(refund);
  } catch (error) {
    console.error("there was an error processing the refund", error);
    res.status(500).json({ msg: "Internal Server Error" });
  }
});

const server = http.createServer(app);

const io = require("socket.io")(server);

io.on("connection", (client) => {
  // console.log("connected to ordering", state.users);

  if (state.interval) {
    clearInterval(state.interval);
  }

  state.interval = setInterval(() => client.emit("order", state.users), 1000);

  //keeps sending user state to client
  state.interval2 = setInterval(() => client.emit("users", state.users), 1000);

  // console.log("is there an interval?", state.users);

  client.on("add-user", (data) => {
    let foundUser = false;
    if (state.users.filter((info) => info.user === data).length > 0) {
      // console.log("found a user", state.users);
      foundUser = true;
    }

    if (!foundUser) state.users.push({ user: data, order: {}, errors: [] });
  });

  client.on("disconnect", (data) => {
    console.log("user disconnected", state.users);

    clearInterval(state.interval);
    clearInterval(state.interval2);

    // state.users = state.users.filter(user => user)
  });
});
const PORT = process.env.PORT || 4000;

server.listen(PORT, () =>
  console.log("Webhook server started on port:" + PORT)
);
