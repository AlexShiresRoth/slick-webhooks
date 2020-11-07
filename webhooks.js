require('dotenv').config();
const axios = require('axios');
const express = require('express');
const stripe = require('stripe')(process.env.STRIPE_LIVE_SECRET);
const Shopify = require('shopify-api-node');
const cors = require('cors');
const http = require('http');
const app = express();

app.use(cors());

const shopify = new Shopify({
	shopName: 'luciana-rose-couture.myshopify.com',
	apiKey: process.env.SHOPIFY_ADMIN_KEY,
	password: process.env.SHOPIFY_ADMIN_PASSWORD,
});

const prodEndPoint = 'https://pc-ecommerce-server.herokuapp.com/api/store/processorder';
const devEndPoint = 'http://localhost:5000/api/store/processorder';

console.log('NODE ENVIRONMENT:', process.env.NODE_ENV);

//Webhooks
//@route POST route
//@desc create webhook
//@access public
app.post('/stripe', require('body-parser').raw({ type: '*/*' }), async (request, response) => {
	const signature = request.headers['stripe-signature'];
	let event;
	let order;

	try {
		event = stripe.webhooks.constructEvent(request.body, signature, process.env.STRIPE_SIGNING_SECRET);
		console.log('this is the event object from signature', event.data);
	} catch (err) {
		console.log(err);
		return response.status(400).json({ msg: 'Webhook error' });
	}

	try {
		switch (event.type) {
			case 'payment_intent.created':
				console.log('paymentintent created');
				response.status(200);
				break;
			case 'payment_intent.succeeded':
				const paymentIntent = event.data.object;

				console.log('this is a payment intent', paymentIntent);
				if (!paymentIntent.metadata.shopifyToken) {
					return res
						.status(200)
						.json({ msg: 'Unauthorized order, process not originating from pendant kit' });
				}

				order = await handleOrderProcessing(paymentIntent);
				//order processing error? break out of hook and send a failing response
				if (order instanceof Error) {
					console.log('order error !!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!', order);
					order = {
						msg: 'Error processing order',
						type: 'Error',
					};

					return response.status(500).json(order);
				}
				console.log(`PaymentIntent for ${paymentIntent.amount} was successful`);

				response.status(200);
				break;
			case 'payment_method.attached':
				const paymentMethod = event.data.object;

				console.log(paymentMethod);
				break;
			default:
				console.log(`Unhandled event type ${event.type}`);
				response.status(200);
				break;
		}
	} catch (error) {
		console.log('ERROROROROROROROR', error);
		response.status(500).json({ msg: error.response });
	}

	response.status(200).json({ msg: 'Order processed' });
});

app.use(express.json({ extended: false }));

app.get('/api', (req, res) => res.send('WEBHOOK IS RUNNING'));

//call the order processing endpoint
const handleOrderProcessing = async (paymentIntent) => {
	try {
		//pass the paymentIntent data to the order endpoint
		const response = await axios.post(
			process.env.NODE_ENV === 'production' ? prodEndPoint : devEndPoint,
			paymentIntent
		);

		console.log('successful order');

		return response.data;
	} catch (error) {
		return new Error('Error processing your order, make sure your shipping info is correct!');
	}
};

//@route POST route
//@desc cancelling whole order
//@access private
app.post('/shopify-webhook-cancel-order', async (req, res) => {
	const { note_attributes } = req.body;
	console.log('CANCELING ORDER:', note_attributes);

	if (!note_attributes || note_attributes.length === 0) {
		return res.status(200).json({ msg: 'Not a canceled order from the framework api' });
	}
	const stripeChargeID = note_attributes.filter((attr) => attr.name.toLowerCase() === 'stripe charge id')[0].value;

	if (!stripeChargeID) {
		return res.status(400).json({ msg: 'Webhook failed to locate a stripe charge id' });
	}

	const foundCharge = await stripe.charges.retrieve(stripeChargeID);

	if (!foundCharge) {
		return res.status(200).json({ msg: 'Could not find a charge object with that id' });
	}

	if (foundCharge.refunded) {
		console.log('this is a found charge error!!!!!!!', foundCharge);
		return res.status(200).json({ msg: 'Charge was already refunded' });
	}

	const refund = await stripe.refunds.create({
		charge: stripeChargeID,
	});

	console.log('THIS IS THE REFUND OBJECT!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!');
	console.log(refund.status);
	console.log('!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!');
	if (!refund) {
		res.status(200).json({ msg: 'No refund object!' });
	}
	try {
		res.json(refund);
	} catch (error) {
		console.error('there was an error processing the refund', error);
		res.status(500).json({ msg: 'Internal Server Error' });
	}
});
//@route POST route
//@desc refunding from shopify api
//@access private
app.post('/shopify-webhook-refund-order', async (req, res) => {
	const { transactions, order_id } = req.body;
	console.log('TRANSACTIONSSSSSS!!!!!!', transactions);

	if (transactions.length <= 0) {
		console.log('Transactions are empty');
		return res.status(200).json({ msg: 'No transactions' });
	}
	const amount = transactions.reduce((acc, lineItem) => {
		return acc + parseFloat(lineItem.amount);
	}, 0);

	//Need to locate an order to receive it's charge id
	//The found order contains details from shopify store including
	//The stripe charge ID and Customer ID
	const foundOrder = await shopify.order.get(order_id, []);
	const orderAttributes = foundOrder.note_attributes;

	if (!foundOrder) {
		return res.status(200).json({ msg: 'Could not find an order for this refund attempt' });
	}

	if (!orderAttributes || orderAttributes.length <= 0) {
		console.log('Item is not a detailed order');
		return res.status(200).json({ msg: 'Item is not a detailed order' });
	}
	console.log('FOUND AN ORDER ATTRIBUTES OBJECT:', orderAttributes);

	const formattedAmt = Math.floor(amount * 100);

	//get the value
	const stripeChargeID = orderAttributes.filter((attr) => attr.name.toLowerCase() === 'stripe charge id')[0].value;

	console.log('THIS IS THE AMOUNT FGSDGDFGDSGFDSFSDFSDFSADFSFSDF', amount);
	if (!stripeChargeID) {
		return res.status(200).json({ msg: 'Webhook failed to locate a stripe charge id' });
	}

	const foundCharge = await stripe.charges.retrieve(stripeChargeID);

	if (!foundCharge) {
		console.error('could not find a charge');
		return res.status(200).json({ msg: 'Could not find a charge object with that id' });
	}

	if (foundCharge.refunded) {
		console.log('this is a found charge error!!!!!!!', foundCharge);
		return res.status(200).json({ msg: 'Charge was already refunded' });
	}

	const refund = await stripe.refunds.create({
		charge: stripeChargeID,
		amount: formattedAmt ? formattedAmt : 0,
	});

	try {
		res.json(refund);
	} catch (error) {
		console.error('there was an error processing the refund', error);
		res.status(500).json({ msg: 'Internal Server Error' });
	}
});

const server = http.createServer(app);

const PORT = process.env.PORT || 4000;

server.listen(PORT, () => console.log('Webhook server started on port:' + PORT));
