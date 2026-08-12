require('dotenv').config();
const express = require('express');
const path = require('path');
const { runTrial } = require('./lib/orchestrate');
const { getTrial, listTrials } = require('./lib/db');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());
app.use(express.static(path.join(__dirname, '..', 'public')));

app.post('/api/trial', async (req, res) => {
  const { defendant, act, question } = req.body || {};
  try {
    const result = await runTrial({ defendant, act, question });
    if (!result.ok) {
      return res.status(400).json({ error: 'Invalid charge sheet', details: result.errors });
    }
    res.json(result);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Trial failed to run', details: err.message });
  }
});

app.get('/api/trial/:id', (req, res) => {
  const data = getTrial(req.params.id);
  if (!data) return res.status(404).json({ error: 'Trial not found' });
  res.json(data);
});

app.get('/api/trials', (req, res) => {
  res.json(listTrials());
});

app.listen(PORT, () => {
  console.log(`Tribunal server running at http://localhost:${PORT}`);
});
