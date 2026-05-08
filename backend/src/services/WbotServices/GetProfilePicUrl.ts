import GetDefaultWhatsApp from "../../helpers/GetDefaultWhatsApp";
import ChatDetails from "../UazapiServices/chat/ChatDetails";

const GetProfilePicUrl = async (
  number: string,
  companyId: number
): Promise<string> => {
  const defaultWhatsapp = await GetDefaultWhatsApp(companyId);

  try {
    const details = await ChatDetails(defaultWhatsapp, { number });
    if (details?.profilePicUrl) return details.profilePicUrl;
  } catch (_) { /* fallback */ }

  return `${process.env.FRONTEND_URL}/nopicture.png`;
};

export default GetProfilePicUrl;
