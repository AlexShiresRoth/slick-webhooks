require("dotenv").config();
const axios = require("axios");
const express = require("express");
const stripe = require("stripe")(process.env.STRIPE_TEST_SECRET);
const cors = require("cors");
const bodyParser = require("body-parser");
const http = require("http");
const app = express();

app.use(cors());

app.use(express.json({ extended: false }));

const state = {
  order: null,
  interval: null,
};

//call the order processing endpoint
const handleOrderProcessing = async (paymentIntent) => {
  //Do not resend order request if order has been paid
  if (state.order && order.financial_status) {
    if (state.order.financial_status === "paid") {
      return new Error("Order has already been paid");
    }
  }

  try {
    const response = await axios.post(
      "https://pc-ecommerce-server.herokuapp.com/api/store/processorder",
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
const endpointSecret = `whsec_y61oDCIkKIIcFWVxNDcOpRVgUP2kswPZ`;
app.post(
  "/stripe",
  bodyParser.raw({ type: "application/json" }),
  async (request, response) => {
    const signature = request.headers["stripe-signature"];
    let event;

    try {
      event = request.body;
      console.log(event);
    } catch (error) {
      console.log(`Webhook error while parsing basic request`, error);
      return response.status(500).json({ msg: "Webhook Error" });
    }

    // if (endpointSecret) {
    //   try {
    //     event = stripe.webhooks.constructEvent(
    //       request,
    //       signature,
    //       endpointSecret
    //     );
    //   } catch (error) {
    //     console.log(`Webhook signature verification failed`, error);
    //     return response
    //       .status(200)
    //       .send("Webhook signature verification failed");
    //   }
    // }

    console.log(request.body);

    switch (event.type) {
      case "payment_intent.created":
        console.log("paymentintent created");
        response.status(200);
        break;
      case "payment_intent.succeeded":
        const paymentIntent = event.data.object;
        console.log(`PaymentIntent for ${paymentIntent.amount} was successful`);
        //call to store api endpoint to trigger order processing
        state.order = await handleOrderProcessing(paymentIntent);

        if (state.order instanceof Error) {
          console.log(
            "order error !!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!"
          );
          state.order = JSON.stringify({
            msg: state.order.message,
            type: "Error",
          });
          return response.status(500);
        }

        console.log("order successful");

        response.status(200);
        break;
      case "payment_method.attached":
        const paymentMethod = event.data.object;

        console.log(paymentMethod);
        break;
      default:
        console.log(`Unhandled event type ${event.type}`);
    }

    response.status(200).json({ msg: "Order processed" });
  }
);

const server = http.createServer(app);

const io = require("socket.io")(server);

io.on("connection", (client) => {
  console.log("connected to ordering", state.interval);

  if (state.interval) {
    clearInterval(state.interval);
  }

  if (state.order && state.order.financial_status) {
    if (state.order.financial_status === "paid") state.order = null;
  }

  state.interval = setInterval(() => client.emit("order", state.order), 4000);

  client.on("disconnect", () => {
    console.log("ordering disconnected");

    state.order = null;
    clearInterval(state.interval);
  });
});

const PORT = process.env.PORT || 4000;

server.listen(PORT, () =>
  console.log("Webhook server started on port:" + PORT)
);
