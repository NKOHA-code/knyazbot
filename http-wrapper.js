/**
 * Bothost CMD: node /app/http-wrapper.js & node app.js
 * If the host runs only http-wrapper.js, we spawn app.js for Telegram polling.
 */
process.env.BOTHOST_ROLE = "http";

const path = require("path");
const { spawn } = require("child_process");

if (process.env.BOTHOST_SPAWN_BOT !== "0" && process.env.BOT_TOKEN) {
  const botEntry = path.join(__dirname, "app.js");
  const child = spawn(process.execPath, [botEntry], {
    stdio: "inherit",
    env: { ...process.env, BOTHOST_SPAWN_BOT: "0" },
  });
  child.on("exit", (code, signal) => {
    console.error(`bot process stopped code=${code} signal=${signal || ""}`);
  });
}

require("./lib.js");
