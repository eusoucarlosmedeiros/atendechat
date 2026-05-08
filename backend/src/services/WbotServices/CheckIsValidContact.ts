import AppError from "../../errors/AppError";
import GetDefaultWhatsApp from "../../helpers/GetDefaultWhatsApp";
import CheckNumberUazapi from "../UazapiServices/chat/CheckNumber";

const CheckIsValidContact = async (
  number: string,
  companyId: number
): Promise<void> => {
  const defaultWhatsapp = await GetDefaultWhatsApp(companyId);

  try {
    const result = await CheckNumberUazapi(defaultWhatsapp, { number });
    if (!result?.exists) {
      throw new AppError("invalidNumber");
    }
  } catch (err: any) {
    if (err.message === "invalidNumber") {
      throw new AppError("ERR_WAPP_INVALID_CONTACT");
    }
    throw new AppError("ERR_WAPP_CHECK_CONTACT");
  }
};

export default CheckIsValidContact;
