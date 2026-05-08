import {
  Table,
  Column,
  CreatedAt,
  UpdatedAt,
  Model,
  DataType,
  PrimaryKey,
  AutoIncrement,
  Default,
  AllowNull,
  HasMany,
  Unique,
  BelongsToMany,
  ForeignKey,
  BelongsTo
} from "sequelize-typescript";
import Queue from "./Queue";
import Ticket from "./Ticket";
import WhatsappQueue from "./WhatsappQueue";
import Company from "./Company";
import Prompt from "./Prompt";
import QueueIntegrations from "./QueueIntegrations";

@Table
class Whatsapp extends Model<Whatsapp> {
  @PrimaryKey
  @AutoIncrement
  @Column
  id: number;

  @AllowNull
  @Unique
  @Column(DataType.TEXT)
  name: string;

  @Column(DataType.TEXT)
  session: string;

  @Column(DataType.TEXT)
  qrcode: string;

  @Column
  status: string;

  @Column
  battery: string;

  @Column
  plugged: boolean;

  @Column
  retries: number;

  @Default("")
  @Column(DataType.TEXT)
  greetingMessage: string;

  @Default("")
  @Column(DataType.TEXT)
  farewellMessage: string;

  @Default("")
  @Column(DataType.TEXT)
  complationMessage: string;

  @Default("")
  @Column(DataType.TEXT)
  outOfHoursMessage: string;

  @Default("")
  @Column(DataType.TEXT)
  ratingMessage: string;

  @Column({ defaultValue: "stable" })
  provider: string;

  @Default(false)
  @AllowNull
  @Column
  isDefault: boolean;

  @CreatedAt
  createdAt: Date;

  @UpdatedAt
  updatedAt: Date;

  @HasMany(() => Ticket)
  tickets: Ticket[];

  @BelongsToMany(() => Queue, () => WhatsappQueue)
  queues: Array<Queue & { WhatsappQueue: WhatsappQueue }>;

  @HasMany(() => WhatsappQueue)
  whatsappQueues: WhatsappQueue[];

  @ForeignKey(() => Company)
  @Column
  companyId: number;

  @BelongsTo(() => Company)
  company: Company;

  @Column
  token: string;

  //@Default(0)
  //@Column
  //timeSendQueue: number;

  //@Column
  //sendIdQueue: number;
  
  @Column
  transferQueueId: number;

  @Column
  timeToTransfer: number;  

  @ForeignKey(() => Prompt)
  @Column
  promptId: number;

  @BelongsTo(() => Prompt)
  prompt: Prompt;

  @ForeignKey(() => QueueIntegrations)
  @Column
  integrationId: number;

  @BelongsTo(() => QueueIntegrations)
  queueIntegrations: QueueIntegrations;

  @Column
  maxUseBotQueues: number;

  @Column
  timeUseBotQueues: string;

  @Column
  expiresTicket: number;

  @Column
  expiresInactiveMessage: string;

  // ----- uazapi (substitui session blob da Baileys) ---------------------
  // UUID da instancia retornado por POST /instance/init na uazapi.
  // Unico por linha (index unique).
  @Column(DataType.STRING)
  uazapiInstanceId: string;

  // Token de auth da instancia (header `token` em chamadas REST).
  @Column(DataType.STRING)
  uazapiToken: string;

  // URL base da uazapi por instancia. Quando NULL, usa env UAZAPI_BASE_URL.
  // Util para clientes em planos diferentes ou em hosts distintos.
  @Column(DataType.STRING)
  uazapiBaseUrl: string;

  // Segredo gerado na criacao da instancia, utilizado para compor a URL
  // do webhook (ex.: /uazapi/webhook/<secret>). Unico por linha.
  @Column(DataType.STRING)
  uazapiWebhookSecret: string;
}

export default Whatsapp;
