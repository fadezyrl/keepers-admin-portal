const express = require('express');
const authRoutes = require('./authRoutes');
const memberRoutes = require('./memberRoutes');
const tripRoutes = require('./tripRoutes');
const ratingRoutes = require('./ratingRoutes');
const contentRoutes = require('./contentRoutes');
const dashboardRoutes = require('./dashboardRoutes');
const eventRoutes = require('./eventRoutes');

const router = express.Router();

router.get('/health', (_req, res) => {
  res.json({
    success: true,
    data: {
      service: 'keepers-api',
      status: 'ok',
      time: new Date().toISOString(),
    },
  });
});

router.use('/auth', authRoutes);
router.use('/members', memberRoutes);
router.use('/trips', tripRoutes);
router.use('/ratings', ratingRoutes);
router.use('/content', contentRoutes);
router.use('/events', eventRoutes);
router.use('/dashboard', dashboardRoutes);

module.exports = router;
