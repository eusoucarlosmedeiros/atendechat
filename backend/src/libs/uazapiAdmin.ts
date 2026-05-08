import axios, { AxiosInstance } from "axios";
import axiosRetry from "axios-retry";
import AppError from "../errors/AppError";
import { logger } from "../utils/logger";
import { translateUazapiError } from "./uazapi";

/**
 * Cliente HTTP admin da uazapi.
 *
 * Usado APENAS para endpoints que exigem `admintoken` (criar instancia,
 * listar instancias, restart). NAO usar para envios ou chamadas de
 * instancia — para isso, use getUazapiClient(whatsapp).
 */
export const getUazapiAdminClient = (): AxiosInstance => {
  const baseURL = process.env.UAZAPI_BASE_URL;
  const adminToken = process.env.UAZAPI_ADMIN_TOKEN;
  if (!baseURL) {
    throw new AppError("UAZAPI_BASE_URL nao configurado", 500);
  }
  if (!adminToken) {
    throw new AppError("UAZAPI_ADMIN_TOKEN nao configurado", 500);
  }

  const client = axios.create({
    baseURL,
    timeout: Number(process.env.UAZAPI_TIMEOUT_MS || 30000),
    headers: {
      admintoken: adminToken,
      "Content-Type": "application/json"
    }
  });

  axiosRetry(client, {
    retries: 3,
    retryDelay: axiosRetry.exponentialDelay,
    retryCondition: (err) => {
      if (axiosRetry.isNetworkOrIdempotentRequestError(err)) return true;
      const status = err.response?.status;
      return !!(status && status >= 500 && status < 600);
    }
  });

  client.interceptors.request.use(req => {
    logger.debug(`[uazapi:admin] -> ${req.method?.toUpperCase()} ${req.url}`);
    return req;
  });

  client.interceptors.response.use(
    res => res,
    err => {
      logger.warn(`[uazapi:admin] error ${err.config?.url} -> ${err.response?.status || "network"}`);
      throw translateUazapiError(err);
    }
  );

  return client;
};
