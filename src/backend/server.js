const { loadConfig } = require('./src/config');
const { createApp } = require('./src/app');

const config = loadConfig();
const app = createApp({ config });

app.listen(config.port, (err) => {
  if (err) {
    const hint = err.code === 'EADDRINUSE'
      ? `El puerto ${config.port} ya está en uso. Usa otro con: $env:PORT = "3100"; npm start`
      : err.message;
    console.error(`No se pudo iniciar el backend: ${hint}`);
    process.exitCode = 1;
    return;
  }
  console.log(`Wallet team7 backend escuchando en http://localhost:${config.port}`);
});
