import {
  Table,
  Column,
  CreatedAt,
  UpdatedAt,
  Model,
  PrimaryKey,
  AutoIncrement,
  AllowNull,
  Unique,
  Default,
  HasMany,
  ForeignKey,
  BelongsTo
} from "sequelize-typescript";
import ContactCustomField from "./ContactCustomField";
import Ticket from "./Ticket";
import Company from "./Company";
import Schedule from "./Schedule";
import Whatsapp from "./Whatsapp";

@Table
class Contact extends Model<Contact> {
  @PrimaryKey
  @AutoIncrement
  @Column
  id: number;

  @Column
  name: string;

  @AllowNull(false)
  @Unique
  @Column
  number: string;

  // Locally Identifiable Device do WhatsApp (formato @lid).
  // Quando o WhatsApp expoe somente o LID (ex.: contato novo, grupo com
  // privacidade), persistimos aqui para conseguir enviar de volta no
  // mesmo "trilho" (ja que mandar para <numero>@s.whatsapp.net falha
  // quando o destinatario so se manifestou via LID).
  @Column
  lid: string;

  // JID completo do chat na uazapi (ex.: "5511999999999@s.whatsapp.net",
  // "<id>@g.us", "<lid>@lid"). E a fonte de verdade para envios — passamos
  // este valor direto no campo `number` da uazapi, evitando reconstrucao
  // errada quando contact.number e na verdade um LID.
  @Column
  remoteJid: string;

  @AllowNull(false)
  @Default("")
  @Column
  email: string;

  @Default("")
  @Column
  profilePicUrl: string;

  @Default(false)
  @Column
  isGroup: boolean;

  @CreatedAt
  createdAt: Date;

  @UpdatedAt
  updatedAt: Date;

  @HasMany(() => Ticket)
  tickets: Ticket[];

  @HasMany(() => ContactCustomField)
  extraInfo: ContactCustomField[];

  @ForeignKey(() => Company)
  @Column
  companyId: number;

  @BelongsTo(() => Company)
  company: Company;

  @HasMany(() => Schedule, {
    onUpdate: "CASCADE",
    onDelete: "CASCADE",
    hooks: true
  })
  schedules: Schedule[];

  @ForeignKey(() => Whatsapp)
  @Column
  whatsappId: number;

  @BelongsTo(() => Whatsapp)
  whatsapp: Whatsapp;
}

export default Contact;
