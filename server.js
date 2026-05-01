const express = require('express');
const cors = require('cors');
const fs = require('fs');
const { MercadoPagoConfig, Preference } = require('mercadopago');

const app = express();
app.use(cors());
app.use(express.json());

const PRECIOS = {
  "hifu": { label: "HIFU 12D (Día de la Madre)", amount: 99450 },
  "toxina": { label: "Toxina Botulínica (Día de la Madre)", amount: 162500 },
  "pinkglow": { label: "Pink Glow (Día de la Madre)", amount: 59800 },
  "adn": { label: "ADN de Salmón (Día de la Madre)", amount: 69550 },
  "limpieza": { label: "Limpieza Profunda (Día de la Madre)", amount: 39000 },
  "test": { label: "Prueba de Sistema", amount: 100 }
};

app.get('/api/precios', (req, res) => {
  res.json(PRECIOS);
});

app.get('/api/pago/:id', async (req, res) => {
  try {
    const token = process.env.MP_ACCESS_TOKEN;
    const response = await fetch(`https://api.mercadopago.com/v1/payments/${req.params.id}`, {
      headers: { 'Authorization': `Bearer ${token}` }
    });
    const data = await response.json();
    res.json({ success: true, metadata: data.metadata, status: data.status });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

app.post('/api/create-preference', async (req, res) => {
  try {
    const { servicio, para, de, telefono, mensaje, rol } = req.body;
    const token = process.env.MP_ACCESS_TOKEN;
    const client = new MercadoPagoConfig({ accessToken: token });
    const preference = new Preference(client);
    const item = PRECIOS[servicio?.toLowerCase()];

    if (!item) throw new Error("Servicio no encontrado");

    const result = await preference.create({
      body: {
        items: [{ id: servicio, title: item.label, quantity: 1, unit_price: item.amount }],
        back_urls: {
          success: "https://www.bodyelite.cl/regalo.html",
          failure: "https://www.bodyelite.cl/promos.html",
          pending: "https://www.bodyelite.cl/promos.html"
        },
        auto_return: "approved",
        metadata: { para, de, telefono, mensaje, rol, servicio }
      }
    });
    res.json({ success: true, preference_id: result.id });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

const PORT = process.env.PORT || 10000;
app.listen(PORT, () => console.log(`Server on port ${PORT}`));
