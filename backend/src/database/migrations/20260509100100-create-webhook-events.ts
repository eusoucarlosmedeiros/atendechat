import { QueryInterface, DataTypes } from "sequelize";

/**
 * Cria tabela WebhookEvents — usada para idempotencia de eventos da uazapi.
 *
 * A uazapi nao garante exactly-once: o mesmo evento pode chegar mais de uma
 * vez (retries em caso de timeout/erro 5xx no nosso webhook). Antes de
 * processar um evento (criar mensagem, atualizar ack, etc.), o handler
 * tenta inserir aqui — se a constraint UNIQUE violar, e duplicata e o
 * processamento e abortado.
 *
 * Retencao recomendada: 30 dias (configuravel via cron). Implementacao do
 * cleanup job e responsabilidade do Dev (Dex), fora do escopo desta migration.
 */
module.exports = {
  up: async (queryInterface: QueryInterface) => {
    await queryInterface.createTable("WebhookEvents", {
      id: {
        type: DataTypes.INTEGER,
        autoIncrement: true,
        primaryKey: true,
        allowNull: false
      },
      uazapiEventId: {
        type: DataTypes.STRING(100),
        allowNull: false
      },
      eventType: {
        type: DataTypes.STRING(50),
        allowNull: false
      },
      whatsappId: {
        type: DataTypes.INTEGER,
        allowNull: false,
        references: { model: "Whatsapps", key: "id" },
        onUpdate: "CASCADE",
        onDelete: "CASCADE"
      },
      payload: {
        type: DataTypes.JSONB,
        allowNull: false
      },
      processedAt: {
        type: DataTypes.DATE,
        allowNull: false,
        defaultValue: DataTypes.NOW
      }
    });

    // Idempotencia: (uazapiEventId, whatsappId) e a chave logica de dedupe.
    // Inserts duplicados violam essa constraint — handler trata como skip.
    await queryInterface.addIndex(
      "WebhookEvents",
      ["uazapiEventId", "whatsappId"],
      {
        name: "uniq_webhook_event_id_wid",
        unique: true
      }
    );

    // Index para o cleanup job e queries de auditoria.
    await queryInterface.addIndex(
      "WebhookEvents",
      ["whatsappId", "processedAt"],
      {
        name: "idx_webhook_events_wid_processed"
      }
    );
  },

  down: async (queryInterface: QueryInterface) => {
    await queryInterface.dropTable("WebhookEvents");
  }
};
