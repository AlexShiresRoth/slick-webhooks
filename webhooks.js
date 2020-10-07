<<<<<<< HEAD
=======
// require("dotenv").config();
>>>>>>> 47a19e65f98b0a9f6b9965f72eafca37f7d6dfce
const axios = require("axios");
const express = require("express");
const stripe = require("stripe")(process.env.STRIPE_TEST_SECRET);
const cors = require("cors");
const bodyParser = require("body-parser");
const http = require("http");
const app = express();

app.use(cors());

app.use(express.json({ extended: false }));

app.get("/api", (req, res) => res.send("WEBHOOK IS RUNNING"));

const state = {
  order: null,
  interval: null,
  users: [],
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
// const endpointSecret = `whsec_y61oDCIkKIIcFWVxNDcOpRVgUP2kswPZ`;
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

    switch (event.type) {
      case "payment_intent.created":
        console.log("paymentintent created");
        response.status(200);
        break;
      case "payment_intent.succeeded":
        const paymentIntent = event.data.object;
<<<<<<< HEAD

        //search array of users to find a matching active user to the ordering process
        const foundUser = state.users.filter((obj) => {
          return obj.user === paymentIntent.metadata.shopifyToken;
        });
        //if there are no found users fail
        console.log("this is a found user:", foundUser);
        //if there is no connected user, fail the payment process
        if (foundUser.length <= 0) {
          return response
            .status(500)
            .json({ msg: "Could not find a connected user" });
        }
=======
        console.log(`PaymentIntent for ${paymentIntent.amount} was successful`);
>>>>>>> 47a19e65f98b0a9f6b9965f72eafca37f7d6dfce
        //call to store api endpoint to trigger order processing
        let order = await handleOrderProcessing(paymentIntent);

        //order processing error? break out of hook and send a failing response
        if (order instanceof Error) {
          console.log(
            "order error !!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!"
          );
          order = JSON.stringify({
            msg: state.order.message,
            type: "Error",
          });
          return response.status(500);
        }
<<<<<<< HEAD
        console.log(`PaymentIntent for ${paymentIntent.amount} was successful`);
        //if there is a current user, update their order object
=======
        //search array of users to find a matching active user to the ordering process
        const foundUser = state.users.filter((obj) => {
          return obj.user === paymentIntent.metadata.shopifyToken;
        });

        console.log("this is a found user:", foundUser);
        //if there is no connected user, fail the payment process
        if (foundUser.length <= 0) {
          return response
            .status(500)
            .json({ msg: "Could not find a connected user" });
        }

        //if there is a current user, update their order object

>>>>>>> 47a19e65f98b0a9f6b9965f72eafca37f7d6dfce
        state.users = state.users.map((obj) => {
          return obj.user === paymentIntent.metadata.shopifyToken
            ? { order, user: obj.user }
            : { order: {}, user: obj.user };
        });
        console.log("updated uysers23432542234", state.users);

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
  console.log("connected to ordering");

  if (state.interval) {
    clearInterval(state.interval);
  }

  state.interval = setInterval(() => client.emit("order", state.users), 4000);

  client.on("add-user", (data) => {
    let foundUser = false;
    if (state.users.filter((info) => info.user === data).length > 0) {
      console.log("found a user");
      foundUser = true;
    }

    if (!foundUser) state.users.push({ user: data, order: {} });
  });

  client.on("disconnect", (data) => {
    console.log("user disconnected");

    // state.users = [];
    clearInterval(state.interval);
  });
});
const PORT = process.env.PORT || 4000;

server.listen(PORT, () =>
  console.log("Webhook server started on port:" + PORT)
);
