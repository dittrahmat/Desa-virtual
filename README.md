# Desa Harapan Jaya (versi publik)

Tanpa dependensi, cukup Node.js 18 atau lebih baru.

## Jalankan di komputer
1. Taruh `server.js`, `index.html`, dan `package.json` dalam satu folder.
2. Jalankan `node server.js`, lalu buka http://localhost:3000

## Agar semua orang bisa mengakses
Pasang di layanan hosting Node.js (Render, Railway, Fly.io, VPS, dll.):
- Perintah start: `node server.js` (port dibaca dari variabel `PORT`)
- Data warga tersimpan di `data.json`. Pakai disk/volume permanen agar data tidak hilang saat restart (atau atur `DATA_FILE`).
- Opsional: atur `ADMIN_TOKEN`, lalu hapus warga yang tidak pantas dengan
  `curl -X DELETE -H "Authorization: Bearer TOKEN" https://domain-anda/warga/ID_WARGA`

## Batasan bawaan
Maksimal 300 warga dan 3 pendaftaran per jaringan per hari (bisa diubah di `server.js`).
