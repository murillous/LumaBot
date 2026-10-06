import { describe, it, expect, vi, beforeEach } from "vitest";

const mockGetDue = vi.fn();
const mockMarkFired = vi.fn();

vi.mock("../../../src/core/services/ReminderService.js", () => ({
  ReminderService: {
    getDue: (...a) => mockGetDue(...a),
    markFired: (...a) => mockMarkFired(...a),
  },
}));

vi.mock("../../../src/utils/Logger.js", () => ({
  Logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

const { ReminderScheduler } = await import("../../../src/infra/ReminderScheduler.js");

describe("ReminderScheduler.tick", () => {
  beforeEach(() => {
    mockGetDue.mockReset();
    mockMarkFired.mockReset();
  });

  it("dispara cada lembrete vencido com menção e marca como disparado", async () => {
    mockGetDue.mockReturnValue([
      { id: 1, chatJid: "g@g.us", mentionJids: ["a@s.whatsapp.net", "b@s.whatsapp.net"], text: "evento" },
    ]);
    const sent = [];
    const sock = { sendMessage: vi.fn(async (jid, content) => sent.push({ jid, content })) };

    const sched = new ReminderScheduler();
    sched.start(sock);
    sched.stop();
    await sched.tick();

    expect(sock.sendMessage).toHaveBeenCalled();
    const { jid, content } = sent.at(-1);
    expect(jid).toBe("g@g.us");
    expect(content.text).toContain("evento");
    expect(content.text).toContain("@a");
    expect(content.mentions).toEqual(["a@s.whatsapp.net", "b@s.whatsapp.net"]);
    expect(mockMarkFired).toHaveBeenCalledWith(1);
  });

  it("não marca como disparado se o envio falhar", async () => {
    mockGetDue.mockReturnValue([{ id: 9, chatJid: "g", mentionJids: [], text: "x" }]);
    const sock = { sendMessage: vi.fn().mockRejectedValue(new Error("offline")) };

    const sched = new ReminderScheduler();
    sched.start(sock);
    sched.stop();
    await sched.tick();

    expect(mockMarkFired).not.toHaveBeenCalled();
  });

  it("sem socket não faz nada", async () => {
    const sched = new ReminderScheduler();
    await sched.tick();
    expect(mockGetDue).not.toHaveBeenCalled();
  });
});
