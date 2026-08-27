import { afterEach, describe, expect, it, vi } from "vitest";
import { buildShareUrl, newShareButton } from "./share";

describe("buildShareUrl", () => {
  it("encodes size and board-id as query params reproducing this exact board", () => {
    expect(buildShareUrl(4, 12345, "https://example.com", "/")).toBe(
      "https://example.com/?size=4&board-id=12345",
    );
  });

  it("preserves a non-root pathname", () => {
    expect(buildShareUrl(8, 999, "https://example.com", "/colordoku/")).toBe(
      "https://example.com/colordoku/?size=8&board-id=999",
    );
  });

  it("round-trips through URLSearchParams the same way main.ts reads it back", () => {
    const url = buildShareUrl(6, 4294967295, "https://example.com", "/");
    const parsed = new URL(url);
    expect(parsed.searchParams.get("size")).toBe("6");
    expect(parsed.searchParams.get("board-id")).toBe("4294967295");
  });
});

describe("newShareButton", () => {
  const originalShare = navigator.share;
  const originalWriteText = navigator.clipboard?.writeText;

  afterEach(() => {
    vi.restoreAllMocks();
    // navigator.share doesn't exist by default in the test environment (it
    // matches most desktop browsers that way) — restore that absence
    // between tests rather than leaving a previous test's stub behind.
    (navigator as { share?: typeof navigator.share }).share = originalShare;
    if (navigator.clipboard) navigator.clipboard.writeText = originalWriteText;
  });

  it("renders with the default label", () => {
    const { html } = newShareButton({ getUrl: () => "https://example.com/?size=4&board-id=1" });
    expect(html.textContent).toBe("Share");
    expect(html.tagName).toBe("BUTTON");
  });

  it("calls navigator.share with the URL when available", async () => {
    const shareSpy = vi.fn().mockResolvedValue(undefined);
    navigator.share = shareSpy;
    const { html } = newShareButton({ getUrl: () => "https://example.com/?size=4&board-id=1" });

    html.click();
    await vi.waitFor(() => expect(shareSpy).toHaveBeenCalledTimes(1));

    expect(shareSpy.mock.calls[0][0]).toMatchObject({ url: "https://example.com/?size=4&board-id=1" });
  });

  it("does nothing further when the user cancels the native share sheet (AbortError)", async () => {
    const abortError = Object.assign(new Error("cancelled"), { name: "AbortError" });
    navigator.share = vi.fn().mockRejectedValue(abortError);
    const writeTextSpy = vi.spyOn(navigator.clipboard, "writeText");
    const { html } = newShareButton({ getUrl: () => "https://example.com/?size=4&board-id=1" });

    html.click();
    await vi.waitFor(() => expect(navigator.share).toHaveBeenCalledTimes(1));

    expect(writeTextSpy).not.toHaveBeenCalled();
    expect(html.textContent).toBe("Share"); // no confirmation flash, no error shown
  });

  it("falls back to clipboard copy when navigator.share fails for a reason other than cancellation", async () => {
    navigator.share = vi.fn().mockRejectedValue(new Error("no share target"));
    const writeTextSpy = vi.spyOn(navigator.clipboard, "writeText").mockResolvedValue(undefined);
    const { html } = newShareButton({ getUrl: () => "https://example.com/?size=4&board-id=1" });

    html.click();
    await vi.waitFor(() => expect(writeTextSpy).toHaveBeenCalledWith("https://example.com/?size=4&board-id=1"));
  });

  it("copies to the clipboard and flashes a confirmation when Web Share is unavailable", async () => {
    expect(navigator.share).toBeUndefined();
    const writeTextSpy = vi.spyOn(navigator.clipboard, "writeText").mockResolvedValue(undefined);
    const { html } = newShareButton({ getUrl: () => "https://example.com/?size=4&board-id=1" });

    html.click();
    await vi.waitFor(() => expect(writeTextSpy).toHaveBeenCalledWith("https://example.com/?size=4&board-id=1"));
    await vi.waitFor(() => expect(html.textContent).toBe("Link copied!"));
    expect(html.disabled).toBe(true);
  });

  it("shows the link itself when the Clipboard API write is rejected (e.g. permission denied)", async () => {
    vi.spyOn(navigator.clipboard, "writeText").mockRejectedValue(new Error("permission denied"));
    const { html } = newShareButton({ getUrl: () => "https://example.com/?size=4&board-id=1" });

    html.click();
    await vi.waitFor(() => expect(html.textContent).toBe("https://example.com/?size=4&board-id=1"));
  });

  it("shows the link itself when the Clipboard API is entirely unavailable (e.g. insecure context)", async () => {
    const original = navigator.clipboard;
    Object.defineProperty(navigator, "clipboard", { value: undefined, configurable: true });
    const { html } = newShareButton({ getUrl: () => "https://example.com/?size=4&board-id=1" });

    html.click();
    await vi.waitFor(() => expect(html.textContent).toBe("https://example.com/?size=4&board-id=1"));

    Object.defineProperty(navigator, "clipboard", { value: original, configurable: true });
  });

  it("calls getUrl fresh on every click rather than caching the first result", async () => {
    let current = "https://example.com/?size=4&board-id=1";
    const writeTextSpy = vi.spyOn(navigator.clipboard, "writeText").mockResolvedValue(undefined);
    const { html } = newShareButton({ getUrl: () => current });

    html.click();
    await vi.waitFor(() => expect(writeTextSpy).toHaveBeenCalledWith(current));

    current = "https://example.com/?size=8&board-id=2";
    // Wait out the first click's confirmation flash so the button is
    // clickable (not disabled) again before the second click.
    await vi.waitFor(() => expect(html.disabled).toBe(false), { timeout: 2000 });
    html.click();
    await vi.waitFor(() => expect(writeTextSpy).toHaveBeenCalledWith(current));
  });
});
