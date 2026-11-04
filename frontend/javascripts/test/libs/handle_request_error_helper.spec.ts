import { handleError, registerHasActiveUserFn } from "libs/handle_request_error_helper";
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
const NOT_AUTHENTICATED_MESSAGE = "You are not authorized to view this resource. Please log in.";

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
    registerHasActiveUserFn(() => true);
  });

  it("shows only the session expired toast for a 401 response if a user was logged in", async () => {
    const error = await handle(
      jsonResponse({ messages: [{ error: NOT_AUTHENTICATED_MESSAGE }] }, 401),
    );

    expect(showToastOnce).toHaveBeenCalledTimes(1);
    expect(Toast.messages).not.toHaveBeenCalled();
    expect(Toast.error).not.toHaveBeenCalled();
    expect(error).toMatchObject({ status: 401, url: URL });
  });

  it("shows only the session expired toast for a 401 plain text response if a user was logged in", async () => {
    await handle(new Response("Not authenticated", { status: 401 }));

    expect(showToastOnce).toHaveBeenCalledTimes(1);
    expect(Toast.messages).not.toHaveBeenCalled();
    expect(Toast.error).not.toHaveBeenCalled();
  });

  it("shows the server messages instead of the session expired toast for a 401 response if no user was logged in", async () => {
    registerHasActiveUserFn(() => false);

    await handle(jsonResponse({ messages: [{ error: NOT_AUTHENTICATED_MESSAGE }] }, 401));

    expect(showToastOnce).not.toHaveBeenCalled();
    expect(Toast.messages).toHaveBeenCalledWith([{ error: NOT_AUTHENTICATED_MESSAGE, key: "401" }]);
  });

  it("shows server messages", async () => {
    const error = await handle(jsonResponse({ messages: [{ error: "Dataset not found" }] }, 404));

    expect(showToastOnce).not.toHaveBeenCalled();
    expect(Toast.messages).toHaveBeenCalledWith([{ error: "Dataset not found", key: "404" }]);
    expect(error).toMatchObject({
      status: 404,
      messages: [{ error: "Dataset not found" }],
      url: URL,
    });
  });

  it("shows plain text error responses as-is", async () => {
    const error = await handle(new Response("Internal Server Error", { status: 500 }));

    expect(Toast.error).toHaveBeenCalledWith("Internal Server Error");
    expect(error).toMatchObject({ errors: ["Internal Server Error"], status: 500, url: URL });
  });

  it("does not show any toasts if showErrorToast is false", async () => {
    await handle(jsonResponse({ messages: [{ error: NOT_AUTHENTICATED_MESSAGE }] }, 401), false);
    await handle(new Response("Internal Server Error", { status: 500 }), false);

    expect(showToastOnce).not.toHaveBeenCalled();
    expect(Toast.messages).not.toHaveBeenCalled();
    expect(Toast.error).not.toHaveBeenCalled();
  });
});
