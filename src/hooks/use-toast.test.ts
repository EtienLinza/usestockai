import { describe, expect, it } from "vitest";
import { reducer } from "./use-toast";

type State = Parameters<typeof reducer>[0];

const makeToast = (id: string, extra: Record<string, unknown> = {}) => ({
  id,
  title: `toast ${id}`,
  open: true,
  ...extra,
});

const state = (...ids: string[]): State => ({ toasts: ids.map((id) => makeToast(id)) });

describe("toast reducer", () => {
  it("prepends new toasts and enforces the single-toast limit", () => {
    const next = reducer(state("1"), { type: "ADD_TOAST", toast: makeToast("2") });
    expect(next.toasts.map((t) => t.id)).toEqual(["2"]);
  });

  it("merges updates into the matching toast only", () => {
    const next = reducer(state("1", "2"), {
      type: "UPDATE_TOAST",
      toast: { id: "2", title: "renamed" },
    });
    expect(next.toasts.map((t) => t.title)).toEqual(["toast 1", "renamed"]);
  });

  it("ignores updates for unknown toast ids", () => {
    const before = state("1");
    expect(reducer(before, { type: "UPDATE_TOAST", toast: { id: "nope", title: "x" } })).toEqual(
      before,
    );
  });

  it("closes a single toast on dismiss without removing it", () => {
    const next = reducer(state("1", "2"), { type: "DISMISS_TOAST", toastId: "1" });
    expect(next.toasts.map((t) => [t.id, t.open])).toEqual([
      ["1", false],
      ["2", true],
    ]);
  });

  it("closes every toast when dismissing without an id", () => {
    const next = reducer(state("1", "2"), { type: "DISMISS_TOAST" });
    expect(next.toasts.every((t) => t.open === false)).toBe(true);
  });

  it("removes a single toast by id", () => {
    const next = reducer(state("1", "2"), { type: "REMOVE_TOAST", toastId: "1" });
    expect(next.toasts.map((t) => t.id)).toEqual(["2"]);
  });

  it("clears all toasts when removing without an id", () => {
    expect(reducer(state("1", "2"), { type: "REMOVE_TOAST" }).toasts).toEqual([]);
  });

  it("does not mutate the previous state", () => {
    const before = state("1");
    const snapshot = JSON.parse(JSON.stringify(before));
    reducer(before, { type: "DISMISS_TOAST", toastId: "1" });
    reducer(before, { type: "REMOVE_TOAST", toastId: "1" });
    expect(JSON.parse(JSON.stringify(before))).toEqual(snapshot);
  });
});
