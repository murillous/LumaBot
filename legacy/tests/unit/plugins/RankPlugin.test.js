import { describe, it, expect, vi, beforeEach } from "vitest";

const mockGroupRanking = vi.fn();
const mockGlobalRanking = vi.fn();

vi.mock("../../../src/services/Database.js", () => ({
  DatabaseService: {
    getGroupRanking: (...a) => mockGroupRanking(...a),
    getGlobalRanking: (...a) => mockGlobalRanking(...a),
  },
}));

vi.mock("../../../src/core/services/UserResolver.js", () => ({
  UserResolver: {
    getDisplayName: (jid) => `nome:${jid}`,
  },
}));

const { RankPlugin } = await import("../../../src/plugins/luma/RankPlugin.js");

function makeBot({ isGroup = true, body = "!rank", jid = "grupo@g.us" } = {}) {
  return {
    isGroup,
    body,
    jid,
    sentText: null,
    repliedText: null,
    async sendText(t) {
      this.sentText = t;
    },
    async reply(t) {
      this.repliedText = t;
    },
  };
}

describe("RankPlugin", () => {
  beforeEach(() => {
    mockGroupRanking.mockReset();
    mockGlobalRanking.mockReset();
  });

  it("!rank em grupo usa o ranking do grupo com medalhas e nomes resolvidos", async () => {
    mockGroupRanking.mockReturnValue([
      { sender_jid: "a@s", count: 10 },
      { sender_jid: "b@s", count: 5 },
    ]);
    const bot = makeBot();
    await new RankPlugin().onCommand("!rank", bot);

    expect(mockGroupRanking).toHaveBeenCalledWith("grupo@g.us", 10);
    expect(bot.sentText).toContain("Ranking do Grupo");
    expect(bot.sentText).toContain("🥇 nome:a@s — 10");
    expect(bot.sentText).toContain("🥈 nome:b@s — 5");
  });

  it("!rank global usa o ranking agregado", async () => {
    mockGlobalRanking.mockReturnValue([{ sender_jid: "a@s", count: 99 }]);
    const bot = makeBot({ body: "!rank global" });
    await new RankPlugin().onCommand("!rank", bot);

    expect(mockGlobalRanking).toHaveBeenCalledWith(10);
    expect(bot.sentText).toContain("Ranking Global");
    expect(bot.sentText).toContain("🥇 nome:a@s — 99");
  });

  it("em PV cai para o ranking global mesmo sem 'global'", async () => {
    mockGlobalRanking.mockReturnValue([{ sender_jid: "a@s", count: 3 }]);
    const bot = makeBot({ isGroup: false, body: "!rank", jid: "pv@s.whatsapp.net" });
    await new RankPlugin().onCommand("!rank", bot);

    expect(mockGlobalRanking).toHaveBeenCalled();
    expect(mockGroupRanking).not.toHaveBeenCalled();
  });

  it("responde aviso quando não há interações", async () => {
    mockGroupRanking.mockReturnValue([]);
    const bot = makeBot();
    await new RankPlugin().onCommand("!rank", bot);

    expect(bot.repliedText).toContain("Ninguém interagiu");
    expect(bot.sentText).toBeNull();
  });
});
