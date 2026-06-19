import { describe, it, expect, vi, beforeEach } from "vitest";

const mockSchedule = vi.fn();
const mockGetPendingByChat = vi.fn();
const mockCancel = vi.fn();

vi.mock("../../../src/core/services/ReminderService.js", () => ({
  ReminderService: {
    schedule: (...a) => mockSchedule(...a),
    getPendingByChat: (...a) => mockGetPendingByChat(...a),
    cancel: (...a) => mockCancel(...a),
  },
}));

vi.mock("../../../src/utils/Logger.js", () => ({
  Logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

const { ReminderPlugin, parseBrDateTime, formatReminderForDisplay } = await import(
  "../../../src/plugins/reminder/ReminderPlugin.js"
);

describe("parseBrDateTime", () => {
  it("parseia DD/MM/AAAA HH:mm como horário de Brasília", () => {
    const t = parseBrDateTime("02/06/2026 16:00", 2026);
    expect(t).toBe(Date.parse("2026-06-02T16:00:00-03:00"));
  });

  it("usa o ano corrente quando o ano é omitido", () => {
    const t = parseBrDateTime("02/06 16:00", 2026);
    expect(t).toBe(Date.parse("2026-06-02T16:00:00-03:00"));
  });

  it("retorna null para formato inválido", () => {
    expect(parseBrDateTime("amanhã às 4", 2026)).toBeNull();
    expect(parseBrDateTime("sem hora", 2026)).toBeNull();
  });
});

describe("formatReminderForDisplay", () => {
  it("formata timestamp em DD/MM HH:mm (horário Brasília)", () => {
    const reminder = { fireAt: Date.parse("2026-06-02T16:30:00-03:00") };
    const formatted = formatReminderForDisplay(reminder);
    expect(formatted).toMatch(/02\/06 16:30/);
  });
});

function makeBot({ body, jid = "g@g.us", isGroup = true, senderJid = "u@s", mentions = [] } = {}) {
  return {
    body, jid, isGroup, senderJid,
    replied: null,
    async reply(t) { this.replied = t; },
    async getMentionedJids() { return mentions; },
  };
}

describe("ReminderPlugin.onCommand", () => {
  beforeEach(() => {
    mockSchedule.mockReset();
    mockGetPendingByChat.mockReset();
    mockCancel.mockReset();
  });

  it("informa formato inválido quando falta o separador |", async () => {
    const bot = makeBot({ body: "!lembrete amanhã reunião" });

    await new ReminderPlugin().onCommand("!lembrete", bot);

    expect(bot.replied).toContain("Formato inválido");
    expect(mockSchedule).not.toHaveBeenCalled();
  });

  it("agenda com data válida e responde com confirmação (melhoria 3)", async () => {
    const bot = makeBot({ body: "!lembrete 02/06/2026 16:00 | reunião" });
    await new ReminderPlugin().onCommand("!lembrete", bot);
    expect(mockSchedule).toHaveBeenCalledOnce();
    const arg = mockSchedule.mock.calls[0][0];
    expect(arg.text).toBe("reunião");
    expect(arg.mentionJids).toEqual(["u@s"]);
    expect(bot.replied).toContain("✅ Lembrete criado!");
    expect(bot.replied).toContain("02/06 16:00");
    expect(bot.replied).toContain("reunião");
  });

  it("responde quando a data é inválida", async () => {
    const bot = makeBot({ body: "!lembrete qualquer coisa | texto" });

    await new ReminderPlugin().onCommand("!lembrete", bot);

    expect(bot.replied).toContain("não existe");
    expect(mockSchedule).not.toHaveBeenCalled();
  });

  it("responde com erro amigável quando a data não existe no calendário (melhoria 1)", async () => {
    const bot = makeBot({ body: "!lembrete 31/02/2026 10:00 | reunião" });
    await new ReminderPlugin().onCommand("!lembrete", bot);
    expect(bot.replied).toContain("não existe no calendário");
    expect(mockSchedule).not.toHaveBeenCalled();
  });

  it("responde com erro amigável quando 29/02 não é bissexto (melhoria 1)", async () => {
    const bot = makeBot({ body: "!lembrete 29/02/2026 10:00 | reunião" });
    await new ReminderPlugin().onCommand("!lembrete", bot);
    expect(bot.replied).toContain("não existe no calendário");
    expect(mockSchedule).not.toHaveBeenCalled();
  });

  it("aceita 29/02 quando o ano é bissexto (melhoria 1)", async () => {
    const bot = makeBot({ body: "!lembrete 29/02/2028 10:00 | reunião" });
    await new ReminderPlugin().onCommand("!lembrete", bot);
    expect(mockSchedule).toHaveBeenCalledOnce();
    expect(bot.replied).toContain("✅ Lembrete criado!");
  });

  it("repassa ao usuário o erro lançado pelo ReminderService, ex: data passada (melhoria 2)", async () => {
    mockSchedule.mockImplementation(() => {
      throw new Error("A data deve estar no futuro.");
    });
    const bot = makeBot({ body: "!lembrete 01/01/2020 08:00 | reunião" });
    await new ReminderPlugin().onCommand("!lembrete", bot);
    expect(bot.replied).toContain("A data deve estar no futuro.");
  });

  it("cancela um lembrete pelo comando !cancelarlembrete n", async () => {
    const reminders = [
      { id: 10, fireAt: Date.parse("2026-06-02T16:00:00-03:00"), text: "reunião" },
      { id: 11, fireAt: Date.parse("2026-06-03T14:30:00-03:00"), text: "almoço" },
    ];
    mockGetPendingByChat.mockReturnValue(reminders);
    const bot = makeBot({ body: "!cancelarlembrete 2" });

    await new ReminderPlugin().onCommand("!cancelarlembrete", bot);

    expect(mockGetPendingByChat).toHaveBeenCalledWith("g@g.us");
    expect(mockCancel).toHaveBeenCalledWith(11);
    expect(bot.replied).toContain("✅ Lembrete removido");
    expect(bot.replied).toContain("almoço");
  });

  it("lista lembretes quando o comando é !lembretes", async () => {
    const reminders = [
      { fireAt: Date.parse("2026-06-02T16:00:00-03:00"), text: "reunião" },
      { fireAt: Date.parse("2026-06-03T14:30:00-03:00"), text: "almoço" },
    ];
    mockGetPendingByChat.mockReturnValue(reminders);
    const bot = makeBot({ body: "!lembretes" });
    await new ReminderPlugin().onCommand("!lembretes", bot);
    expect(mockGetPendingByChat).toHaveBeenCalledWith("g@g.us");
    expect(bot.replied).toContain("Lembretes agendados");
    expect(bot.replied).toContain("2");
  });

  it("informa quando não há lembretes", async () => {
    mockGetPendingByChat.mockReturnValue([]);
    const bot = makeBot({ body: "!lembretes" });
    await new ReminderPlugin().onCommand("!lembretes", bot);
    expect(bot.replied).toContain("Nenhum lembrete");
  });
});