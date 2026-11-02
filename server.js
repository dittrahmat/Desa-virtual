const http = require("http");
const fs = require("fs");
const path = require("path");
const { Pool } = require("pg");

const PORT = process.env.PORT || 3000;
const ADMIN_TOKEN = process.env.ADMIN_TOKEN || "";
const MAX_WARGA = 300;
const INDEX = path.join(__dirname, "index.html");

if (!process.env.DATABASE_URL) {
  console.error("DATABASE_URL belum diatur. Hubungkan PostgreSQL dan isi environment variable DATABASE_URL.");
  process.exit(1);
}

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DATABASE_URL.includes("localhost") ? false : { rejectUnauthorized: false }
});

const clients = new Set();
const ipJoin = new Map();

const clean = (v, n) =>
  String(v == null ? "" : v).replace(/[\u0000-\u001f<>]/g, "").trim().slice(0, n);

const send = (res, code, obj) => {
  res.writeHead(code, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff"
  });
  res.end(JSON.stringify(obj));
};

const publicRecord = (w) => ({
  nama: w.nama,
  pekerjaan: w.pekerjaan,
  gender: w.gender,
  rumah: w.rumah,
  tgl: Number(w.tgl),
  slot: Number(w.slot)
});

async function allWarga() {
  const { rows } = await pool.query(
    "SELECT id, nama, usia, hobi, pekerjaan, gender, rumah, tgl, slot FROM warga ORDER BY tgl ASC"
  );
  return rows;
}

async function publicWargaObject() {
  const rows = await allWarga();
  return Object.fromEntries(rows.map(w => [w.id, publicRecord(w)]));
}

async function push() {
  const data = "data: " + JSON.stringify(await publicWargaObject()) + "\n\n";
  for (const res of clients) {
    try { res.write(data); } catch (_) { clients.delete(res); }
  }
}

async function initDb() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS warga (
      id TEXT PRIMARY KEY,
      nama VARCHAR(24) NOT NULL,
      usia INTEGER NOT NULL CHECK (usia BETWEEN 1 AND 110),
      hobi VARCHAR(30) NOT NULL,
      pekerjaan VARCHAR(30) NOT NULL,
      gender CHAR(1) NOT NULL CHECK (gender IN ('L','P')),
      rumah VARCHAR(30) NOT NULL,
      tgl BIGINT NOT NULL,
      slot INTEGER NOT NULL
    )
  `);
}

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, `http://${req.headers.host || "localhost"}`);
    const route = url.pathname;

    if (req.method === "GET" && route === "/events") {
      res.writeHead(200, {
        "Content-Type": "text/event-stream; charset=utf-8",
        "Cache-Control": "no-cache, no-transform",
        "Connection": "keep-alive",
        "X-Accel-Buffering": "no"
      });
      res.write("retry: 3000\n\n");
      res.write("data: " + JSON.stringify(await publicWargaObject()) + "\n\n");
      clients.add(res);
      req.on("close", () => clients.delete(res));
      return;
    }

    if (req.method === "GET" && route === "/me") {
      const id = clean(url.searchParams.get("id"), 80);
      if (!id) return send(res, 400, { error: "ID pemilik tidak valid" });
      const { rows } = await pool.query(
        "SELECT id, nama, usia, hobi, pekerjaan, gender, rumah, tgl, slot FROM warga WHERE id = $1",
        [id]
      );
      if (!rows.length) return send(res, 404, { error: "Data warga tidak ditemukan" });
      return send(res, 200, rows[0]);
    }

    if (req.method === "POST" && route === "/join") {
      let body = "";
      req.on("data", chunk => {
        body += chunk;
        if (body.length > 4000) req.destroy();
      });
      req.on("end", async () => {
        try {
          const j = JSON.parse(body || "{}");
          const id = clean(j.id, 80).replace(/[^\w-]/g, "");
          const nama = clean(j.nama, 24);
          const usia = Math.round(Number(j.usia));
          const hobi = clean(j.hobi, 30);
          const pekerjaan = clean(j.pekerjaan, 30);
          const gender = j.gender === "P" ? "P" : "L";
          const rumah = clean(j.rumah, 30) || "Rumah " + (gender === "L" ? "Pak " : "Bu ") + nama.split(" ")[0];

          if (!id || !nama || !hobi || !pekerjaan || !(usia >= 1 && usia <= 110)) {
            return send(res, 400, { error: "Isi semua kolom KTP dengan benar" });
          }

          const ip = String(req.headers["x-forwarded-for"] || req.socket.remoteAddress || "")
            .split(",")[0].trim();
          const now = Date.now();
          const recent = (ipJoin.get(ip) || []).filter(t => now - t < 86400000);
          if (recent.length >= 3) return send(res, 429, { error: "Terlalu banyak pendaftaran dari jaringan ini, coba lagi besok" });

          const count = await pool.query("SELECT COUNT(*)::int AS n FROM warga");
          if (count.rows[0].n >= MAX_WARGA) return send(res, 403, { error: "Desa sudah penuh" });

          const exists = await pool.query("SELECT 1 FROM warga WHERE id = $1", [id]);
          if (exists.rowCount) return send(res, 409, { error: "Anda sudah menjadi warga" });

          const usedResult = await pool.query("SELECT slot FROM warga");
          const used = new Set(usedResult.rows.map(r => Number(r.slot)));
          let slot = 0;
          while (used.has(slot)) slot++;

          const tgl = Date.now();
          const result = await pool.query(
            `INSERT INTO warga (id,nama,usia,hobi,pekerjaan,gender,rumah,tgl,slot)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
             RETURNING id,nama,usia,hobi,pekerjaan,gender,rumah,tgl,slot`,
            [id,nama,usia,hobi,pekerjaan,gender,rumah,tgl,slot]
          );

          recent.push(now);
          ipJoin.set(ip, recent);
          await push();
          return send(res, 200, result.rows[0]);
        } catch (e) {
          if (e.code === "23505") return send(res, 409, { error: "Anda sudah menjadi warga" });
          console.error(e);
          return send(res, 500, { error: "Pendaftaran gagal, coba lagi" });
        }
      });
      return;
    }

    if (req.method === "DELETE" && route.startsWith("/warga/")) {
      if (!ADMIN_TOKEN || req.headers.authorization !== "Bearer " + ADMIN_TOKEN) {
        return send(res, 401, { error: "Akses admin ditolak" });
      }
      const id = decodeURIComponent(route.slice("/warga/".length));
      await pool.query("DELETE FROM warga WHERE id = $1", [id]);
      await push();
      return send(res, 200, { ok: 1 });
    }

    if (req.method === "GET" && (route === "/" || route === "/index.html")) {
      res.writeHead(200, {
        "Content-Type": "text/html; charset=utf-8",
        "X-Content-Type-Options": "nosniff"
      });
      return fs.createReadStream(INDEX).pipe(res);
    }

    res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
    res.end("Tidak ditemukan");
  } catch (e) {
    console.error(e);
    if (!res.headersSent) send(res, 500, { error: "Terjadi kesalahan server" });
    else res.end();
  }
});

initDb().then(() => {
  server.listen(PORT, () => console.log(`Desa Harapan Jaya berjalan di port ${PORT}`));
}).catch(err => {
  console.error("Gagal menyiapkan database:", err);
  process.exit(1);
});

setInterval(() => {
  for (const res of clients) {
    try { res.write(": ping\n\n"); } catch (_) { clients.delete(res); }
  }
}, 25000);
