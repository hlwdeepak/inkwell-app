require('dotenv').config();
const express = require('express');
const path = require('path');

const subscriberRoutes = require('./routes/subscribers');
const { router: campaignRoutes, dispatchCampaign } = require('./routes/campaigns');
const publicRoutes = require('./routes/public');
const reportRoutes = require('./routes/reports');
const { initScheduler } = require('./scheduler');

const app = express();
// Generous body size limits for bulk CSV imports
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ limit: '50mb', extended: true }));
app.use(express.static(path.join(__dirname, '..', 'public')));

// ---- Public routes: no auth. Signup form, confirm/unsubscribe links,
// tracking pixels, embed script, and provider webhooks all live here ----
app.use('/', publicRoutes);

// ---- Admin auth: everything else under /api requires the admin key ----
function requireAdmin(req, res, next) {
  const key = req.header('x-api-key');
  if (!key || key !== process.env.ADMIN_API_KEY) {
    return res.status(401).json({ error: 'Missing or invalid x-api-key header' });
  }
  next();
}
app.use('/api', requireAdmin, subscriberRoutes, campaignRoutes, reportRoutes);

app.get('/health', (req, res) => res.json({ ok: true, version: '2.0.0-pro' }));

// Start background campaign scheduler
initScheduler(dispatchCampaign);

const port = process.env.PORT || 3000;
app.listen(port, () => {
  console.log(`Inkwell running at http://localhost:${port}`);
  if (!process.env.ADMIN_API_KEY || process.env.ADMIN_API_KEY === 'change-me-to-a-long-random-string') {
    console.warn('⚠️  Set a real ADMIN_API_KEY in .env before deploying.');
  }
  if (!process.env.COMPANY_ADDRESS || process.env.COMPANY_ADDRESS.includes('123 Main St')) {
    console.warn('⚠️  Set a real COMPANY_ADDRESS in .env — CAN-SPAM requires a genuine physical mailing address in every commercial email.');
  }
});
