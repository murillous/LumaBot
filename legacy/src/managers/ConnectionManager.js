import fs from 'fs';
import { CONFIG, MESSAGES } from '../config/constants.js';
import { Logger } from '../utils/Logger.js';
import { env } from '../config/env.js';
import { FileSystem } from '../utils/FileSystem.js';
import { prepareBaileysSession, createBaileysSocket } from '../infra/BaileysSocketFactory.js';
import { presentQrCode } from '../infra/QrCodePresenter.js';
import { routeMessages } from '../infra/MessageRouter.js';
import { ReconnectionPolicy } from '../infra/ReconnectionPolicy.js';
import { UserResolver } from '../core/services/UserResolver.js';
import { ReminderScheduler } from '../infra/ReminderScheduler.js';

/**
 * Coordenador do ciclo de vida do socket WhatsApp.
 * Inicializa a conexão, gerencia reconexões e encaminha eventos.
 */
export class ConnectionManager {
  constructor() {
    this.sock         = null;
    this.isConnecting = false;
    this.policy       = new ReconnectionPolicy(CONFIG);
    this.reminderScheduler = new ReminderScheduler();
  }

  async initialize() {
    if (this.isConnecting) {
      Logger.info('⏳ Já existe uma tentativa de conexão em andamento...');
      return;
    }

    this.isConnecting = true;

    try {
      this.closeSafely();
      Logger.info(MESSAGES.CONNECTING);

      const { version, isLatest, state, saveCreds } = await prepareBaileysSession(CONFIG);
      Logger.info(`📦 Usando WA v${version.join('.')}, isLatest: ${isLatest}`);

      this.sock = createBaileysSocket({ state, version, config: CONFIG, logLevel: env.LOG_LEVEL });

      this.setupEventHandlers(saveCreds);
    } catch (error) {
      Logger.error('❌ Erro ao iniciar o bot:', error);
      this.isConnecting = false;
      await this.handleInitializationError(error);
    }
  }

  closeSafely() {
    if (this.sock) {
      try { this.sock.end(undefined); } catch {}
      this.sock = null;
    }
  }

  setupEventHandlers(saveCreds) {
    this.sock.ev.on('connection.update', update => this.handleConnectionUpdate(update));
    this.sock.ev.on('creds.update', saveCreds);
    this.sock.ev.on('messages.upsert', m => routeMessages(this.sock, m));
    // Eventos de contato enriquecem os perfis de usuário (nome, número, LID).
    this.sock.ev.on('contacts.upsert', contacts => this.handleContacts(contacts));
    this.sock.ev.on('contacts.update', contacts => this.handleContacts(contacts));
  }

  /** Persiste/atualiza perfis a partir de eventos de contato do Baileys. */
  handleContacts(contacts) {
    if (!Array.isArray(contacts)) return;
    for (const contact of contacts) {
      UserResolver.upsertFromContact(contact);
    }
  }

  async handleConnectionUpdate(update) {
    const { connection, lastDisconnect, qr } = update;

    try {
      if (qr) {
        this.policy.qrRetries++;
        await presentQrCode(qr, {
          attempt:     this.policy.qrRetries,
          maxAttempts: this.policy.maxQrRetries,
        });
      }

      if (connection === 'close') {
        process.stdout.write('[LUMA_STATUS]:disconnected\n');
        await this.handleDisconnection(lastDisconnect);
      } else if (connection === 'connecting') {
        process.stdout.write('[LUMA_STATUS]:connecting\n');
        Logger.info('🔗 Conectando...');
      } else if (connection === 'open') {
        process.stdout.write('[LUMA_STATUS]:connected\n');
        Logger.info(MESSAGES.CONNECTED);
        this.isConnecting = false;
        this.policy.resetAttempts();
        this.reminderScheduler.start(this.sock);
      }
    } catch (error) {
      Logger.error('Erro no handler de conexão:', error);
      this.isConnecting = false;
    }
  }

  async handleDisconnection(lastDisconnect) {
    this.isConnecting = false;
    const statusCode   = lastDisconnect?.error?.output?.statusCode;
    const errorMessage = lastDisconnect?.error?.message || 'Desconhecido';

    Logger.info(`🔌 Desconectado: ${errorMessage}`);
    if (statusCode) Logger.info(`📊 Status Code: ${statusCode}`);

    const action = this.policy.decide(statusCode, errorMessage);

    switch (action) {
      case 'qr_max_reached':
        Logger.info(`❌ Máximo de tentativas de QR atingido (${this.policy.maxQrRetries})`);
        Logger.info('🧹 Limpando sessão para nova tentativa...\n');
        await this.cleanAndRestart();
        break;

      case 'regenerate_qr':
        Logger.info('⏱️ Timeout ao escanear QR - gerando novo código...');
        await new Promise(r => setTimeout(r, 3000));
        this.isConnecting = false;
        await this.initialize();
        break;

      case 'retry_connection':
        Logger.info('📡 Erro de conexão detectado - tentando novamente...');
        await new Promise(r => setTimeout(r, 5000));
        this.isConnecting = false;
        await this.initialize();
        break;

      case 'clean_and_restart':
        Logger.info('🔄 Reiniciando sessão...');
        await this.cleanAndRestart();
        break;

      default: // 'reconnect'
        await this.reconnect();
        break;
    }
  }

  async cleanAndRestart() {
    Logger.info('🧹 Limpando sessão...');
    this.policy.markCleanTime();
    this.policy.resetAttempts();

    try {
      this.closeSafely();

      if (fs.existsSync(CONFIG.AUTH_DIR)) {
        FileSystem.removeDir(CONFIG.AUTH_DIR);
        Logger.info('✅ Sessão removida');
      }

      await new Promise(r => setTimeout(r, 3000));
      Logger.info('🚀 Reiniciando...\n');

      this.isConnecting = false;
      await this.initialize();
    } catch (error) {
      Logger.error('❌ Erro ao limpar:', error);
      Logger.warn("⚠️ Remova manualmente a pasta 'auth_info' e reinicie");
      process.exit(1);
    }
  }

  async reconnect() {
    const { delayMs, hasReachedLimit } = this.policy.nextReconnectDelay();

    if (hasReachedLimit) {
      Logger.info(`❌ Máximo de ${CONFIG.MAX_RECONNECT_ATTEMPTS} tentativas atingido`);
      Logger.info('🧹 Limpando sessão...\n');
      await this.cleanAndRestart();
      return;
    }

    Logger.info(`⏳ Reconectando em ${delayMs / 1000}s (${this.policy.reconnectAttempts}/${CONFIG.MAX_RECONNECT_ATTEMPTS})...`);
    await new Promise(r => setTimeout(r, delayMs));
    this.isConnecting = false;
    await this.initialize();
  }

  async handleInitializationError(error) {
    const now = Date.now();
    // NOTE: bug pré-existente — `|| 60000` é sempre truthy, preservado intencionalmente.
    if (now - this.policy.lastCleanTime > CONFIG.MIN_CLEAN_INTERVAL || 60000) {
      if (this.policy.isAuthError(error.message)) {
        await this.cleanAndRestart();
      } else {
        await this.reconnect();
      }
    } else {
      Logger.info('⏳ Aguardando antes de tentar novamente...');
      await new Promise(r => setTimeout(r, 10000));
      await this.reconnect();
    }
  }

  gracefulShutdown() {
    Logger.info('\n🛑 Finalizando...');
    this.reminderScheduler.stop();
    this.closeSafely();
    try { FileSystem.cleanupDir(CONFIG.TEMP_DIR); } catch {}
    Logger.info('✅ Finalizado');
    process.exit(0);
  }
}
