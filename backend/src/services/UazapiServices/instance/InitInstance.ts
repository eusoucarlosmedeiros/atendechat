import { getUazapiAdminClient } from "../../../libs/uazapiAdmin";

/**
 * Schema da Instance (subset relevante) — espelha schemas/instance.yaml#/Instance
 * da uazapi.
 */
export interface UazapiInstance {
  id: string;
  token: string;
  status: string;          // disconnected | connecting | connected
  paircode?: string;
  qrcode?: string;         // data:image/png;base64,...
  name?: string;
  profileName?: string;
  profilePicUrl?: string;
  isBusiness?: boolean;
  plataform?: string;      // sic — typo "plataform" no spec uazapi
  systemName?: string;
  owner?: string;
  current_presence?: "available" | "unavailable";
  lastDisconnect?: string;
  lastDisconnectReason?: string;
  adminField01?: string;
  adminField02?: string;
  created?: string;
  updated?: string;
}

export interface InitInstanceParams {
  name: string;
  systemName?: string;
  adminField01?: string;
  adminField02?: string;
  fingerprintProfile?: string;
  browser?: string;
}

/**
 * Resposta REAL do POST /instance/init (uazapi spec).
 * Note que o `token` vem no top-level (alem de aparecer em `instance.token`).
 */
export interface InitInstanceResponse {
  response: string;          // "Instance created successfully"
  instance: UazapiInstance;
  connected: boolean;
  loggedIn: boolean;
  name: string;
  token: string;             // top-level — token de auth da instancia
  info?: string;
}

/**
 * POST /instance/init — cria nova instancia (admintoken).
 *
 * Use o `token` (top-level) e `instance.id` para persistir em
 * Whatsapp.uazapiToken e Whatsapp.uazapiInstanceId.
 */
const InitInstance = async (
  params: InitInstanceParams
): Promise<InitInstanceResponse> => {
  const client = getUazapiAdminClient();
  const res = await client.post("/instance/init", params);
  return res.data;
};

export default InitInstance;
