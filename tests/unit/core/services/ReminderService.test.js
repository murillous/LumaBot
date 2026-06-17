import { describe, it, expect, vi, beforeEach } from "vitest";

const mockAdd = vi.fn().mockReturnValue(1);
const mockGetDue = vi.fn();
const mockGetPending = vi.fn();
const mockGetPendingByChat = vi.fn();
const mockMarkFired = vi.fn();
const mockDelete = vi.fn();

vi.mock("../../../../src/services/Database.js", () => ({
  DatabaseService: {
    addReminder: (...a) => mockAdd(...a),
    getDueReminders: (...a) => mockGetDue(...a),
    getPendingReminders: (...a) => mockGetPending(...a),
    getPendingRemindersByChat: (...a) => mockGetPendingByChat(...a),
    markReminderFired: (...a) => mockMarkFired(...a),
    deleteReminder: (...a) => mockDelete(...a),
  },
}));

const { ReminderService } = await import("../../../../src/core/services/ReminderService.js");

const NOW = Date.parse("2026-05-31T12:00:00-03:00");
const FUTURE = "2026-06-02T16:00:00-03:00";
const PAST = "2026-05-01T10:00:00-03:00";

describe("ReminderService.schedule", () => {
  beforeEach(() => {
    mockAdd.mockClear().mockReturnValue(1);
  });

  it("agenda um lembrete futuro válido e persiste", () => {
    const r = ReminderService.schedule({
      chatJid: "g@g.us",
      isGroup: true,
      creatorJid: "u@s",
      mentionJids: ["u@s"],
      text: "evento de videogame",
      datetime: FUTURE,
      now: NOW,
    });
    expect(r.id).toBe(1);
    expect(r.fireAt).toBe(Date.parse(FUTURE));
    expect(mockAdd).toHaveBeenCalledOnce();
    expect(mockAdd.mock.calls[0][0].text).toBe("evento de videogame");
  });

  it("rejeita data no passado", () => {
    expect(() =>
      ReminderService.schedule({ chatJid: "g", creatorJid: "u", text: "x", datetime: PAST, now: NOW })
    ).toThrow(/futuro/i);
  });

  it("rejeita data inválida", () => {
    expect(() =>
      ReminderService.schedule({ chatJid: "g", creatorJid: "u", text: "x", datetime: "não é data", now: NOW })
    ).toThrow(/inválida/i);
  });

  it("rejeita texto vazio", () => {
    expect(() =>
      ReminderService.schedule({ chatJid: "g", creatorJid: "u", text: "   ", datetime: FUTURE, now: NOW })
    ).toThrow(/vazio/i);
  });

  it("rejeita horizonte além de 1 ano", () => {
    expect(() =>
      ReminderService.schedule({ chatJid: "g", creatorJid: "u", text: "x", datetime: "2028-01-01T10:00:00-03:00", now: NOW })
    ).toThrow(/distante/i);
  });

  it("deduplica mentionJids", () => {
    ReminderService.schedule({
      chatJid: "g", creatorJid: "u", text: "x", datetime: FUTURE, now: NOW,
      mentionJids: ["a@s", "a@s", "b@s"],
    });
    expect(mockAdd.mock.calls[0][0].mentionJids).toEqual(["a@s", "b@s"]);
  });

  it("aceita datetime como epoch ms (comando manual)", () => {
    const ms = Date.parse(FUTURE);
    const r = ReminderService.schedule({ chatJid: "g", creatorJid: "u", text: "x", datetime: ms, now: NOW });
    expect(r.fireAt).toBe(ms);
  });
});

describe("ReminderService.normalize", () => {
  it("converte mention_jids JSON em array e flags em boolean", () => {
    const row = {
      id: 7, chat_jid: "g@g.us", is_group: 1, creator_jid: "u@s",
      mention_jids: '["a@s","b@s"]', text: "oi", fire_at: 123, fired: 0,
    };
    expect(ReminderService.normalize(row)).toEqual({
      id: 7, chatJid: "g@g.us", isGroup: true, creatorJid: "u@s",
      mentionJids: ["a@s", "b@s"], text: "oi", fireAt: 123, fired: false,
    });
  });

  it("mention_jids corrompido vira array vazio", () => {
    const row = { id: 1, chat_jid: "g", is_group: 0, creator_jid: "u", mention_jids: "{quebrado", text: "x", fire_at: 1, fired: 1 };
    const n = ReminderService.normalize(row);
    expect(n.mentionJids).toEqual([]);
    expect(n.fired).toBe(true);
  });
});

describe("ReminderService.getDue", () => {
  it("repassa o now e normaliza as linhas", () => {
    mockGetDue.mockReturnValue([
      { id: 1, chat_jid: "g", is_group: 0, creator_jid: "u", mention_jids: "[]", text: "x", fire_at: 10, fired: 0 },
    ]);
    const due = ReminderService.getDue(999);
    expect(mockGetDue).toHaveBeenCalledWith(999);
    expect(due[0].mentionJids).toEqual([]);
  });
});

describe("ReminderService.getPendingByChat", () => {
  it("busca lembretes pendentes de um chat específico e normaliza", () => {
    mockGetPendingByChat.mockReturnValue([
      { id: 1, chat_jid: "g@g.us", is_group: 1, creator_jid: "u@s", mention_jids: "[]", text: "reunião", fire_at: 123456, fired: 0 },
      { id: 2, chat_jid: "g@g.us", is_group: 1, creator_jid: "u@s", mention_jids: '["a@s"]', text: "almoço", fire_at: 123789, fired: 0 },
    ]);
    const reminders = ReminderService.getPendingByChat("g@g.us");
    expect(mockGetPendingByChat).toHaveBeenCalledWith("g@g.us");
    expect(reminders).toHaveLength(2);
    expect(reminders[0].text).toBe("reunião");
    expect(reminders[1].mentionJids).toEqual(["a@s"]);
  });
});
