// Simple Express server para servir o build de producao do React.
//
// Antes era criado pelo instalador (lib/_frontend.sh) com a porta hardcoded.
// Versionado no repo para sobreviver a `git reset --hard` e re-clones.
//
// A porta vem de:
//   1. process.env.PORT  (definida no .env do frontend ou via PM2)
//   2. Fallback 3000     (padrao tipico de instalacoes Atendechat)

const express = require("express");
const path = require("path");

const app = express();
const port = Number(process.env.PORT) || 3000;

app.use(express.static(path.join(__dirname, "build")));

app.get("/*", function (_req, res) {
  res.sendFile(path.join(__dirname, "build", "index.html"));
});

app.listen(port, () => {
  console.log(`[atendechat-frontend] serving build/ on port ${port}`);
});
