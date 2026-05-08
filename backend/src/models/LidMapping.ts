import {
  Table,
  Column,
  CreatedAt,
  UpdatedAt,
  Model,
  PrimaryKey,
  AutoIncrement,
  AllowNull,
  ForeignKey,
  BelongsTo,
  Index
} from "sequelize-typescript";
import Whatsapp from "./Whatsapp";

// Mapeamento bidirecional LID <-> PN (phone number) por sessao do WhatsApp.
// Populado ao receber qualquer mensagem que carregue ambos os JIDs (ex.:
// remoteJid=@lid + key.senderPn=@s.whatsapp.net), e consultado antes de
// montar o destinatario na hora de enviar.
@Table({ tableName: "LidMappings" })
class LidMapping extends Model<LidMapping> {
  @PrimaryKey
  @AutoIncrement
  @Column
  id: number;

  // Parte numerica do JID @lid (sem o sufixo @lid).
  @AllowNull(false)
  @Index("uniq_lidmap_lid_wid")
  @Column
  lid: string;

  // Parte numerica do JID @s.whatsapp.net (telefone real).
  @AllowNull(false)
  @Column
  pn: string;

  @ForeignKey(() => Whatsapp)
  @AllowNull(false)
  @Index("uniq_lidmap_lid_wid")
  @Column
  whatsappId: number;

  @BelongsTo(() => Whatsapp)
  whatsapp: Whatsapp;

  @CreatedAt
  createdAt: Date;

  @UpdatedAt
  updatedAt: Date;
}

export default LidMapping;
