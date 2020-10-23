require("dotenv").config();
const axios = require("axios");
const express = require("express");
const stripe = require("stripe")(process.env.STRIPE_TEST_SECRET);
const cors = require("cors");
const bodyParser = require("body-parser");
const http = require("http");
const { FaSatellite } = require("react-icons/fa");
const app = express();

app.use(cors());

app.use(express.json({ extended: false }));

app.get("/api", (req, res) => res.send("WEBHOOK IS RUNNING"));

const prodEndPoint =
  "https://pc-ecommerce-server.herokuapp.com/api/store/processorder";
const devEndPoint = "http://localhost:5000/api/store/processorder";

const state = {
  order: null,
  interval: null,
  users: [],
};

console.log("NODE ENVIRONMENT:", process.env.NODE_ENV);

//call the order processing endpoint
const handleOrderProcessing = async (paymentIntent) => {
  //Do not resend order request if order has been paid
  if (state.order && order.financial_status) {
    if (state.order.financial_status === "paid") {
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

    switch (event.type) {
      case "payment_intent.created":
        console.log("paymentintent created");
        response.status(200);
        break;
      case "payment_intent.succeeded":
        const paymentIntent = event.data.object;

        //search array of users to find a matching active user to the ordering process
        const foundUser = state.users.filter((obj) => {
          return obj.user === paymentIntent.metadata.shopifyToken;
        });
        //if there are no found users, fail to prevent double charging
        // console.log("this is a found user:", foundUser);
        //if there is no connected user, fail the payment process
        if (foundUser.length <= 0) {
          return response
            .status(500)
            .json({ msg: "Could not find a connected user" });
        }
        //call to store api endpoint to trigger order processing
        let order = await handleOrderProcessing(paymentIntent);

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
          return response.status(500).json(order);
        }
        console.log(`PaymentIntent for ${paymentIntent.amount} was successful`);
        //if there is a current user, update their order object
        state.users = state.users.map((obj) => {
          return obj.user === paymentIntent.metadata.shopifyToken
            ? { order, user: obj.user, errors: [] }
            : { order: {}, user: obj.user, errors: [] };
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

    if (!foundUser) state.users.push({ user: data, order: {}, errors: [] });
  });

  client.on("disconnect", (data) => {
    console.log("user disconnected");

    // state.users = [];
    clearInterval(state.interval);

    // state.users = state.users.filter(user => user)
  });
});
const PORT = process.env.PORT || 4000;

server.listen(PORT, () =>
  console.log("Webhook server started on port:" + PORT)
);
