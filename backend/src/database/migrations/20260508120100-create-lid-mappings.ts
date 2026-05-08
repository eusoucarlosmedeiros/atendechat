import { QueryInterface, DataTypes } from "sequelize";

module.exports = {
  up: async (queryInterface: QueryInterface) => {
    await queryInterface.createTable("LidMappings", {
      id: {
        type: DataTypes.INTEGER,
        autoIncrement: true,
        primaryKey: true,
        allowNull: false
      },
      lid: {
        type: DataTypes.STRING,
        allowNull: false
      },
      pn: {
        type: DataTypes.STRING,
        allowNull: false
      },
      whatsappId: {
        type: DataTypes.INTEGER,
        allowNull: false,
        references: { model: "Whatsapps", key: "id" },
        onUpdate: "CASCADE",
        onDelete: "CASCADE"
      },
      createdAt: {
        type: DataTypes.DATE,
        allowNull: false,
        defaultValue: DataTypes.NOW
      },
      updatedAt: {
        type: DataTypes.DATE,
        allowNull: false,
        defaultValue: DataTypes.NOW
      }
    });

    // Cada (lid, whatsappId) e unico — evita duplicacao em re-captura.
    await queryInterface.addIndex("LidMappings", ["lid", "whatsappId"], {
      name: "uniq_lidmap_lid_wid",
      unique: true
    });

    // Consulta reversa PN -> LID.
    await queryInterface.addIndex("LidMappings", ["pn", "whatsappId"], {
      name: "idx_lidmap_pn_wid"
    });
  },

  down: async (queryInterface: QueryInterface) => {
    await queryInterface.dropTable("LidMappings");
  }
};
