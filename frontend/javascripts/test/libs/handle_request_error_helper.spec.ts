import { handleError } from "libs/handle_request_error_helper";
import Toast, { showToastOnce } from "libs/toast";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("libs/toast", () => ({
  default: {
    error: vi.fn(),
    messages: vi.fn(),
  },
  showToastOnce: vi.fn(),
}));

const URL = "/api/some/route";

function jsonResponse(body: unknown, status: number) {
  return new Response(JSON.stringify(body), { status });
}

async function handle(response: Response, showErrorToast = true) {
  return handleError(URL, showErrorToast, true, response).catch((error) => error);
}

describe("handleError", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(console, "error").mockImplementation(() => {});
  });

  it("shows only the readable session expired toast for a generic 401 JSON response", async () => {
    const error = await handle(
      jsonResponse({ success: false, message: "Authentication required" }, 401),
    );

    expect(showToastOnce).toHaveBeenCalledTimes(1);
    expect(Toast.messages).not.toHaveBeenCalled();
    expect(Toast.error).not.toHaveBeenCalled();
    expect(error).toMatchObject({
      status: 401,
      messages: [{ error: "Authentication required" }],
      url: URL,
    });
  });

  it("shows only the readable session expired toast for a 401 plain text response", async () => {
    await handle(new Response("Not authenticated", { status: 401 }));

    expect(showToastOnce).toHaveBeenCalledTimes(1);
    expect(Toast.messages).not.toHaveBeenCalled();
    expect(Toast.error).not.toHaveBeenCalled();
  });

  it("still shows structured server messages of 401 responses", async () => {
    await handle(jsonResponse({ messages: [{ error: "Passkey is not authorized." }] }, 401));

    expect(showToastOnce).toHaveBeenCalledTimes(1);
    expect(Toast.messages).toHaveBeenCalledWith([
      { error: "Passkey is not authorized.", key: "401" },
    ]);
  });

  it("shows structured server messages", async () => {
    const error = await handle(jsonResponse({ messages: [{ error: "Dataset not found" }] }, 404));

    expect(showToastOnce).not.toHaveBeenCalled();
    expect(Toast.messages).toHaveBeenCalledWith([{ error: "Dataset not found", key: "404" }]);
    expect(error).toMatchObject({
      status: 404,
      messages: [{ error: "Dataset not found" }],
      url: URL,
    });
  });

  it("shows the message of a JSON response with a single message instead of the raw JSON", async () => {
    await handle(jsonResponse({ success: false, message: "Something went wrong" }, 400));

    expect(Toast.messages).toHaveBeenCalledWith([{ error: "Something went wrong", key: "400" }]);
    expect(Toast.error).not.toHaveBeenCalled();
  });

  it("shows plain text error responses as-is", async () => {
    const error = await handle(new Response("Internal Server Error", { status: 500 }));

    expect(Toast.error).toHaveBeenCalledWith("Internal Server Error");
    expect(error).toMatchObject({ errors: ["Internal Server Error"], status: 500, url: URL });
  });

  it("does not show any toasts if showErrorToast is false", async () => {
    await handle(jsonResponse({ success: false, message: "Authentication required" }, 401), false);
    await handle(new Response("Internal Server Error", { status: 500 }), false);

    expect(showToastOnce).not.toHaveBeenCalled();
    expect(Toast.messages).not.toHaveBeenCalled();
    expect(Toast.error).not.toHaveBeenCalled();
  });
});
