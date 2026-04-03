import { config as sharedConfig } from "../../shared/config.js";

export const config = {
  ...sharedConfig,
  port: Number(process.env.EXPRESS_PORT ?? process.env.PORT ?? "3001"),
  corsOrigin: process.env.CORS_ORIGIN ?? "http://localhost:3000",
};
