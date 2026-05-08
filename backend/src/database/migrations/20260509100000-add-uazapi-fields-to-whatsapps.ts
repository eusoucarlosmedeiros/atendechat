import { QueryInterface, DataTypes } from "sequelize";

/**
 * Adiciona os campos da uazapi a tabela Whatsapps.
 *
 * Substitui a "session blob" da Baileys por:
 *   - uazapiInstanceId: UUID retornado por POST /instance/init
 *   - uazapiToken:      header `token` para auth de instancia
 *   - uazapiBaseUrl:    URL base por instancia (NULL = usa env UAZAPI_BASE_URL)
 *   - uazapiWebhookSecret: segredo gerado por nos para compor a URL do
 *                          webhook por instancia (impede spoofing).
 *
 * Os campos antigos (session, battery, plugged) sao MANTIDOS por enquanto
 * para permitir rollback. Drop em migration separada apos cutover estavel.
 */
module.exports = {
  up: async (queryInterface: QueryInterface) => {
    await queryInterface.addColumn("Whatsapps", "uazapiInstanceId", {
      type: DataTypes.STRING(64),
      allowNull: true
    });

    await queryInterface.addColumn("Whatsapps", "uazapiToken", {
      type: DataTypes.STRING(255),
      allowNull: true
    });

    await queryInterface.addColumn("Whatsapps", "uazapiBaseUrl", {
      type: DataTypes.STRING(255),
      allowNull: true
    });

    await queryInterface.addColumn("Whatsapps", "uazapiWebhookSecret", {
      type: DataTypes.STRING(64),
      allowNull: true
    });

    // Index unico para lookup reverso webhook -> Whatsapps (essencial:
    // o webhook chega com o token/secret e precisamos achar a instancia).
    await queryInterface.addIndex("Whatsapps", ["uazapiInstanceId"], {
      name: "uniq_whatsapps_uazapi_instance",
      unique: true
    });

    // Index para validar webhook por secret na URL.
    await queryInterface.addIndex("Whatsapps", ["uazapiWebhookSecret"], {
      name: "uniq_whatsapps_uazapi_webhook_secret",
      unique: true
    });
  },

  down: async (queryInterface: QueryInterface) => {
    await queryInterface.removeIndex("Whatsapps", "uniq_whatsapps_uazapi_webhook_secret");
    await queryInterface.removeIndex("Whatsapps", "uniq_whatsapps_uazapi_instance");
    await queryInterface.removeColumn("Whatsapps", "uazapiWebhookSecret");
    await queryInterface.removeColumn("Whatsapps", "uazapiBaseUrl");
    await queryInterface.removeColumn("Whatsapps", "uazapiToken");
    await queryInterface.removeColumn("Whatsapps", "uazapiInstanceId");
  }
};
