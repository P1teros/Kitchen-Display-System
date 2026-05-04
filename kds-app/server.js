import express from 'express';
import { createPool } from 'mariadb';

const app = express();
app.use(express.static('.'));
app.use(express.json());

const pool = createPool({
  host: '192.168.1.95',
  database: '***REMOVED***',
  user: 'rem',
  password: '***REMOVED***'
});

// test polaczenia
app.get('/api/orders', async (req, res) => {
  let conn;
  try {
    conn = await pool.getConnection();
    const rows = await conn.query(`
    SELECT 
        o.id_pos_order,
        o.name,
        o.status,
        o.created_at,
        l.name AS item_name,
        l.qty,
        l.id_pos_order_line_parent,
        l.id_pos_order_line
FROM pos_order o
LEFT JOIN pos_order_line l ON o.id_pos_order = l.id_pos_order
WHERE l.kds_served IS NULL
ORDER BY o.created_at DESC
    LIMIT 50
    `);
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  } finally {
    if (conn) conn.release();
  }
});

app.post('/api/done/line/:id', async (req, res) => {
    let conn;
    try {
        conn = await pool.getConnection();
        await conn.query(
            `UPDATE pos_order_line SET kds_served = NOW() WHERE id_pos_order_line = ?`,
            [req.params.id]
        );
        res.json({ ok: true });
    } catch (err) {
        res.status(500).json({ error: err.message });
    } finally {
        if (conn) conn.release();
    }
});

app.post('/api/done/:id', async (req, res) => {
    let conn;
    try {
        conn = await pool.getConnection();
        await conn.query(
            `UPDATE pos_order_line SET kds_served = NOW() WHERE id_pos_order = ?`,
            [req.params.id]
        );
        res.json({ ok: true });
    } catch (err) {
        res.status(500).json({ error: err.message });
    } finally {
        if (conn) conn.release();
    }
});


app.listen(3000, () => {
  console.log('serwer dzialaa na http://localhost:3000');
});
