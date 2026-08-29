import { describe, expect, it } from "vitest";
import { cn } from "./utils";

describe("cn", () => {
  it("joins plain class names", () => {
    expect(cn("a", "b")).toBe("a b");
  });

  it("drops falsy values and flattens conditional objects/arrays", () => {
    const enabled = false;
    expect(cn("a", enabled && "b", null, undefined, ["c", { d: true, e: false }])).toBe("a c d");
  });

  it("lets the last tailwind utility of a conflicting group win", () => {
    expect(cn("p-2", "p-4")).toBe("p-4");
    expect(cn("text-sm text-muted-foreground", "text-lg")).toBe("text-muted-foreground text-lg");
  });

  it("keeps non-conflicting tailwind utilities", () => {
    expect(cn("px-2", "py-4")).toBe("px-2 py-4");
  });
});
