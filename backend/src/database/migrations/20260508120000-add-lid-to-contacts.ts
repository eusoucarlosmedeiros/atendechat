import { QueryInterface, DataTypes } from "sequelize";

module.exports = {
  up: async (queryInterface: QueryInterface) => {
    // Adiciona coluna 'lid' opcional para guardar o Locally Identifiable Device
    // do WhatsApp quando o contato veio (ou volta a vir) com JID @lid.
    await queryInterface.addColumn("Contacts", "lid", {
      type: DataTypes.STRING,
      allowNull: true
    });

    // Index para consulta reversa LID -> Contact.
    await queryInterface.addIndex("Contacts", ["lid"], {
      name: "idx_contacts_lid"
    });
  },

  down: async (queryInterface: QueryInterface) => {
    await queryInterface.removeIndex("Contacts", "idx_contacts_lid");
    await queryInterface.removeColumn("Contacts", "lid");
  }
};
