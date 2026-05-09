import {
  Table,
  Column,
  Model,
  PrimaryKey,
  AutoIncrement,
  AllowNull,
  ForeignKey,
  BelongsTo,
  DataType,
  Default,
  CreatedAt
} from "sequelize-typescript";
import Whatsapp from "./Whatsapp";

/**
 * Idempotencia de eventos da uazapi.
 *
 * Antes de processar um evento, o handler faz:
 *   try {
 *     await WebhookEvent.create({ uazapiEventId, whatsappId, eventType, payload });
 *     // processa
 *   } catch (err) {
 *     if (err instanceof UniqueConstraintError) return; // duplicata, skip
 *     throw err;
 *   }
 *
 * O par (uazapiEventId, whatsappId) e a chave logica de dedupe.
 */
// timestamps: false porque a tabela so tem `processedAt` (sem
// createdAt/updatedAt). O default do Sequelize-typescript inclui
// ambos automaticamente — desligamos para nao gerar SQL com campos
// inexistentes.
@Table({ tableName: "WebhookEvents", timestamps: false })
class WebhookEvent extends Model<WebhookEvent> {
  @PrimaryKey
  @AutoIncrement
  @Column
  id: number;

  @AllowNull(false)
  @Column(DataType.STRING(100))
  uazapiEventId: string;

  @AllowNull(false)
  @Column(DataType.STRING(50))
  eventType: string;

  @ForeignKey(() => Whatsapp)
  @AllowNull(false)
  @Column
  whatsappId: number;

  @BelongsTo(() => Whatsapp)
  whatsapp: Whatsapp;

  @AllowNull(false)
  @Column(DataType.JSONB)
  payload: Record<string, any>;

  @CreatedAt
  @Default(DataType.NOW)
  @Column
  processedAt: Date;
}

export default WebhookEvent;
