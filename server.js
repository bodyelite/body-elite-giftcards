const express = require('express');
const cors = require('cors');
const fs = require('fs').promises;
const path = require('path');
const crypto = require('crypto');

const app = express();
const PORT = process.env.PORT || 3000;
const DATA_DIR = process.env.DATA_DIR || (process.env.RENDER ? '/var/data' : __dirname);
const DB_FILE = path.join(DATA_DIR, 'used_payments.json');

const MP_ACCESS_TOKEN = process.env.MP_ACCESS_TOKEN || '';

const PRECIOS = {
  hifu: { amount: 99450, label: 'HIFU 12D' },
  toxina: { amount: 162500, label: 'Toxina Botulínica' },
  pinkglow: { amount: 59800, label: 'Pink Glow' },
  adn: { amount: 69550, label: 'ADN de Salmón' },
  limpieza: { amount: 39000, label: 'Limpieza Facial Profunda' },
  prueba: { amount: 100, label: 'Servicio de Prueba' }
};

app.use(cors());
app.use(express.json());
app.use(express.static(__dirname));

let writeLock = Promise.resolve();

async function ensureDbFile() {
  try {
    await fs.mkdir(DATA_DIR, { recursive: true });
    await fs.access(DB_FILE);
  } catch {
    await fs.writeFile(DB_FILE, JSON.stringify({ preferences: {}, used: [] }, null, 2));
  }
}

async function readDb() {
  const raw = await fs.readFile(DB_FILE, 'utf8');
  try { return JSON.parse(raw); } catch { return { preferences: {}, used: [] }; }
}

async function writeDbAtomic(data) {
  const tmp = DB_FILE + '.tmp';
  await fs.writeFile(tmp, JSON.stringify(data, null, 2));
  await fs.rename(tmp, DB_FILE);
}

function withLock(fn) {
  writeLock = writeLock.then(fn).catch(err => ({ status: 500, body: { success: false, error: err.message } }));
  return writeLock;
}

app.post('/api/create-preference', async (req, res) => {
  try {
    const { servicio, para, de, mensaje, telefono, rol } = req.body || {};
    if (!servicio || !PRECIOS[servicio]) return res.status(400).json({ success: false, error: 'Servicio inválido' });
    
    if (!MP_ACCESS_TOKEN) {
      throw new Error('Falta configurar el MP_ACCESS_TOKEN en el servidor');
    }

    const precio = PRECIOS[servicio];
    const externalReference = crypto.randomBytes(12).toString('hex');

    const mpRes = await fetch('https://api.mercadopago.com/checkout/preferences', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': 'Bearer ' + MP_ACCESS_TOKEN
      },
      body: JSON.stringify({
        items: [{ title: 'Body Elite Gift Card - ' + precio.label, quantity: 1, currency_id: 'CLP', unit_price: precio.amount }],
        external_reference: externalReference,
        back_urls: {
          success: 'https://www.bodyelite.cl/regalo.html',
          failure: 'https://www.bodyelite.cl/promos.html',
          pending: 'https://www.bodyelite.cl/promos.html'
        },
        auto_return: 'approved'
      })
    });

    const mpData = await mpRes.json();
    
    if (!mpRes.ok || !mpData.id) {
      throw new Error('MercadoPago rechazó la solicitud: ' + (mpData.message || 'Token inválido'));
    }

    await withLock(async () => {
      const db = await readDb();
      db.preferences[mpData.id] = { servicio, para, de, mensaje, telefono, rol, externalReference, status: 'pending' };
      await writeDbAtomic(db);
    });
    
    res.json({ success: true, preference_id: mpData.id, init_point: mpData.init_point });
  } catch (err) { 
    res.status(500).json({ success: false, error: err.message }); 
  }
});

app.get('/api/giftcard-data', async (req, res) => {
  const prefId = req.query.preference_id;
  const db = await readDb();
  const p = db.preferences[prefId];
  if (!p) return res.status(404).json({ success: false, error: 'Datos no encontrados' });
  res.json({ success: true, ...p, label: PRECIOS[p.servicio].label });
});

app.post('/api/validate', async (req, res) => {
  const { payment_id } = req.body;
  const db = await readDb();
  if (db.used.includes(payment_id)) return res.status(409).json({ success: false, error: 'Ya usada' });
  db.used.push(payment_id);
  await writeDbAtomic(db);
  res.json({ success: true });
});

ensureDbFile().then(() => {
  app.listen(PORT, () => console.log('Server on ' + PORT));
});
