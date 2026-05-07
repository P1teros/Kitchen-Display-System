import express from 'express';
import { createPool } from 'mariadb';

const app = express();
app.use(express.static('.')); /* serwuje pliki statyczne (index.html) z biezacego folderu */
app.use(express.json());

/* pula polaczen z baza danych- zamiast otwierac nowe polaczenie przy kazdym zapytaniu */
const pool = createPool({
  host: '192.168.1.95',
  database: '***REMOVED***',
  user: 'rem',
  password: '***REMOVED***'
});

/*
 * zwraca liste aktywnych zamowien z ich pozycjami
   -pomija zamowienia zamkniete i anulowane
  - pomija zamowienia bez zadnych pozycji
  -pomija pozycje ktore zostaly juz wydane (kds_served != null)
 */
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
        l.id_pos_order_line,
        l.kds_served,
        l.kds_status

    FROM pos_order o
    LEFT JOIN pos_order_line l ON o.id_pos_order = l.id_pos_order
    WHERE o.status NOT IN ('closed', 'cancelled')
    AND EXISTS (
        SELECT 1 FROM pos_order_line  /* pokaz tylko zamowienia ktore maja jakies pozycje */
        WHERE id_pos_order = o.id_pos_order
    )
    ORDER BY o.created_at DESC, l.id_pos_order_line ASC  /* sortuj od najnowszych*/
    LIMIT 200
    `);
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  } finally {
    if (conn) conn.release();
  }
});

/*
 - oznacza pojedyncza pozycje jako wydana
 - jesli to byla ostatnia pozycja w zamowieniu - zamyka tez cale zamowienie
 */
app.post('/api/done/line/:id', async (req, res) => {
    let conn;
    try {
    conn = await pool.getConnection();

    //  oznacz pozycje jako wydana
    await conn.query(
        `UPDATE pos_order_line SET kds_served = NOW() WHERE id_pos_order_line = ?`,
        [req.params.id]
    );

    // pobierz orderId
    const orderRow = await conn.query(
        `SELECT id_pos_order FROM pos_order_line WHERE id_pos_order_line = ?`,
        [req.params.id]
    );
    const orderId = Number(orderRow?.[0]?.id_pos_order);

    // sprawdz czy zostaly niewydane pozycje
    const remainingRow = await conn.query(
        `SELECT COUNT(*) as ile
        FROM pos_order_line
        WHERE id_pos_order = ?
            AND kds_served IS NULL`,
        [orderId]
    );

    const remaining = Number(remainingRow?.[0]?.ile ?? 0);
    const allServed = remaining === 0;

    // jesli wszystko wydane- ustaw status KDS=2 (gotowe do wydania) dla pozycji
    if (allServed) 
    {
        await conn.query(
        `UPDATE pos_order_line SET kds_status = 2 WHERE id_pos_order = ?`,
        [orderId]
        );
    }

    res.json({ ok: true, orderId, allServed });
    } catch (err) {
    res.status(500).json({ error: err.message });
    } finally {
    if (conn) conn.release();
    }
});

app.post('/api/undo/line/:id', async (req, res) => {
    let conn;
    try {
            conn = await pool.getConnection();

            const row = await conn.query(
                `SELECT id_pos_order
                FROM pos_order_line
                WHERE id_pos_order_line = ?`,
                [req.params.id]
            );

            if (!row || !row[0]) 
            {
                return res.status(404).json({ error: 'Linia nie istnieje' });
            }

            const orderId = Number(row[0].id_pos_order);
            await conn.query(
                `UPDATE pos_order_line
                SET kds_served = NULL,
                    kds_status = 0
                WHERE id_pos_order_line = ?`,
                [req.params.id]
            );

            await conn.query(
                `UPDATE pos_order SET status = 'open' WHERE id_pos_order = ?`,
                [orderId]
            );
            res.json({ ok: true, orderId });
            
        } catch (err) {
            res.status(500).json({ error: err.message });
        } finally {
            if (conn) conn.release();
        }
});

/*
 1. oznacza cale zamowienie jako wydane
 2.ustawia kds_served na wszystkich pozycjach i zamyka zamowienie
 */
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

/*
 * anuluje puste zamowienie (bez zadnych pozycji) - w razie bledu gdzie zamówienei zostalo zlozone bez zadnych pozycji z listy menu
 */
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

/* zmiana statusu pojedynczej pozycji */
app.post('/api/status/line/:id/:status', async (req, res) => {
    let conn;
    try {
        conn = await pool.getConnection();
        await conn.query(
            `UPDATE pos_order_line SET kds_status = ? WHERE id_pos_order_line = ?`,
            [req.params.status, req.params.id]
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
