import AppError from "../../errors/AppError";
import GetDefaultWhatsApp from "../../helpers/GetDefaultWhatsApp";
import CheckNumberUazapi from "../UazapiServices/chat/CheckNumber";

interface IOnWhatsapp {
  jid: string;
  exists: boolean;
}

const CheckContactNumber = async (
  number: string,
  companyId: number
): Promise<IOnWhatsapp> => {
  const defaultWhatsapp = await GetDefaultWhatsApp(companyId);
  const result = await CheckNumberUazapi(defaultWhatsapp, { number });

  if (!result?.exists) {
    throw new AppError("ERR_CHECK_NUMBER");
  }

  return {
    jid: result.jid || `${number}@s.whatsapp.net`,
    exists: result.exists
  };
};

export default CheckContactNumber;
