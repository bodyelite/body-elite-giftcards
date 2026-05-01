const express = require('express');
const cors = require('cors');
const fs = require('fs').promises;
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;
const DATA_DIR = process.env.DATA_DIR || (process.env.RENDER ? '.' : __dirname);
const DB_FILE = path.join(DATA_DIR, 'used_payments.json');

app.use(cors());
app.use(express.json());
app.use(express.static(__dirname));

let writeLock = Promise.resolve();

async function ensureDbFile() {
  try {
    await fs.mkdir(DATA_DIR, { recursive: true });
    await fs.access(DB_FILE);
  } catch {
    await fs.writeFile(DB_FILE, JSON.stringify({ used: [] }, null, 2));
  }
}

async function readDb() {
  const raw = await fs.readFile(DB_FILE, 'utf8');
  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed.used)) return { used: [] };
    return parsed;
  } catch {
    return { used: [] };
  }
}

async function writeDbAtomic(data) {
  const tmp = DB_FILE + '.tmp';
  await fs.writeFile(tmp, JSON.stringify(data, null, 2));
  await fs.rename(tmp, DB_FILE);
}

app.post('/api/validate', async (req, res) => {
  const { payment_id } = req.body || {};
  if (!payment_id || typeof payment_id !== 'string') {
    return res.status(400).json({ success: false, error: 'payment_id requerido' });
  }

  writeLock = writeLock.then(async () => {
    const db = await readDb();
    if (db.used.includes(payment_id)) {
      return { status: 409, body: { success: false, error: 'Este pago ya fue utilizado para generar el Pack de Regalo.' } };
    }
    db.used.push(payment_id);
    await writeDbAtomic(db);
    return { status: 200, body: { success: true, message: 'Pago validado y registrado.' } };
  }).catch(err => ({ status: 500, body: { success: false, error: 'Error interno: ' + err.message } }));

  const result = await writeLock;
  res.status(result.status).json(result.body);
});

app.get('/api/health', (req, res) => res.json({ ok: true, db: DB_FILE }));

ensureDbFile().then(() => {
  
app.get('/api/precios', (req, res) => {
  res.json({
    "hifu": { label: "HIFU 12D (Día de la Madre)", amount: 99450 },
    "toxina": { label: "Toxina Botulínica (Día de la Madre)", amount: 162500 },
    "pinkglow": { label: "Pink Glow (Día de la Madre)", amount: 59800 },
    "adn": { label: "ADN de Salmón (Día de la Madre)", amount: 69550 },
    "limpieza": { label: "Limpieza Profunda (Día de la Madre)", amount: 39000 }
  });
});


app.post('/api/create-preference', async (req, res) => {
  try {
    const { servicio, para, de, telefono, mensaje, rol } = req.body || {};
    if (!servicio) throw new Error("Faltan datos del formulario. Falta el lector JSON.");
    
    const token = process.env.MP_ACCESS_TOKEN;
    if (!token) throw new Error("Falta el MP_ACCESS_TOKEN en el panel de Render.");

    const { MercadoPagoConfig, Preference } = require('mercadopago');
    const client = new MercadoPagoConfig({ accessToken: token });
    const preference = new Preference(client);

    const PRECIOS = {
      "hifu": { label: "HIFU 12D (Día de la Madre)", amount: 99450 },
      "toxina": { label: "Toxina Botulínica (Día de la Madre)", amount: 162500 },
      "pinkglow": { label: "Pink Glow (Día de la Madre)", amount: 59800 },
      "adn": { label: "ADN de Salmón (Día de la Madre)", amount: 69550 },
      "limpieza": { label: "Limpieza Profunda (Día de la Madre)", amount: 39000 }
    };

    const item = PRECIOS[servicio.toLowerCase()];
    if (!item) throw new Error("Servicio desconocido: " + servicio);

    const result = await preference.create({
      body: {
        items: [{ id: servicio, title: item.label, quantity: 1, unit_price: item.amount }],
        back_urls: {
          success: "https://www.bodyelite.cl/regalo.html",
          failure: "https://www.bodyelite.cl/pago.html",
          pending: "https://www.bodyelite.cl/pago.html"
        },
        auto_return: "approved",
        metadata: { para, de, telefono, mensaje, rol, servicio }
      }
    });

    try {
      let db = {};
      if (fs.existsSync('./used_payments.json')) {
        db = JSON.parse(fs.readFileSync('./used_payments.json', 'utf8'));
      }
      db[result.id] = { servicio, para, de, telefono, mensaje, rol, label: item.label };
      fs.writeFileSync('./used_payments.json', JSON.stringify(db));
    } catch(e) {}

    res.json({ success: true, preference_id: result.id });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

app.use((err, req, res, next) => { res.status(500).json({ success: false, error: 'Falla interna: ' + err.message }); });
app.listen(PORT, () => console.log('Server on ' + PORT + ' | DB: ' + DB_FILE));
});
