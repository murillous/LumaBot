# 📱 Conexão WhatsApp (Baileys)

O Baileys é uma biblioteca incrível que faz engenharia reversa do protocolo WebSocket do WhatsApp Web.

## 🔐 Autenticação (`auth_info`)

Quando você escaneia o QR Code, o Baileys gera chaves criptográficas (Noise Protocol).

### Como Funciona a Autenticação

```
1. Você inicia o bot
2. Baileys gera um par de chaves (pública + privada)
3. QR Code contém: chave pública + informações de sessão
4. Você escaneia com WhatsApp
5. WhatsApp envia: chave de sessão criptografada
6. Baileys descriptografa e salva em auth_info/
7. Conexão estabelecida ✓
```

### Estrutura da Pasta `auth_info/`

```
auth_info/
├── creds.json          # Credenciais principais
├── app-state-sync-key-*.json  # Chaves de sincronização
└── app-state-sync-version-*.json  # Versões de estado
```

**⚠️ CRÍTICO:** Se alguém roubar essa pasta, pode clonar seu WhatsApp. Mantenha fora do Git!

### Implementação da Autenticação

```javascript
// src/managers/ConnectionManager.js
const { useMultiFileAuthState } = require('@whiskeysockets/baileys');
const path = require('path');

class ConnectionManager {
    async initializeAuth() {
        const authPath = path.join(__dirname, '../../auth_info');
        
        // Carrega ou cria estado de autenticação
        const { state, saveCreds } = await useMultiFileAuthState(authPath);
        
        // saveCreds é chamado automaticamente quando há mudanças
        return { state, saveCreds };
    }
}
```

### Autenticação com Pairing Code (Alternativa ao QR)

```javascript
async initializeWithPairingCode(phoneNumber) {
    const { state, saveCreds } = await this.initializeAuth();
    
    const sock = makeWASocket({
        auth: state,
        printQRInTerminal: false  // Desabilita QR
    });
    
    // Solicita código de pareamento
    const code = await sock.requestPairingCode(phoneNumber);
    console.log(`Código de pareamento: ${code}`);
    
    // Usuário digita este código no celular:
    // WhatsApp > Dispositivos Conectados > Conectar Dispositivo > "Usar número de telefone"
    
    return { sock, saveCreds };
}
```

## ♻️ Gerenciamento de Quedas

Conexões de WhatsApp caem. É normal. O `ConnectionManager.js` lida com isso usando uma **Máquina de Estados**.

### Diagrama de Estados

```
┌─────────────┐
│ CONNECTING  │ ──┐
└─────────────┘   │
       │          │
       ▼          │
┌─────────────┐   │
│   OPEN      │   │ Reconexão
└─────────────┘   │
       │          │
       ▼          │
┌─────────────┐   │
│   CLOSE     │ ──┘
└─────────────┘
```

### Tipos de Desconexão

```javascript
class ConnectionManager {
    handleDisconnection(reason) {
        const { statusCode, error } = reason;
        
        switch(statusCode) {
            case DisconnectReason.connectionClosed:
                // Conexão fechada normalmente (ex: reinício do servidor WA)
                return this.reconnect();
            
            case DisconnectReason.connectionLost:
                // Perda de rede temporária
                return this.reconnect();
            
            case DisconnectReason.timedOut:
                // Timeout de conexão
                return this.reconnectWithDelay(5000);
            
            case DisconnectReason.loggedOut:
                // Desconectado pelo celular (logout manual)
                return this.cleanAndRestart();
            
            case DisconnectReason.badSession:
                // Sessão corrompida
                return this.cleanAndRestart();
            
            case DisconnectReason.restartRequired:
                // WhatsApp solicitou reinício
                return this.reconnect();
            
            default:
                console.error('Erro desconhecido:', error);
                return this.reconnectWithBackoff();
        }
    }
}
```

### Estratégia de Reconnect com Backoff

```javascript
class ConnectionManager {
    constructor() {
        this.reconnectAttempts = 0;
        this.maxReconnectAttempts = 10;
        this.baseDelay = 1000; // 1 segundo
    }
    
    async reconnectWithBackoff() {
        if (this.reconnectAttempts >= this.maxReconnectAttempts) {
            console.error('Máximo de tentativas atingido. Parando bot.');
            process.exit(1);
        }
        
        // Backoff exponencial: 1s, 2s, 4s, 8s, 16s, ...
        const delay = this.baseDelay * Math.pow(2, this.reconnectAttempts);
        const jitter = Math.random() * 1000; // Adiciona aleatoriedade
        const finalDelay = Math.min(delay + jitter, 60000); // Máx 60s
        
        console.log(`Tentativa ${this.reconnectAttempts + 1}/${this.maxReconnectAttempts}`);
        console.log(`Aguardando ${(finalDelay / 1000).toFixed(1)}s antes de reconectar...`);
        
        await this.sleep(finalDelay);
        
        this.reconnectAttempts++;
        
        try {
            await this.initialize();
            this.reconnectAttempts = 0; // Reset após sucesso
        } catch (error) {
            console.error('Falha na reconexão:', error.message);
            return this.reconnectWithBackoff(); // Tenta novamente
        }
    }
    
    async cleanAndRestart() {
        console.log('Limpando autenticação e reiniciando...');
        
        // Remove pasta auth_info
        const authPath = path.join(__dirname, '../../auth_info');
        await fs.rm(authPath, { recursive: true, force: true });
        
        // Recria conexão (novo QR Code)
        this.reconnectAttempts = 0;
        await this.initialize();
    }
}
```

### Health Check Automático

```javascript
class ConnectionManager {
    startHealthCheck() {
        // Verifica conexão a cada 30 segundos
        this.healthCheckInterval = setInterval(async () => {
            if (!this.isConnected()) {
                console.warn('[HealthCheck] Conexão perdida. Tentando reconectar...');
                await this.reconnect();
            }
        }, 30000);
    }
    
    isConnected() {
        return this.sock?.user?.id !== undefined;
    }
    
    stopHealthCheck() {
        if (this.healthCheckInterval) {
            clearInterval(this.healthCheckInterval);
        }
    }
}
```

## 📨 Recebimento de Mensagens (`messages.upsert`)

Este é o evento mais importante. Ele dispara sempre que chega algo novo.

### Estrutura da Mensagem do Baileys

```javascript
{
    key: {
        remoteJid: '5511999999999@s.whatsapp.net',  // Remetente
        fromMe: false,                               // Enviada por você?
        id: '3EB0ABCD1234567890'                    // ID único
    },
    message: {
        conversation: 'Oi',                          // Texto simples
        // OU
        imageMessage: {
            url: 'https://...',
            mimetype: 'image/jpeg',
            caption: 'Olha isso'
        },
        // OU
        extendedTextMessage: {
            text: 'Respondendo',
            contextInfo: {
                quotedMessage: {...}                 // Mensagem citada
            }
        }
    },
    messageTimestamp: 1704067200,
    pushName: 'João Silva'
}
```

### Normalizador de Mensagens

```javascript
// src/handlers/MessageHandler.js
class MessageHandler {
    normalize(rawMessage) {
        const { key, message, messageTimestamp, pushName } = rawMessage;
        
        return {
            // Identificação
            id: key.id,
            from: key.remoteJid,
            fromMe: key.fromMe,
            sender: this.extractSender(key),
            
            // Tipo de chat
            isGroup: key.remoteJid.endsWith('@g.us'),
            isPrivate: key.remoteJid.endsWith('@s.whatsapp.net'),
            
            // Conteúdo
            text: this.extractText(message),
            hasMedia: this.hasMedia(message),
            mediaType: this.getMediaType(message),
            quoted: this.extractQuoted(message),
            
            // Metadados
            timestamp: messageTimestamp,
            pushName: pushName,
            
            // Original (para casos avançados)
            raw: rawMessage
        };
    }
    
    extractText(message) {
        return message.conversation ||
               message.extendedTextMessage?.text ||
               message.imageMessage?.caption ||
               message.videoMessage?.caption ||
               '';
    }
    
    hasMedia(message) {
        return !!(
            message.imageMessage ||
            message.videoMessage ||
            message.audioMessage ||
            message.documentMessage ||
            message.stickerMessage
        );
    }
    
    getMediaType(message) {
        if (message.imageMessage) return 'image';
        if (message.videoMessage) return 'video';
        if (message.audioMessage) return 'audio';
        if (message.documentMessage) return 'document';
        if (message.stickerMessage) return 'sticker';
        return null;
    }
    
    extractQuoted(message) {
        const contextInfo = message.extendedTextMessage?.contextInfo;
        if (!contextInfo?.quotedMessage) return null;
        
        return {
            id: contextInfo.stanzaId,
            participant: contextInfo.participant,
            message: contextInfo.quotedMessage
        };
    }
    
    extractSender(key) {
        // Em grupos, o remetente vem no participant
        if (key.participant) {
            return key.participant;
        }
        // Em privado, é o próprio remoteJid
        return key.remoteJid;
    }
}
```

## 📤 Envio de Mensagens

### Mensagem de Texto Simples

```javascript
await sock.sendMessage(jid, {
    text: 'Olá! Como posso ajudar?'
});
```

### Mensagem com Menção

```javascript
await sock.sendMessage(groupJid, {
    text: '@5511999999999 Olha isso!',
    mentions: ['5511999999999@s.whatsapp.net']
});
```

### Mensagem Respondendo Outra

```javascript
await sock.sendMessage(jid, {
    text: 'Entendi!',
    quoted: originalMessage  // Objeto da mensagem original
});
```

### Envio de Mídia

```javascript
// Imagem
await sock.sendMessage(jid, {
    image: imageBuffer,  // ou { url: 'https://...' }
    caption: 'Legenda opcional'
});

// Vídeo
await sock.sendMessage(jid, {
    video: videoBuffer,
    caption: 'Legenda',
    gifPlayback: true  // Reproduz como GIF
});

// Áudio
await sock.sendMessage(jid, {
    audio: audioBuffer,
    mimetype: 'audio/mp4',
    ptt: true  // Push to Talk (áudio de voz)
});

// Sticker
await sock.sendMessage(jid, {
    sticker: stickerBuffer
});
```

### Indicadores de Digitação

```javascript
// Mostra "digitando..."
await sock.sendPresenceUpdate('composing', jid);

// Simula digitação por 2 segundos
await sock.sendPresenceUpdate('composing', jid);
await new Promise(resolve => setTimeout(resolve, 2000));
await sock.sendMessage(jid, { text: 'Pronto!' });

// Para de digitar
await sock.sendPresenceUpdate('paused', jid);
```

### Reações a Mensagens

```javascript
await sock.sendMessage(jid, {
    react: {
        text: '👍',  // Emoji
        key: messageKey  // Chave da mensagem original
    }
});
```

## 🎯 Download de Mídia

```javascript
const { downloadMediaMessage } = require('@whiskeysockets/baileys');

class MediaDownloader {
    async download(message) {
        try {
            // Baixa o buffer
            const buffer = await downloadMediaMessage(
                message,
                'buffer',
                {},
                {
                    logger: console,
                    reuploadRequest: sock.updateMediaMessage
                }
            );
            
            return buffer;
        } catch (error) {
            console.error('Erro ao baixar mídia:', error);
            throw error;
        }
    }
    
    async downloadWithRetry(message, maxRetries = 3) {
        for (let i = 0; i < maxRetries; i++) {
            try {
                return await this.download(message);
            } catch (error) {
                if (i === maxRetries - 1) throw error;
                
                console.log(`Tentativa ${i + 1}/${maxRetries} falhou. Tentando novamente...`);
                await this.sleep(2000 * (i + 1)); // Backoff
            }
        }
    }
}
```

## 👤 Enriquecimento de Usuários (`contacts.*`)

Além de `messages.upsert`, o `ConnectionManager` registra os eventos de contato
do Baileys para enriquecer os perfis em `wa_users` (via `UserResolver`):

```javascript
// src/managers/ConnectionManager.js → setupEventHandlers()
this.sock.ev.on('contacts.upsert', contacts => this.handleContacts(contacts));
this.sock.ev.on('contacts.update', contacts => this.handleContacts(contacts));
// handleContacts → UserResolver.upsertFromContact({ id, name, notify, lid, ... })
```

Em paralelo, o `MessageRouter` faz upsert do remetente (com `pushName`) e
registro básico dos JIDs mencionados a cada mensagem — é o ponto único por onde
toda mensagem passa. Nenhuma dessas operações bloqueia o processamento se falhar.

Por que não resolver JID→nome em tempo real? Porque o WhatsApp não garante o
nome a partir de um JID arbitrário (especialmente `@lid`). Acumular fontes ao
longo do tempo e escolher o melhor nome na exibição é mais robusto. Ver
[04-banco-dados.md](./04-banco-dados.md) e o `UserResolver`.

## ⏰ Agendador de Lembretes

O `ConnectionManager` instancia um `ReminderScheduler` e o inicia quando a
conexão abre (`connection === 'open'`), repassando o socket atual a cada
reconexão. O loop (30s) busca lembretes vencidos no SQLite e os dispara
mencionando as pessoas no grupo (ou no PV). Como vivem no banco, **sobrevivem a
reinícios** — o primeiro tick após subir recupera o que venceu offline.

## 🔔 Outros Eventos Importantes

### Atualização de Presença

```javascript
sock.ev.on('presence.update', ({ id, presences }) => {
    // id: JID do chat
    // presences: { [participantJid]: { lastKnownPresence: 'available' | 'unavailable' } }
    
    for (const [jid, presence] of Object.entries(presences)) {
        console.log(`${jid} está ${presence.lastKnownPresence}`);
    }
});
```

### Atualização de Grupo

```javascript
sock.ev.on('groups.update', (updates) => {
    for (const update of updates) {
        console.log(`Grupo ${update.id} foi atualizado:`, update);
        // Campos possíveis: subject (nome), desc (descrição), announce, restrict, etc.
    }
});
```

### Participantes Adicionados/Removidos

```javascript
sock.ev.on('group-participants.update', ({ id, participants, action }) => {
    // action: 'add' | 'remove' | 'promote' | 'demote'
    
    if (action === 'add') {
        const welcomeMsg = `Bem-vindos ${participants.join(', ')}!`;
        sock.sendMessage(id, { text: welcomeMsg, mentions: participants });
    }
});
```

### Mensagens Deletadas

```javascript
sock.ev.on('messages.delete', ({ keys }) => {
    for (const key of keys) {
        console.log(`Mensagem ${key.id} foi deletada de ${key.remoteJid}`);
    }
});
```

## ⚡ Otimizações de Performance

### 1. Reuso de Socket

```javascript
// ❌ Ruim: Criar nova conexão para cada mensagem
async function sendMessage(text) {
    const sock = await createConnection();
    await sock.sendMessage(jid, { text });
    sock.end();
}

// ✅ Bom: Reutilizar socket global
const sock = await createConnection();

async function sendMessage(text) {
    await sock.sendMessage(jid, { text });
}
```

### 2. Queue de Mensagens

Evita rate limit do WhatsApp:

```javascript
class MessageQueue {
    constructor() {
        this.queue = [];
        this.processing = false;
        this.minDelay = 1000; // 1 segundo entre mensagens
    }
    
    async send(jid, content) {
        return new Promise((resolve, reject) => {
            this.queue.push({ jid, content, resolve, reject });
            this.process();
        });
    }
    
    async process() {
        if (this.processing || this.queue.length === 0) return;
        
        this.processing = true;
        
        while (this.queue.length > 0) {
            const { jid, content, resolve, reject } = this.queue.shift();
            
            try {
                const result = await sock.sendMessage(jid, content);
                resolve(result);
            } catch (error) {
                reject(error);
            }
            
            // Aguarda antes da próxima
            await this.sleep(this.minDelay);
        }
        
        this.processing = false;
    }
}

const messageQueue = new MessageQueue();

// Uso:
await messageQueue.send(jid, { text: 'Mensagem 1' });
await messageQueue.send(jid, { text: 'Mensagem 2' });
// Serão enviadas com 1s de intervalo automaticamente
```

### 3. Cache de Informações de Grupos

```javascript
class GroupCache {
    constructor() {
        this.cache = new Map();
        this.ttl = 3600000; // 1 hora
    }
    
    async getGroupMetadata(groupJid) {
        const cached = this.cache.get(groupJid);
        
        if (cached && Date.now() - cached.timestamp < this.ttl) {
            return cached.data;
        }
        
        // Busca do WhatsApp
        const metadata = await sock.groupMetadata(groupJid);
        
        this.cache.set(groupJid, {
            data: metadata,
            timestamp: Date.now()
        });
        
        return metadata;
    }
}
```

## 🛡️ Tratamento de Erros

```javascript
class ErrorHandler {
    handle(error, context) {
        // Log estruturado
        console.error('[ErrorHandler]', {
            context,
            error: error.message,
            stack: error.stack,
            timestamp: new Date().toISOString()
        });
        
        // Decisão baseada no tipo de erro
        if (error.message.includes('rate limit')) {
            return this.handleRateLimit();
        }
        
        if (error.message.includes('connection')) {
            return this.handleConnectionError();
        }
        
        if (error.message.includes('invalid')) {
            return this.handleInvalidRequest();
        }
        
        // Erro genérico
        DatabaseService.logError({
            type: 'unknown',
            message: error.message,
            context
        });
    }
    
    handleRateLimit() {
        console.warn('Rate limit atingido. Aguardando...');
        // Implementar backoff
    }
}
```

## 🧪 Testes de Conexão

```javascript
// test/connection-test.js
async function testConnection() {
    const conn = new ConnectionManager();
    
    console.log('Inicializando conexão...');
    await conn.initialize();
    
    console.log('Verificando status...');
    const isConnected = conn.isConnected();
    console.log(`Conectado: ${isConnected}`);
    
    if (isConnected) {
        console.log('Enviando mensagem de teste...');
        await conn.getSock().sendMessage(
            'SEU_NUMERO@s.whatsapp.net',
            { text: '✅ Bot funcionando!' }
        );
    }
    
    console.log('Teste concluído!');
}

testConnection().catch(console.error);
```

---

**Parabéns!** Você completou toda a documentação técnica do LumaBot. Agora você tem conhecimento profundo sobre:

- ✅ Arquitetura e fluxo de dados
- ✅ Sistema de IA e prompts
- ✅ Processamento de mídia
- ✅ Banco de dados dual
- ✅ Integração WhatsApp

Continue explorando o código-fonte e experimente modificar o bot para suas necessidades!