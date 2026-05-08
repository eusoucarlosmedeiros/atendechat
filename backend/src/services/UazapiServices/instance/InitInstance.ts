import { getUazapiAdminClient } from "../../../libs/uazapiAdmin";

export interface InitInstanceParams {
  name?: string;
  // Campos opcionais documentados no spec uazapi (admintoken):
  adminField01?: string;
  adminField02?: string;
}

export interface InitInstanceResponse {
  id: string;        // UUID da instancia
  token: string;     // token de auth da instancia
  name?: string;
  status?: string;
}

/**
 * POST /instance/init — cria uma nova instancia (desconectada) na uazapi.
 *
 * Requer header `admintoken`. Use para inicializar Whatsapps novos antes
 * de configurar webhook + chamar ConnectInstance.
 */
const InitInstance = async (
  params: InitInstanceParams = {}
): Promise<InitInstanceResponse> => {
  const client = getUazapiAdminClient();
  const res = await client.post("/instance/init", params);
  return res.data;
};

export default InitInstance;
