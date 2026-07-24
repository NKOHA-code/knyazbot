/**
 * Bothost CMD: node /app/http-wrapper.js & node app.js
 * This process owns HTTP (PORT) for Traefik / Mini App.
 *
 * Note: during Docker BUILD Bothost overwrites this file with a stub,
 * but at RUNTIME git is mounted over /app — so this repo file wins.
 */
process.env.BOTHOST_ROLE = "http";
require("./lib.js");
