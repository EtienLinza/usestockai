import { toast } from "sonner";

export class ApiError extends Error {
  constructor(
    message: string,
    public status?: number,
    public retryAfter?: number,
    public isTimeout?: boolean,
    public isNetworkError?: boolean
  ) {
    super(message);
    this.name = "ApiError";
  }
}

/**
 * Wraps a fetch call with timeout, retry, and structured error handling.
 */
export async function fetchWithErrorHandling(
  url: string,
  options: RequestInit & { timeoutMs?: number; retries?: number } = {}
): Promise<Response> {
  const { timeoutMs = 30000, retries = 0, ...fetchOptions } = options;

  let lastError: Error | null = null;

  for (let attempt = 0; attempt <= retries; attempt++) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);

    try {
      const response = await fetch(url, {
        ...fetchOptions,
        signal: controller.signal,
      });
      clearTimeout(timeout);
      return response;
    } catch (error) {
      clearTimeout(timeout);

      if (error instanceof DOMException && error.name === "AbortError") {
        lastError = new ApiError(
          "Request timed out. The server may be busy — please try again.",
          undefined,
          undefined,
          true
        );
      } else if (error instanceof TypeError && error.message === "Failed to fetch") {
        lastError = new ApiError(
          "Network error. Please check your internet connection and try again.",
          undefined,
          undefined,
          false,
          true
        );
      } else {
        lastError = error instanceof Error ? error : new Error(String(error));
      }

      // Wait before retrying (exponential backoff)
      if (attempt < retries) {
        await new Promise((r) => setTimeout(r, 1000 * Math.pow(2, attempt)));
      }
    }
  }

  throw lastError;
}

/**
 * Parses an error response from the API and throws an ApiError.
 */
export async function handleResponseError(response: Response, navigate?: (path: string) => void): Promise<never> {
  if (response.status === 401) {
    toast.error("Session expired. Please sign in again.");
    navigate?.("/auth");
    throw new ApiError("Session expired", 401);
  }

  if (response.status === 429) {
    let retryAfter = 60;
    try {
      const data = await response.json();
      retryAfter = data.retryAfter || 60;
    } catch {}
    throw new ApiError(
      `Too many requests. Please wait ${retryAfter} seconds before trying again.`,
      429,
      retryAfter
    );
  }

  if (response.status === 502 || response.status === 503) {
    throw new ApiError(
      "The service is temporarily unavailable. Please try again in a moment.",
      response.status
    );
  }

  if (response.status >= 500) {
    throw new ApiError(
      "Something went wrong on our end. Please try again later.",
      response.status
    );
  }

  // Try to extract error message from response body
  let errorMessage = "Something went wrong. Please try again.";
  try {
    const data = await response.json();
    errorMessage = data.error || data.message || errorMessage;
  } catch {}

  throw new ApiError(errorMessage, response.status);
}

/**
 * Display a user-friendly error toast based on the error type.
 */
export function showErrorToast(error: unknown, fallback = "Something went wrong") {
  if (error instanceof ApiError) {
    if (error.status === 401) return; // Already handled with redirect
    toast.error(error.message, {
      duration: error.isTimeout || error.isNetworkError ? 6000 : 4000,
      action: error.isNetworkError
        ? { label: "Retry", onClick: () => window.location.reload() }
        : undefined,
    });
    return;
  }

  if (error instanceof Error) {
    toast.error(error.message || fallback);
    return;
  }

  toast.error(fallback);
}
