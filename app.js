/**
 * Bothost CMD: node /app/http-wrapper.js
 * (или node http-wrapper.js & node app.js — тогда в ENV: BOTHOST_SPAWN_BOT=0)
 */
process.env.BOTHOST_ROLE = "bot";
require("./lib.js");
