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

// pobieranie zamowienia
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
        AND l.kds_served IS NULL
    WHERE o.status NOT IN ('closed', 'cancelled')
    AND EXISTS (
        SELECT 1 FROM pos_order_line 
        WHERE id_pos_order = o.id_pos_order
    )
    ORDER BY o.created_at DESC, l.id_pos_order_line ASC
    LIMIT 50
    `);
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  } finally {
    if (conn) conn.release();
  }
});

//oznacz pozycje XYZ jako gotową

app.post('/api/done/line/:id', async (req, res) => {
    let conn;
    try {
        conn = await pool.getConnection();

        // oznacz pozycje jako gotowa
        await conn.query(
            `UPDATE pos_order_line SET kds_served = NOW() WHERE id_pos_order_line = ?`,
            [req.params.id]
        );

          // sprawdz czy zamowienie ma jeszcze nieobsluzone pozycje
        const remaining = await conn.query(
            `SELECT COUNT(*) as ile FROM pos_order_line 
             WHERE id_pos_order = (SELECT id_pos_order FROM pos_order_line WHERE id_pos_order_line = ?)
             AND kds_served IS NULL`,
            [req.params.id]
        );

        // jesli nie ma - zamknij zamowienie
        if (Number(remaining[0].ile) === 0) {
            await conn.query(
                `UPDATE pos_order SET status = 'closed' 
                 WHERE id_pos_order = (SELECT id_pos_order FROM pos_order_line WHERE id_pos_order_line = ?)`,
                [req.params.id]
            );
        }
        res.json({ ok: true });
    } catch (err) {
        res.status(500).json({ error: err.message });
    } finally {
        if (conn) conn.release();
    }
});

//oznacz zamówienie XYZ jako gotowe

app.post('/api/done/:id', async (req, res) => {
    let conn;
    try {
        conn = await pool.getConnection();
    await conn.query(
        `UPDATE pos_order_line SET kds_served = NOW() WHERE id_pos_order = ?`,
        [req.params.id]
    );
    await conn.query(
        `UPDATE pos_order SET status = 'closed' WHERE id_pos_order = ?`,
        [req.params.id]
    );
        res.json({ ok: true });
    } catch (err) {
        res.status(500).json({ error: err.message });
    } finally {
        if (conn) conn.release();
    }
});

//usuwanie pustego zamowienia (jeśli nie było na nim żadnych pozycji)

app.post('/api/done/empty/:id', async (req, res) => {
    let conn;
    try {
        conn = await pool.getConnection();
        await conn.query(
            `UPDATE pos_order SET status = 'cancelled' WHERE id_pos_order = ?`,
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
