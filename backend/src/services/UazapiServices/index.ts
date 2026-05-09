/**
 * UazapiServices — barrel exports
 *
 * Importacao limpa por modulo:
 *
 *   import { SendText, SendMedia } from "../UazapiServices";
 *   import { ConnectInstance, GetInstanceStatus } from "../UazapiServices";
 *   import { CheckNumber, ChatDetails } from "../UazapiServices";
 */

// Instance
export { default as InitInstance } from "./instance/InitInstance";
export { default as ConnectInstance } from "./instance/ConnectInstance";
export { default as DisconnectInstance } from "./instance/DisconnectInstance";
export { default as DeleteInstance } from "./instance/DeleteInstance";
export { default as GetInstanceStatus } from "./instance/GetInstanceStatus";
export { default as ConfigureWebhook } from "./instance/ConfigureWebhook";

// Send
export { default as SendText } from "./send/SendText";
export { default as SendMedia } from "./send/SendMedia";
export { default as SendLocation } from "./send/SendLocation";
export { default as SendContact } from "./send/SendContact";
export { default as SendReact } from "./send/SendReact";

// Chat
export { default as CheckNumber } from "./chat/CheckNumber";
export { default as ReadChat } from "./chat/ReadChat";
export { default as DeleteMessage } from "./chat/DeleteMessage";
export { default as EditMessage } from "./chat/EditMessage";
export { default as ChatDetails } from "./chat/ChatDetails";
export { default as SendPresence } from "./chat/SendPresence";
export { default as ListContacts } from "./chat/ListContacts";

// Group
export { default as GetGroupInfo } from "./group/GetGroupInfo";
export { default as ListGroups } from "./group/ListGroups";

// Types reexport (uteis para callers)
export type { SendTextParams, SendMessageResponse } from "./send/SendText";
export type { SendMediaParams, UazapiMediaType } from "./send/SendMedia";
export type { SendLocationParams } from "./send/SendLocation";
export type { SendContactParams } from "./send/SendContact";
export type { SendReactParams } from "./send/SendReact";
export type { CheckNumberParams, CheckNumberResponse } from "./chat/CheckNumber";
export type { ReadChatParams } from "./chat/ReadChat";
export type { DeleteMessageParams } from "./chat/DeleteMessage";
export type { EditMessageParams } from "./chat/EditMessage";
export type { ChatDetailsParams, ChatDetailsResponse } from "./chat/ChatDetails";
export type { SendPresenceParams, PresenceType } from "./chat/SendPresence";
export type { UazapiContact } from "./chat/ListContacts";
export type { InitInstanceParams, InitInstanceResponse } from "./instance/InitInstance";
export type { ConnectInstanceParams, ConnectInstanceResponse } from "./instance/ConnectInstance";
export type { InstanceStatusResponse } from "./instance/GetInstanceStatus";
export type {
  ConfigureWebhookParams,
  WebhookEventType,
  WebhookExcludeFilter
} from "./instance/ConfigureWebhook";
export type { GetGroupInfoParams, GroupInfo, GroupParticipant } from "./group/GetGroupInfo";
