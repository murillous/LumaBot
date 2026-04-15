import {
  makeWASocket,
  DisconnectReason,
  useMultiFileAuthState,
  fetchLatestBaileysVersion,
} from "@whiskeysockets/baileys";
import fs from "fs";
import pino from "pino";
import { CONFIG, MESSAGES } from "../config/constants.js";
import { Logger } from "../utils/Logger.js";
import { env } from "../config/env.js";
import { FileSystem } from "../utils/FileSystem.js";
import { MessageHandler } from "../handlers/MessageHandler.js";
import { BaileysAdapter } from "../adapters/BaileysAdapter.js";

let qrcode;
try {
  const qrcodeModule = await import("qrcode-terminal");
  qrcode = qrcodeModule.default;
} catch (e) {
  console.log("💡 Para QR Code visual, instale: npm install qrcode-terminal");
}

export class ConnectionManager {
  constructor() {
    this.sock = null;
    this.isConnecting = false;
    this.reconnectAttempts = 0;
    this.lastCleanTime = 0;
    this.qrRetries = 0;
    this.maxQrRetries = 5;
  }

  async initialize() {
    if (this.isConnecting) {
      Logger.info("⏳ Já existe uma tentativa de conexão em andamento...");
      return;
    }

    this.isConnecting = true;

    try {
      this.closeSafely();
      Logger.info(MESSAGES.CONNECTING);

      const { version, isLatest } = await fetchLatestBaileysVersion();
      Logger.info(`📦 Usando WA v${version.join(".")}, isLatest: ${isLatest}`);

      const { state, saveCreds } = await useMultiFileAuthState(CONFIG.AUTH_DIR);
      const logger = pino({ level: env.LOG_LEVEL });

      this.sock = makeWASocket({
        version,
        auth: state,
        logger,
        browser: ["Ubuntu", "Chrome", "20.0.04"],
        printQRInTerminal: false,
        defaultQueryTimeoutMs: CONFIG.TIMEOUT_MS,
        connectTimeoutMs: CONFIG.TIMEOUT_MS,
        keepAliveIntervalMs: CONFIG.KEEPALIVE_MS,
        qrTimeout: 60000,
        retryRequestDelayMs: 2000,
        emitOwnEvents: false,
        markOnlineOnConnect: true,
        syncFullHistory: false,
        generateHighQualityLinkPreview: false,
        fireInitQueries: false,
        getMessage: async () => undefined,
      });

      this.setupEventHandlers(saveCreds);
    } catch (error) {
      Logger.error("❌ Erro ao iniciar o bot:", error);
      this.isConnecting = false;
      await this.handleInitializationError(error);
    }
  }

  closeSafely() {
    if (this.sock) {
      try {
        this.sock.end(undefined);
      } catch (error) { }
      this.sock = null;
    }
  }

  setupEventHandlers(saveCreds) {
    this.sock.ev.on("connection.update", (update) =>
      this.handleConnectionUpdate(update),
    );

    this.sock.ev.on("creds.update", saveCreds);

    this.sock.ev.on("messages.upsert", (m) => this.handleMessagesUpsert(m));
  }

  async handleConnectionUpdate(update) {
    const { connection, lastDisconnect, qr } = update;

    try {
      if (qr) {
        this.qrRetries++;
        this.displayQrCode(qr);
      }

      if (connection === "close") {
        process.stdout.write("[LUMA_STATUS]:disconnected\n");
        await this.handleDisconnection(lastDisconnect);
      } else if (connection === "connecting") {
        process.stdout.write("[LUMA_STATUS]:connecting\n");
        Logger.info("🔗 Conectando...");
      } else if (connection === "open") {
        process.stdout.write("[LUMA_STATUS]:connected\n");
        Logger.info(MESSAGES.CONNECTED);
        this.isConnecting = false;
        this.reconnectAttempts = 0;
        this.qrRetries = 0;
      }
    } catch (error) {
      Logger.error("Erro no handler de conexão:", error);
      this.isConnecting = false;
    }
  }

  displayQrCode(qr) {
    Logger.info(
      `\n📱 QR Code gerado! (Tentativa ${this.qrRetries}/${this.maxQrRetries})`,
    );
    Logger.info(
      "📶 IMPORTANTE: Certifique-se de ter boa conexão no celular!\n",
    );

    // Sinal para o dashboard renderizar o QR no browser
    process.stdout.write(`[LUMA_QR]:${qr}\n`);

    if (qrcode) {
      qrcode.generate(qr, { small: true });
    } else {
      Logger.info("QR Code (texto):", qr);
      Logger.info("\n💡 Instale qrcode-terminal para QR visual\n");
    }

    Logger.info("\n⏰ QR Code expira em ~60 segundos");
  }

  async handleDisconnection(lastDisconnect) {
    this.isConnecting = false;
    const statusCode = lastDisconnect?.error?.output?.statusCode;
    const errorMessage = lastDisconnect?.error?.message || "Desconhecido";

    Logger.info(`🔌 Desconectado: ${errorMessage}`);

    if (statusCode) {
      Logger.info(`📊 Status Code: ${statusCode}`);
    }

    if (
      statusCode === 408 ||
      statusCode === 440 ||
      errorMessage.includes("timed out")
    ) {
      if (this.qrRetries >= this.maxQrRetries) {
        Logger.info(
          `❌ Máximo de tentativas de QR atingido (${this.maxQrRetries})`,
        );
        Logger.info("🧹 Limpando sessão para nova tentativa...\n");
        await this.cleanAndRestart();
        return;
      }

      Logger.info("⏱️ Timeout ao escanear QR - gerando novo código...");
      await new Promise((r) => setTimeout(r, 3000));
      this.isConnecting = false;
      await this.initialize();
      return;
    }

    if (
      statusCode === 503 ||
      statusCode === 500 ||
      errorMessage.includes("Connection Failure")
    ) {
      Logger.info("📡 Erro de conexão detectado - tentando novamente...");
      await new Promise((r) => setTimeout(r, 5000));
      this.isConnecting = false;
      await this.initialize();
      return;
    }

    if (this.isAuthenticationError(statusCode)) {
      await this.cleanAndRestart();
      return;
    }

    if (statusCode === DisconnectReason.loggedOut) {
      Logger.info("🔄 Deslogado do WhatsApp - gerando novo QR");
      await this.cleanAndRestart();
      return;
    }

    const shouldReconnect = statusCode !== DisconnectReason.loggedOut;
    if (shouldReconnect) {
      await this.reconnect();
    } else {
      Logger.info("🛑 Bot finalizado");
      process.exit(0);
    }
  }

  isAuthenticationError(statusCode) {
    return [405, 401, 403].includes(statusCode);
  }

  async handleMessagesUpsert(m) {
    try {
      if (m.type !== "notify") return;

      for (const message of m.messages) {
        if (!message.message) continue;
        const botAdapter = new BaileysAdapter(this.sock, message);

        await MessageHandler.process(botAdapter);
      }
    } catch (error) {
      Logger.error("Erro ao processar mensagem:", error);
    }
  }

  async cleanAndRestart() {
    Logger.info("🧹 Limpando sessão...");
    this.lastCleanTime = Date.now();
    this.qrRetries = 0;

    try {
      this.closeSafely();

      if (fs.existsSync(CONFIG.AUTH_DIR)) {
        FileSystem.removeDir(CONFIG.AUTH_DIR);
        Logger.info("✅ Sessão removida");
      }

      await new Promise((r) => setTimeout(r, 3000));
      Logger.info("🚀 Reiniciando...\n");

      this.reconnectAttempts = 0;
      this.isConnecting = false;
      await this.initialize();
    } catch (error) {
      Logger.error("❌ Erro ao limpar:", error);
      Logger.warn("⚠️ Remova manualmente a pasta 'auth_info' e reinicie");
      process.exit(1);
    }
  }

  async reconnect() {
    if (this.reconnectAttempts >= CONFIG.MAX_RECONNECT_ATTEMPTS) {
      Logger.info(
        `❌ Máximo de ${CONFIG.MAX_RECONNECT_ATTEMPTS} tentativas atingido`,
      );
      Logger.info("🧹 Limpando sessão...\n");
      await this.cleanAndRestart();
      return;
    }

    this.reconnectAttempts++;
    const delay = Math.min(
      CONFIG.RECONNECT_DELAY * this.reconnectAttempts,
      15000,
    );

    Logger.info(
      `⏳ Reconectando em ${delay / 1000}s (${this.reconnectAttempts}/${CONFIG.MAX_RECONNECT_ATTEMPTS
      })...`,
    );

    await new Promise((r) => setTimeout(r, delay));
    this.isConnecting = false;
    await this.initialize();
  }

  async handleInitializationError(error) {
    const now = Date.now();
    if (now - this.lastCleanTime > CONFIG.MIN_CLEAN_INTERVAL || 60000) {
      if (this.isAuthError(error.message)) {
        await this.cleanAndRestart();
      } else {
        await this.reconnect();
      }
    } else {
      Logger.info("⏳ Aguardando antes de tentar novamente...");
      await new Promise((r) => setTimeout(r, 10000));
      await this.reconnect();
    }
  }

  isAuthError(message) {
    return ["405", "auth", "401", "Connection Failure"].some((err) =>
      message.includes(err),
    );
  }

  gracefulShutdown() {
    Logger.info("\n🛑 Finalizando...");
    this.closeSafely();
    try {
      FileSystem.cleanupDir(CONFIG.TEMP_DIR);
    } catch (e) { }
    Logger.info("✅ Finalizado");
    process.exit(0);
  }
}
