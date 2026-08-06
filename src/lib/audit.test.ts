import { beforeEach, describe, expect, it, vi } from "vitest";
import { logAudit } from "./audit";

const insert = vi.fn();
const getUser = vi.fn();

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    auth: { getUser: (...args: unknown[]) => getUser(...args) },
    from: (table: string) => ({ insert: (rows: unknown[]) => insert(table, rows) }),
  },
}));

const signedIn = () => getUser.mockResolvedValue({ data: { user: { id: "user-1" } } });

beforeEach(() => {
  vi.clearAllMocks();
  insert.mockResolvedValue({ error: null });
});

describe("logAudit", () => {
  it("inserts a row for the signed-in user", async () => {
    signedIn();

    await logAudit("login");

    expect(insert).toHaveBeenCalledWith("audit_log", [
      expect.objectContaining({ user_id: "user-1", action: "login", metadata: {} }),
    ]);
  });

  it("records the target and metadata when provided", async () => {
    signedIn();

    await logAudit("position_closed_manual", { type: "position", id: "p-9" }, { pnl: -12 });

    expect(insert.mock.calls[0][1][0]).toMatchObject({
      action: "position_closed_manual",
      target_type: "position",
      target_id: "p-9",
      metadata: { pnl: -12 },
    });
  });

  it("skips the insert when nobody is signed in", async () => {
    getUser.mockResolvedValue({ data: { user: null } });

    await logAudit("login");

    expect(insert).not.toHaveBeenCalled();
  });

  it("swallows failures so it never blocks the action it describes", async () => {
    signedIn();
    insert.mockRejectedValue(new Error("db down"));
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});

    await expect(logAudit("api_key_rotated")).resolves.toBeUndefined();
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });
});
