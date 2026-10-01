# Vendored browser libraries

- `xlsx.full.min.js`: SheetJS Community Edition 0.20.3, Apache-2.0. Official standalone build from `cdn.sheetjs.com`.
- `qrcode.min.js`: `qrcode-generator` 2.0.4 by Kazuhiko Arase, MIT.

They are stored locally so Excel and invitation QR generation do not depend on a runtime CDN. Update versions deliberately and rerun export/QR tests before deployment.
