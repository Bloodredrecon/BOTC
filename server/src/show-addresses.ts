import { formatJoinInfo } from "./join-info.js";
import { loadConfig } from "./persistence.js";

const config = loadConfig();
console.log(
  formatJoinInfo({
    host: config.host,
    port: config.port,
    pin: config.storytellerPin,
    title: `BOTC Companion join addresses (host ${config.host}, port ${config.port})`,
  }),
);
