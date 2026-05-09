import { QueryInterface, DataTypes } from "sequelize";

/**
 * Adiciona Contact.remoteJid — JID completo do chat (`<num>@s.whatsapp.net`
 * ou `<id>@g.us` ou `<lid>@lid`) recebido pela uazapi.
 *
 * Motivacao: o JID e a fonte de verdade para enviar mensagens. Construir
 * `<number>@s.whatsapp.net` a partir de Contact.number falha quando o
 * "number" e na verdade um LID (caso de privacidade ativa). Salvar o
 * JID original elimina o chute.
 */
module.exports = {
  up: async (queryInterface: QueryInterface) => {
    await queryInterface.addColumn("Contacts", "remoteJid", {
      type: DataTypes.STRING(80),
      allowNull: true
    });
  },

  down: async (queryInterface: QueryInterface) => {
    await queryInterface.removeColumn("Contacts", "remoteJid");
  }
};
