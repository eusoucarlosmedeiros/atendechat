import { QueryInterface, DataTypes } from "sequelize";

/**
 * Adiciona senderJid e senderLid em Messages.
 *
 * A uazapi entrega no payload `wa_senderJid` (PN normalizado) e `sender_lid`
 * (LID quando aplicavel). Persistir em colunas separadas evita parsing de
 * JSONB para queries comuns (ex.: "todas mensagens deste sender").
 *
 * Indexamos apenas senderJid (consulta frequente). senderLid e mantido
 * apenas para rastreabilidade/debug — query nele e rara.
 */
module.exports = {
  up: async (queryInterface: QueryInterface) => {
    await queryInterface.addColumn("Messages", "senderJid", {
      type: DataTypes.STRING(80),
      allowNull: true
    });

    await queryInterface.addColumn("Messages", "senderLid", {
      type: DataTypes.STRING(80),
      allowNull: true
    });

    await queryInterface.addIndex("Messages", ["senderJid"], {
      name: "idx_messages_sender_jid"
    });
  },

  down: async (queryInterface: QueryInterface) => {
    await queryInterface.removeIndex("Messages", "idx_messages_sender_jid");
    await queryInterface.removeColumn("Messages", "senderLid");
    await queryInterface.removeColumn("Messages", "senderJid");
  }
};
