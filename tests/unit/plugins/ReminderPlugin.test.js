import { describe, it, expect, vi, beforeEach } from "vitest";

const mockSchedule = vi.fn();
const mockGetPendingByChat = vi.fn();

vi.mock("../../../src/core/services/ReminderService.js", () => ({
  ReminderService: {
    schedule: (...a) => mockSchedule(...a),
    getPendingByChat: (...a) => mockGetPendingByChat(...a),
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
  });

  it("ignora silenciosamente quando falta o separador |", async () => {
    const bot = makeBot({ body: "!lembrete amanhã reunião" });
    await new ReminderPlugin().onCommand("!lembrete", bot);
    expect(bot.replied).toBeNull(); // Não responde, deixa Luma falar
    expect(mockSchedule).not.toHaveBeenCalled();
  });

  it("agenda com data válida e deixa Luma responder", async () => {
    const bot = makeBot({ body: "!lembrete 02/06/2026 16:00 | reunião" });
    await new ReminderPlugin().onCommand("!lembrete", bot);
    expect(mockSchedule).toHaveBeenCalledOnce();
    const arg = mockSchedule.mock.calls[0][0];
    expect(arg.text).toBe("reunião");
    expect(arg.mentionJids).toEqual(["u@s"]);
    expect(bot.replied).toBeNull(); // Não responde, deixa Luma falar
  });

  it("ignora silenciosamente quando a data é inválida", async () => {
    const bot = makeBot({ body: "!lembrete qualquer coisa | texto" });
    await new ReminderPlugin().onCommand("!lembrete", bot);
    expect(bot.replied).toBeNull(); // Não responde, deixa Luma falar
    expect(mockSchedule).not.toHaveBeenCalled();
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
