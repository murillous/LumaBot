import { Logger } from "../utils/Logger.js";
import { GroupManager } from "../managers/GroupManager.js";
import { MediaProcessor } from "./MediaProcessor.js";
import { DatabaseService } from "../services/Database.js";
import { PersonalityManager } from "../managers/PersonalityManager.js";
import { MENUS } from "../config/constants.js";
import { LUMA_CONFIG } from "../config/lumaConfig.js";

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
                    case "show_personality_menu":
                        await this.handleShowPersonalityMenu(bot);
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

        // Tenta localizar o alvo por menção ou número
        let targetJid;
        let targetParticipant;
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
            await bot.reply(`⚠️ Não consegui encontrar quem é "${targetName}" no grupo. Mencione a pessoa ou passe o número certo.`);
            return;
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
        await bot.reply(`✅ Prontinho, @${targetJid.split("@")[0]} foi de arrasta pra cima!`, { mentions: [targetJid] });
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
            await bot.reply("⚠️ Não conheço essa personalidade. Usa !persona pra ver as opções!");
        }
    }

    static async handleShowHelp(bot) {
        await bot.sendText(MENUS.HELP_TEXT);
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
