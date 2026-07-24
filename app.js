/**
 * Bothost CMD: node /app/http-wrapper.js & node app.js
 * This process owns Telegram polling only (no HTTP bind).
 */
process.env.BOTHOST_ROLE = "bot";
require("./lib.js");
