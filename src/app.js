require('dotenv').config();
const express = require('express');
const authRoutes = require('./routes/auth');
const userRoutes = require('./routes/users');
const serviceRoutes = require('./routes/services');
const roomRoutes = require('./routes/rooms');
const planRoutes = require('./routes/plans');

const app = express();
app.use(express.json());

app.get('/health', (req, res) => res.json({ status: 'ok' }));
app.use('/auth', authRoutes);
app.use('/users', userRoutes);
app.use('/services', serviceRoutes);
app.use('/rooms', roomRoutes);
app.use('/plans', planRoutes);

// eslint-disable-next-line no-unused-vars
app.use((err, req, res, next) => {
  const status = err.status || 500;
  if (status >= 500) {
    console.error(err);
    return res.status(status).json({ error: 'Error interno' });
  }
  res.status(status).json({ error: err.message });
});

if (require.main === module) {
  const port = process.env.PORT || 3001;
  app.listen(port, () => console.log(`Alma Spa backend escuchando en :${port}`));
}

module.exports = app;
