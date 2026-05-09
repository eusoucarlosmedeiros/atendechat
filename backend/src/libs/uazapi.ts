import axios, { AxiosInstance, AxiosError } from "axios";
import axiosRetry from "axios-retry";
import Whatsapp from "../models/Whatsapp";
import AppError from "../errors/AppError";
import { logger } from "../utils/logger";

/**
 * Cliente HTTP da uazapi para uma instancia especifica.
 *
 * - baseURL: Whatsapp.uazapiBaseUrl ou env UAZAPI_BASE_URL.
 * - Header `token`: Whatsapp.uazapiToken (auto-injetado).
 * - Timeout: env UAZAPI_TIMEOUT_MS (default 30s).
 * - Retry: 3 tentativas em network errors e 5xx, backoff exponencial 1s/2s/4s.
 * - 429 (rate limit): NAO tratado aqui — propaga via translateError para
 *   que o caller decida (tipicamente Bull re-enfileira com delay maior).
 * - Logging: request/response em debug, erros em warn.
 */
export const getUazapiClient = (whatsapp: Whatsapp): AxiosInstance => {
  const baseURL = whatsapp.uazapiBaseUrl || process.env.UAZAPI_BASE_URL;
  if (!baseURL) {
    throw new AppError("UAZAPI base URL nao configurada (env UAZAPI_BASE_URL)", 500);
  }
  if (!whatsapp.uazapiToken) {
    throw new AppError(`Whatsapp #${whatsapp.id} sem uazapiToken — instancia nao inicializada`, 500);
  }

  const client = axios.create({
    baseURL,
    timeout: Number(process.env.UAZAPI_TIMEOUT_MS || 30000),
    headers: {
      token: whatsapp.uazapiToken,
      "Content-Type": "application/json"
    }
  });

  // Retry APENAS em network errors / timeouts. Nao retentamos 5xx nem 4xx
  // porque:
  //   - 5xx pode persistir (ex.: uazapi rejeitando JID invalido) e retentar
  //     so amplifica o erro nos logs (acoes nao sao idempotentes em geral).
  //   - 429 = rate limit; o caller decide via fila Bull.
  //   - 4xx = bad request; cliente errou, nao adianta retentar.
  axiosRetry(client, {
    retries: 2,
    retryDelay: axiosRetry.exponentialDelay,
    retryCondition: (err) => {
      // Sem response = timeout ou conexao caiu
      if (!err.response) return true;
      // 408 (timeout server-side) tambem retenta
      return err.response.status === 408;
    }
  });

  client.interceptors.request.use(req => {
    logger.debug(`[uazapi:${whatsapp.id}] -> ${req.method?.toUpperCase()} ${req.url}`);
    return req;
  });

  client.interceptors.response.use(
    res => {
      logger.debug(`[uazapi:${whatsapp.id}] <- ${res.config.url} ${res.status}`);
      return res;
    },
    (err: any) => {
      // Se ja e um AppError (re-execucao por axios-retry pode passar pelo
      // interceptor mais de uma vez), propaga sem re-traduzir.
      if (err && err.uazapiCode) {
        throw err;
      }
      logger.warn(
        `[uazapi:${whatsapp.id}] error ${err.config?.url || "?"} -> ${err.response?.status || "network"}: ${err.message}`
      );
      throw translateUazapiError(err);
    }
  );

  return client;
};

/**
 * Traduz AxiosError em AppError com codes consistentes para o restante do
 * sistema. Mantem o erro original em metadata para investigacao.
 */
export const translateUazapiError = (err: any): AppError => {
  // Idempotente: se ja foi traduzido, devolve como esta.
  if (err && err.uazapiCode) return err as AppError;
  const status = err?.response?.status;
  const data: any = err.response?.data;
  const upstreamMessage = data?.error || data?.message || err.message;

  if (!err.response) {
    // Network/timeout
    return Object.assign(
      new AppError(`ERR_UAZAPI_NETWORK: ${err.message}`, 503),
      { uazapiCode: "ERR_UAZAPI_NETWORK", originalError: err }
    );
  }

  switch (status) {
    case 400:
      return Object.assign(
        new AppError(`ERR_UAZAPI_BAD_REQUEST: ${upstreamMessage}`, 400),
        { uazapiCode: "ERR_UAZAPI_BAD_REQUEST", originalError: err }
      );
    case 401:
    case 403:
      return Object.assign(
        new AppError(`ERR_UAZAPI_UNAUTHORIZED: ${upstreamMessage}`, status),
        { uazapiCode: "ERR_UAZAPI_UNAUTHORIZED", originalError: err }
      );
    case 404:
      return Object.assign(
        new AppError(`ERR_UAZAPI_NOT_FOUND: ${upstreamMessage}`, 404),
        { uazapiCode: "ERR_UAZAPI_NOT_FOUND", originalError: err }
      );
    case 429:
      return Object.assign(
        new AppError(`ERR_UAZAPI_RATE_LIMITED: ${upstreamMessage}`, 429),
        { uazapiCode: "ERR_UAZAPI_RATE_LIMITED", originalError: err }
      );
    default:
      return Object.assign(
        new AppError(`ERR_UAZAPI_SERVER_ERROR: ${upstreamMessage}`, status || 500),
        { uazapiCode: "ERR_UAZAPI_SERVER_ERROR", originalError: err }
      );
  }
};
