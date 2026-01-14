const express = require('express');
const bodyParser = require('body-parser');
const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
const { verifyWebhookSignature } = require('./utils');
const { getUserSubscription, updateSubscription } = require('./database');

const app = express();
app.use(bodyParser.json());

// Stripe webhook endpoint
app.post('/webhook', (req, res) => {
  const sig = req.headers['stripe-signature'];

  let event;
  try {
    event = verifyWebhookSignature(req.body, sig);
  } catch (err) {
    console.error('Webhook signature verification failed:', err.message);
    return res.status(400).send(`Webhook Error: ${err.message}`);
  }

  if (event.type === 'checkout.session.completed') {
    const session = event.data.object;
    const email = session.customer_email;
    const plan = 'pro';
    const expiresAt = new Date();
    expiresAt.setMonth(expiresAt.getMonth() + 1); // 1-month subscription

    updateSubscription(email, plan, expiresAt)
      .then(() => res.status(200).send('Success'))
      .catch((err) => {
        console.error('Database update failed:', err);
        res.status(500).send('Internal Server Error');
      });
  } else {
    res.status(400).send('Unhandled event type');
  }
});

// Subscription check endpoint
app.get('/check-subscription', (req, res) => {
  const email = req.query.email;
  if (!email) {
    return res.status(400).json({ error: 'Email is required' });
  }

  getUserSubscription(email)
    .then((subscription) => {
      if (!subscription) {
        return res.json({ plan: 'free' });
      }
      res.json(subscription);
    })
    .catch((err) => {
      console.error('Database query failed:', err);
      res.status(500).json({ error: 'Internal Server Error' });
    });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));