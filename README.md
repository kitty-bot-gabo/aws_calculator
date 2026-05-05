# aws_calculator

Chat + módulo LLM + MCP-like tools para crear estimates oficiales en AWS Pricing Calculator desde prompts.

- Usa catálogo público de `calculator.aws`.
- Genera links oficiales `https://calculator.aws/#/estimate?id=...` con botón **Create estimate**.
- No usa credenciales AWS.
- API keys LLM solo en `.env` del backend.
- Incluye servidor MCP stdio opcional en `backend/mcp-server.js`.

> Nota: el export a calculator.aws usa endpoints públicos/undocumented del sitio AWS Pricing Calculator, igual que el sample MCP oficial de `aws-samples`; AWS puede cambiarlos.

## Uso

```bash
cp .env.example .env
# edita LLM_PROVIDER / modelos / keys si corresponde
docker compose up --build
```

Web local del host: http://127.0.0.1:8099

Web desde la red local: `http://IP_LOCAL_DEL_SERVIDOR:8099`

El compose publica por defecto en `0.0.0.0:8099`, así que queda visible en la LAN cuando tú levantes el contenedor. Si alguna vez quieres dejarlo solo local, cambia `APP_BIND_HOST=127.0.0.1` en `.env`.
