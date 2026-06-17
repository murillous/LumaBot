import { Logger } from "../utils/Logger.js";
import { GroupManager } from "../managers/GroupManager.js";
import { MediaProcessor } from "./MediaProcessor.js";
import { DatabaseService } from "../services/Database.js";
import { PersonalityManager, CUSTOM_PREFIX } from "../managers/PersonalityManager.js";
import { MENUS } from "../config/constants.js";
import { LUMA_CONFIG } from "../config/lumaConfig.js";
import { ReminderService } from "../core/services/ReminderService.js";
import { PersonaGenerator } from "../core/services/PersonaGenerator.js";

/** Teto de personas custom por chat — mesmo limite do !persona criar. */
const MAX_CUSTOM_PERSONAS = 10;

/**
 * Despachante de ferramentas acionadas pela IA.
 * Recebe as chamadas de função (tool calls) do Gemini e as executa.
 */
export class ToolDispatcher {
    static async handleToolCalls(bot, toolCalls, lumaHandler, quotedBot = null) {
        if (!toolCalls || toolCalls.length === 0) return;

        for (const call of toolCalls) {
            Logger.info(`🔧 Luma acionou a ferramenta: ${call.name}`);
            try {
                switch (call.name) {
                    case "tag_everyone":
                        await this.handleTagEveryone(bot);
                        break;
                    case "remove_member":
                        await this.handleRemoveMember(bot, call.args);
                        break;
                    case "create_sticker":
                        await this.handleCreateSticker(bot, quotedBot);
                        break;
                    case "create_image":
                        await this.handleCreateImage(bot, quotedBot);
                        break;
                    case "create_gif":
                        await this.handleCreateGif(bot, quotedBot);
                        break;
                    case "clear_history":
                        await this.handleClearHistory(bot, lumaHandler);
                        break;
                    case "change_personality":
                        await this.handleChangePersonality(bot, call.args);
                        break;
                    case "show_help":
                        await this.handleShowHelp(bot);
                        break;
                    case "schedule_reminder":
                        await this.handleScheduleReminder(bot, call.args);
                        break;
                    case "show_personality_menu":
                        await this.handleShowPersonalityMenu(bot);
                        break;
                    case "create_persona":
                        await this.handleCreatePersona(bot, call.args, lumaHandler);
                        break;
                    default:
                        Logger.warn(`⚠️ Ferramenta desconhecida: ${call.name}`);
                }
            } catch (error) {
                Logger.error(`❌ Erro ao executar ferramenta ${call.name}:`, error);
            }
        }
    }

    static async handleTagEveryone(bot) {
        if (bot.isGroup) {
            await GroupManager.mentionEveryone(bot.raw, bot.socket);
        } else {
            await bot.reply("⚠️ Eu só consigo marcar todo mundo em grupos, anjo!");
        }
    }

    /**
     * Remove um membro do grupo. Somente administradores podem solicitar.
     */
    static async handleRemoveMember(bot, args) {
        if (!bot.isGroup) {
            await bot.reply("⚠️ Eu só consigo remover pessoas de grupos.");
            return;
        }

        const sock = bot.socket;
        const jid = bot.jid;
        const senderJid = bot.raw.key.participant || bot.raw.key.remoteJid;
        const groupMetadata = await sock.groupMetadata(jid);

        const cleanJid = (id) => (id ? id.split(":")[0].split("@")[0].replace(/\D/g, "") : null);
        const senderClean = cleanJid(senderJid);

        // Verifica se quem pediu é administrador
        const senderIsAdmin = groupMetadata.participants.some((p) => {
            return cleanJid(p.id) === senderClean && p.admin;
        });

        if (!senderIsAdmin) {
            await bot.reply("⚠️ Só administradores do grupo podem me pedir pra remover alguém, anjo!");
            return;
        }

        const target = args?.target || "";
        if (!target) {
            Logger.warn("Alvo não especificado na ferramenta remove_member");
            return;
        }

        await this._executeKick(bot, target);
    }

    /**
     * Localiza o membro alvo no grupo e o remove, caso o bot também seja admin.
     * @private
     */
    static async _executeKick(bot, targetName) {
        const sock = bot.socket;
        const jid = bot.jid;
        const groupMetadata = await sock.groupMetadata(jid);
        const cleanJid = (id) => (id ? id.split(":")[0].split("@")[0].replace(/\D/g, "") : null);
        const senderJid = bot.raw.key.participant || bot.raw.key.remoteJid;

        // Tenta localizar o alvo por menção ou número
        let targetJid;
        let targetParticipant;
        let wasRandom = false;
        const mentionedJidList = await bot.getMentionedJids();

        if (mentionedJidList.length > 0) {
            targetJid = mentionedJidList[0];
            targetParticipant = groupMetadata.participants.find((p) => p.id === targetJid);
        } else {
            const targetNumber = targetName.replace(/\D/g, "");
            if (targetNumber.length >= 8) {
                targetParticipant = groupMetadata.participants.find((p) => p.id.replace(/\D/g, "").includes(targetNumber));
                if (targetParticipant) targetJid = targetParticipant.id;
            }
        }

        if (!targetParticipant || !targetJid) {
            const selfClean   = cleanJid(sock.user?.id || sock.authState?.creds?.me?.id);
            const senderClean = cleanJid(senderJid);
            const eligible = groupMetadata.participants.filter((p) => {
                const pClean = cleanJid(p.id);
                return !p.admin && pClean !== selfClean && pClean !== senderClean;
            });

            if (eligible.length === 0) {
                await bot.reply('😔 Queria dar um chute em alguém, mas não sobrou ninguém elegível...');
                return;
            }

            const chosen      = eligible[Math.floor(Math.random() * eligible.length)];
            targetJid         = chosen.id;
            targetParticipant = chosen;
            wasRandom         = true;
        }

        // Verifica se o bot é admin no grupo
        const botJid = sock.user?.id || sock.authState?.creds?.me?.id;
        const botLid = sock.user?.lid || sock.authState?.creds?.me?.id;
        const botIdClean = cleanJid(botJid);
        const botLidClean = cleanJid(botLid);

        const botIsAdmin = groupMetadata.participants.find((p) => {
            const pClean = cleanJid(p.id);
            return (pClean === botIdClean || (botLidClean && pClean === botLidClean)) && p.admin;
        });

        if (!botIsAdmin) {
            await bot.reply("⚠️ Eu preciso ser administradora do grupo para expulsar alguém!");
            return;
        }

        if (targetParticipant.admin) {
            await bot.reply("⚠️ Não posso remover outro administrador do grupo.");
            return;
        }

        Logger.info(`Expulsando ${targetJid} do grupo ${jid} via comando natural da Luma.`);
        await sock.groupParticipantsUpdate(jid, [targetJid], "remove");

        const kickMsg = wasRandom
            ? `Já sabia que era você, @${targetJid.split("@")[0]}. Tchau 👋`
            : `✅ Prontinho, @${targetJid.split("@")[0]} foi de arrasta pra cima!`;
        await bot.reply(kickMsg, { mentions: [targetJid] });
    }

    // --- Handlers de Mídia ---

    static async handleCreateSticker(bot, quotedBot = null) {
        const quoted = quotedBot || bot.getQuotedAdapter();

        if (bot.innerMessage?.imageMessage || bot.innerMessage?.videoMessage || bot.innerMessage?.stickerMessage) {
            await MediaProcessor.processToSticker(bot.raw, bot.socket);
            DatabaseService.incrementMetric("stickers_created");
            return;
        }
        if (quoted?.hasVisualContent) {
            await MediaProcessor.processToSticker(quoted.raw, bot.socket, bot.jid);
            DatabaseService.incrementMetric("stickers_created");
            return;
        }
        await bot.reply("⚠️ Você precisa responder a uma imagem, vídeo ou GIF para eu fazer a figurinha!");
    }

    static async handleCreateImage(bot, quotedBot = null) {
        const quoted = quotedBot || bot.getQuotedAdapter();

        if (bot.innerMessage?.stickerMessage) {
            await MediaProcessor.processStickerToImage(bot.raw, bot.socket);
            DatabaseService.incrementMetric("images_created");
            return;
        }
        if (quoted?.hasSticker) {
            await MediaProcessor.processStickerToImage(quoted.raw, bot.socket, bot.jid);
            DatabaseService.incrementMetric("images_created");
            return;
        }
        await bot.reply("⚠️ Você precisa responder a uma figurinha (sticker) para eu transformar em imagem!");
    }

    static async handleCreateGif(bot, quotedBot = null) {
        const quoted = quotedBot || bot.getQuotedAdapter();

        if (bot.innerMessage?.stickerMessage) {
            await MediaProcessor.processStickerToGif(bot.raw, bot.socket);
            DatabaseService.incrementMetric("gifs_created");
            return;
        }
        if (quoted?.hasSticker) {
            await MediaProcessor.processStickerToGif(quoted.raw, bot.socket, bot.jid);
            DatabaseService.incrementMetric("gifs_created");
            return;
        }
        await bot.reply("⚠️ Você precisa responder a uma figurinha animada para eu transformar em GIF!");
    }

    static async handleClearHistory(bot, lumaHandler) {
        lumaHandler.clearHistory(bot.jid);
        await bot.reply("🗑️ Minha memória para essa conversa foi apagada. O que estávamos falando mesmo?");
    }

    /** Muda a personalidade da Luma neste chat via linguagem natural. */
    static async handleChangePersonality(bot, args) {
        const key = args?.personality;
        if (!key) {
            Logger.warn("Personalidade não especificada na ferramenta change_personality");
            return;
        }

        const success = PersonalityManager.setPersonality(bot.jid, key);
        if (success) {
            const config = PersonalityManager.getPersonaConfig(bot.jid);
            await bot.reply(`🎭 Personalidade alterada para *${config.name}*!`);
        } else {
            await bot.reply("⚠️ Não conheço essa personalidade. Usa !alma pra ver as opções!");
        }
    }

    static async handleShowHelp(bot) {
        await bot.sendText(MENUS.HELP_TEXT);
    }

    /**
     * Agenda um lembrete a partir da linguagem natural. As pessoas a mencionar
     * vêm das menções da mensagem; se ninguém foi marcado, lembra quem pediu.
     */
    static async handleScheduleReminder(bot, args) {
        const text = args?.reminder_text || args?.text;
        const datetime = args?.datetime;
        if (!text || !datetime) {
            await bot.reply("⚠️ Preciso saber o que lembrar e quando, anjo!");
            return;
        }

        const mentioned = await bot.getMentionedJids();
        const creator = bot.senderJid;
        const mentionJids = mentioned.length > 0 ? mentioned : [creator];

        try {
            const { fireAt } = ReminderService.schedule({
                chatJid: bot.jid,
                isGroup: bot.isGroup,
                creatorJid: creator,
                mentionJids,
                text,
                datetime,
            });
            const when = new Date(fireAt).toLocaleString("pt-BR", {
                timeZone: "America/Sao_Paulo",
                dateStyle: "short",
                timeStyle: "short",
            });
            await bot.reply(`⏰ Anotado! Te lembro disso em ${when}.`);
        } catch (error) {
            Logger.error("Erro ao agendar lembrete:", error);
            await bot.reply(`⚠️ Não consegui agendar: ${error.message}`);
        }
    }

    /**
     * Cria uma persona custom a partir de uma descrição em linguagem natural,
     * ativa-a no chat e confirma na voz da Luma. Reaproveita o PersonaGenerator
     * (instanciado com o aiService do LumaHandler) e segue o mesmo caminho do
     * !persona criar: teto de 10, gravação, ativação e fallback em caso de falha
     * (FR-9 — nada é gravado e a persona atual é mantida).
     */
    static async handleCreatePersona(bot, args, lumaHandler) {
        const description = (args?.description ?? "").trim();
        if (!description) {
            await bot.reply(MENUS.MSGS.PERSONA_CREATE_HELP);
            return;
        }

        const aiService = lumaHandler?.aiService;
        if (!aiService) {
            await bot.reply(MENUS.MSGS.PERSONA_CREATE_FAIL);
            return;
        }

        if (DatabaseService.countCustomPersonas(bot.jid) >= MAX_CUSTOM_PERSONAS) {
            await bot.reply(MENUS.MSGS.PERSONA_LIMIT);
            return;
        }

        try {
            const generator    = new PersonaGenerator({ aiService });
            const persona      = await generator.generate(description);
            const existingKeys = DatabaseService.getCustomPersonas(bot.jid).map((p) => p.key);
            const slug         = generator.slugify(persona.name, existingKeys);

            DatabaseService.createCustomPersona(bot.jid, { ...persona, key: slug });
            PersonalityManager.setPersonality(bot.jid, `${CUSTOM_PREFIX}${slug}`);
            // Telemetria no banco público: só contagem, sem JID nem conteúdo (doc 04).
            DatabaseService.incrementMetric("personas_created");

            await bot.reply(`${MENUS.MSGS.PERSONA_CREATE_OK}*${persona.name}*! 😎`);
        } catch (error) {
            Logger.error("❌ Erro ao criar persona custom (tool):", error);
            await bot.reply(MENUS.MSGS.PERSONA_CREATE_FAIL);
        }
    }

    static async handleShowPersonalityMenu(bot) {
        const list        = PersonalityManager.getList();
        const currentName = PersonalityManager.getActiveName(bot.jid);

        let text = `${MENUS.PERSONALITY.HEADER}\n`;
        text += `🔹 Atual neste chat: ${currentName}\n\n`;

        list.forEach((p, i) => {
            const isDefault = p.key === LUMA_CONFIG.DEFAULT_PERSONALITY ? " ⭐ (Padrão)" : "";
            text += `p${i + 1} - ${p.name}${isDefault}\n${p.desc}\n\n`;
        });

        text += MENUS.PERSONALITY.FOOTER;
        await bot.sendText(text);
    }
}
