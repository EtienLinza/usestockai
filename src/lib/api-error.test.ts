import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { toast } from "sonner";
import { ApiError, fetchWithErrorHandling, handleResponseError, showErrorToast } from "./api-error";

vi.mock("sonner", () => ({ toast: { error: vi.fn() } }));

const toastError = vi.mocked(toast.error);

const jsonResponse = (status: number, body?: unknown) =>
  new Response(body === undefined ? null : JSON.stringify(body), { status });

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe("fetchWithErrorHandling", () => {
  it("returns the response and forwards fetch options", async () => {
    const response = jsonResponse(200, { ok: true });
    const fetchMock = vi.fn().mockResolvedValue(response);
    vi.stubGlobal("fetch", fetchMock);

    await expect(fetchWithErrorHandling("/api", { method: "POST" })).resolves.toBe(response);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("/api");
    expect(init.method).toBe("POST");
    expect(init.signal).toBeInstanceOf(AbortSignal);
  });

  it("does not retry a successful call", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(500));
    vi.stubGlobal("fetch", fetchMock);

    await fetchWithErrorHandling("/api", { retries: 3 });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("retries failures up to the configured count and rethrows the last error", async () => {
    const fetchMock = vi.fn().mockRejectedValue(new Error("boom"));
    vi.stubGlobal("fetch", fetchMock);
    vi.spyOn(global, "setTimeout").mockImplementation(((fn: () => void) => {
      fn();
      return 0 as unknown as ReturnType<typeof setTimeout>;
    }) as typeof setTimeout);

    await expect(fetchWithErrorHandling("/api", { retries: 2 })).rejects.toThrow("boom");
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it("maps an abort into a timeout ApiError", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockRejectedValue(new DOMException("aborted", "AbortError")),
    );

    const error = await fetchWithErrorHandling("/api").catch((e) => e);
    expect(error).toBeInstanceOf(ApiError);
    expect(error.isTimeout).toBe(true);
    expect(error.message).toContain("timed out");
  });

  it("maps a failed fetch into a network ApiError", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new TypeError("Failed to fetch")));

    const error = await fetchWithErrorHandling("/api").catch((e) => e);
    expect(error).toBeInstanceOf(ApiError);
    expect(error.isNetworkError).toBe(true);
    expect(error.message).toContain("Network error");
  });

  it("aborts the request once the timeout elapses", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(
        (_url: string, init: RequestInit) =>
          new Promise((_resolve, reject) => {
            init.signal?.addEventListener("abort", () =>
              reject(new DOMException("aborted", "AbortError")),
            );
          }),
      ),
    );
    vi.useFakeTimers();

    const promise = fetchWithErrorHandling("/api", { timeoutMs: 50 }).catch((e) => e);
    await vi.advanceTimersByTimeAsync(50);

    expect((await promise).isTimeout).toBe(true);
  });
});

describe("handleResponseError", () => {
  it("redirects to auth on 401", async () => {
    const navigate = vi.fn();
    await expect(handleResponseError(jsonResponse(401), navigate)).rejects.toMatchObject({
      status: 401,
      message: "Session expired",
    });
    expect(navigate).toHaveBeenCalledWith("/auth");
    expect(toastError).toHaveBeenCalledWith("Session expired. Please sign in again.");
  });

  it("surfaces the server retryAfter on 429", async () => {
    const error = await handleResponseError(jsonResponse(429, { retryAfter: 15 })).catch((e) => e);
    expect(error.status).toBe(429);
    expect(error.retryAfter).toBe(15);
    expect(error.message).toContain("15 seconds");
  });

  it("falls back to 60s when the 429 body is unparseable", async () => {
    const error = await handleResponseError(new Response("nope", { status: 429 })).catch((e) => e);
    expect(error.retryAfter).toBe(60);
  });

  it.each([502, 503])("reports %i as temporarily unavailable", async (status) => {
    const error = await handleResponseError(jsonResponse(status)).catch((e) => e);
    expect(error.status).toBe(status);
    expect(error.message).toContain("temporarily unavailable");
  });

  it("reports other 5xx as a server-side failure", async () => {
    const error = await handleResponseError(jsonResponse(500)).catch((e) => e);
    expect(error.message).toContain("on our end");
  });

  it("extracts an error message from a 4xx body, preferring `error` over `message`", async () => {
    const fromError = await handleResponseError(
      jsonResponse(400, { error: "bad ticker", message: "ignored" }),
    ).catch((e) => e);
    expect(fromError.message).toBe("bad ticker");

    const fromMessage = await handleResponseError(jsonResponse(400, { message: "bad input" })).catch(
      (e) => e,
    );
    expect(fromMessage.message).toBe("bad input");
  });

  it("falls back to a generic message when the body has no error text", async () => {
    const error = await handleResponseError(new Response("<html/>", { status: 404 })).catch((e) => e);
    expect(error.message).toBe("Something went wrong. Please try again.");
    expect(error.status).toBe(404);
  });
});

describe("showErrorToast", () => {
  it("stays silent for 401 ApiErrors, which are handled by the redirect", () => {
    showErrorToast(new ApiError("Session expired", 401));
    expect(toastError).not.toHaveBeenCalled();
  });

  it("shows a longer toast with a retry action for network errors", () => {
    showErrorToast(new ApiError("Network error", undefined, undefined, false, true));
    expect(toastError).toHaveBeenCalledWith(
      "Network error",
      expect.objectContaining({ duration: 6000, action: expect.objectContaining({ label: "Retry" }) }),
    );
  });

  it("shows a short toast without an action for other ApiErrors", () => {
    showErrorToast(new ApiError("Rate limited", 429));
    expect(toastError).toHaveBeenCalledWith(
      "Rate limited",
      expect.objectContaining({ duration: 4000, action: undefined }),
    );
  });

  it("uses the message of a plain Error and the fallback for anything else", () => {
    showErrorToast(new Error("kaput"));
    expect(toastError).toHaveBeenLastCalledWith("kaput");

    showErrorToast(new Error(""), "fallback text");
    expect(toastError).toHaveBeenLastCalledWith("fallback text");

    showErrorToast("just a string", "fallback text");
    expect(toastError).toHaveBeenLastCalledWith("fallback text");
  });
});
