# KDS — Kitchen Display System

A real-time kitchen display system built with Node.js and Express, connected to a MariaDB database. Designed to streamline kitchen operations by displaying active orders and allowing staff to mark items as served directly from the screen.

## Features

- **Real-Time Order Display:** Automatically fetches and displays active orders from the POS database every 5 seconds.
- **Per-Item Dismissal:** Kitchen staff can tap any individual item to mark it as served — it disappears instantly without affecting the rest of the order.


## Tech Stack

- **Backend:** Node.js, Express.js (ESM)
- **Database:** MariaDB (via `mariadb` npm connector)
- **Frontend:** Vanilla HTML, CSS, JavaScript

## Database

Connects to a MariaDB instance and reads from the following tables:

| Table | Description |
|---|---|
| `pos_order` | Order header — table name, status, timestamps |
| `pos_order_line` | Individual items within an order |

The field `kds_served` (TIMESTAMP, nullable) on `pos_order_line` is used to track which items have been served. Unserved items have `kds_served = NULL`.

## API Endpoints

| Method | Endpoint | Description |
|---|---|---|
| GET | `/api/orders` | Returns all active (unserved) orders |
| POST | `/api/done/:id` | Marks all lines of an order as served |
| POST | `/api/done/line/:id` | Marks a single order line as served |

## Setup

```bash
git clone https://github.com/yourusername/kds-app
cd kds-app
npm install
node server.js
```

Then open `http://localhost:3000` in your browser.

> Make sure to update the database credentials in `server.js` before running.
