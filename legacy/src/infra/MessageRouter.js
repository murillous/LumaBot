import { Logger } from '../utils/Logger.js';
import { BaileysAdapter } from '../adapters/BaileysAdapter.js';
import { MessageHandler } from '../handlers/MessageHandler.js';
import { JidQueue } from './JidQueue.js';
import { UserResolver } from '../core/services/UserResolver.js';

/**
 * Enriquece os perfis de usuário a partir da mensagem recebida: o remetente
 * (com pushName) e cada JID mencionado (registro básico). Nunca lança — falha
 * de persistência não pode bloquear o processamento da mensagem.
 */
async function trackUsers(botAdapter) {
  try {
    if (botAdapter.isFromMe) return;
    UserResolver.upsertFromMessage(botAdapter.senderJid, {
      pushName: botAdapter.message?.pushName,
    });
    const mentioned = await botAdapter.getMentionedJids();
    for (const jid of mentioned) UserResolver.register(jid);
  } catch (error) {
    Logger.error('Erro ao registrar usuários da mensagem:', error);
  }
}

/**
 * Fila global por JID: mensagens do mesmo chat são serializadas,
 * chats diferentes são processados em paralelo.
 */
const queue = new JidQueue();

// Rate limiting simples por JID
const MAX_BODY_LENGTH = 4096;
const MAX_SENDER_NAME_LENGTH = 100;
const rateLimiter = new Map();
const RATE_LIMIT_WINDOW_MS = 1000;
const RATE_LIMIT_MAX_MSGS = 10;

function cleanJid(jid) {
  return jid?.split(':')[0].split('@')[0].replace(/\D/g, '') || null;
}

function isOwnPrivateChat(sock, botAdapter) {
  if (botAdapter.isGroup) return false;

  const chatId = cleanJid(botAdapter.jid);
  const ownIds = [
    sock.user?.id,
    sock.user?.lid,
    sock.authState?.creds?.me?.id,
    sock.authState?.creds?.me?.lid,
  ].map(cleanJid).filter(Boolean);

  return !!chatId && ownIds.includes(chatId);
}

function isRateLimited(jid) {
  const now = Date.now();
  const record = rateLimiter.get(jid);
  if (!record) {
    rateLimiter.set(jid, { count: 1, windowStart: now });
    return false;
  }
  if (now - record.windowStart > RATE_LIMIT_WINDOW_MS) {
    record.count = 1;
    record.windowStart = now;
    return false;
  }
  record.count++;
  return record.count > RATE_LIMIT_MAX_MSGS;
}

function sanitizeInput(botAdapter) {
  if (botAdapter.body && botAdapter.body.length > MAX_BODY_LENGTH) {
    Logger.warn(`⚠️ Mensagem de ${botAdapter.jid} truncada (${botAdapter.body.length} chars)`);
    botAdapter.message.message = botAdapter.message.message || {};
    // Não podemos reatribuir body diretamente porque é um getter,
    // então truncamos no objeto interno se possível
    const text = botAdapter.body.substring(0, MAX_BODY_LENGTH);
    const msg = botAdapter.message.message;
    if (msg.conversation) msg.conversation = text;
    else if (msg.extendedTextMessage) msg.extendedTextMessage.text = text;
    else if (msg.imageMessage) msg.imageMessage.caption = text;
    else if (msg.videoMessage) msg.videoMessage.caption = text;
  }
  if (botAdapter.senderName && botAdapter.senderName.length > MAX_SENDER_NAME_LENGTH) {
    Logger.warn(`⚠️ senderName de ${botAdapter.jid} truncado`);
    botAdapter.message.pushName = botAdapter.senderName.substring(0, MAX_SENDER_NAME_LENGTH);
  }
}

/**
 * Recebe o evento `messages.upsert` do Baileys, cria um BaileysAdapter
 * para cada mensagem e delega o processamento ao MessageHandler via JidQueue.
 *
 * @param {import('@whiskeysockets/baileys').WASocket} sock
 * @param {{ type: string, messages: object[] }} m - Payload do evento messages.upsert
 */
export async function routeMessages(sock, m) {
  try {
    if (m.type !== 'notify') return;

    const pending = [];
    for (const message of m.messages) {
      if (!message.message) continue;
      const botAdapter = new BaileysAdapter(sock, message);

      if (botAdapter.isFromMe || isOwnPrivateChat(sock, botAdapter)) {
        continue;
      }

      if (isRateLimited(botAdapter.jid)) {
        Logger.warn(`⛔ Rate limit atingido para ${botAdapter.jid}`);
        continue;
      }

      sanitizeInput(botAdapter);
      await trackUsers(botAdapter);

      pending.push(
        queue.enqueue(botAdapter.jid, () => MessageHandler.process(botAdapter)),
      );
    }

    await Promise.all(pending);
  } catch (error) {
    Logger.error('Erro ao processar mensagem:', error);
  }
}
