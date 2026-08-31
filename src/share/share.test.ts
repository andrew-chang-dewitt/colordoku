import { afterEach, describe, expect, it, vi } from "vitest";
import { buildShareUrl, newShareButton } from "./share";
import { isDifficulty } from "../options/options";

describe("buildShareUrl", () => {
  it("encodes size, board-id, and difficulty as query params reproducing this exact board", () => {
    expect(buildShareUrl(4, 12345, "https://example.com", "/", "medium")).toBe(
      "https://example.com/?size=4&board-id=12345&difficulty=medium",
    );
  });

  it("preserves a non-root pathname", () => {
    expect(buildShareUrl(8, 999, "https://example.com", "/colordoku/", "hard")).toBe(
      "https://example.com/colordoku/?size=8&board-id=999&difficulty=hard",
    );
  });

  it("round-trips through URLSearchParams the same way main.ts reads it back", () => {
    const url = buildShareUrl(6, 4294967295, "https://example.com", "/", "easy");
    const parsed = new URL(url);
    expect(parsed.searchParams.get("size")).toBe("6");
    expect(parsed.searchParams.get("board-id")).toBe("4294967295");
    expect(parsed.searchParams.get("difficulty")).toBe("easy");
  });

  it("includes all three difficulty values verbatim in the built URL", () => {
    expect(buildShareUrl(4, 123, "https://example.com", "/", "easy")).toContain("difficulty=easy");
    expect(buildShareUrl(4, 123, "https://example.com", "/", "medium")).toContain("difficulty=medium");
    expect(buildShareUrl(4, 123, "https://example.com", "/", "hard")).toContain("difficulty=hard");
  });

  it("round-trips difficulty through URL parsing and back", () => {
    const difficulties = ["easy", "medium", "hard"] as const;
    for (const difficulty of difficulties) {
      const url = buildShareUrl(4, 123, "https://example.com", "/", difficulty);
      const parsed = new URL(url);
      expect(parsed.searchParams.get("difficulty")).toBe(difficulty);
    }
  });

  it("produces difficulty values that pass isDifficulty validation", () => {
    const difficulties = ["easy", "medium", "hard"] as const;
    for (const difficulty of difficulties) {
      const url = buildShareUrl(4, 123, "https://example.com", "/", difficulty);
      const parsed = new URL(url);
      const difficultyParam = parsed.searchParams.get("difficulty");
      expect(isDifficulty(difficultyParam)).toBe(true);
    }
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

  it("renders as an icon-only button in a container", () => {
    const { html } = newShareButton({ getUrl: () => "https://example.com/?size=4&board-id=1" });
    expect(html.tagName).toBe("DIV");
    const button = html.querySelector("button");
    expect(button).not.toBeNull();
    expect(button?.getAttribute("aria-label")).toBe("Colordoku");
  });

  it("calls navigator.share with the URL when available", async () => {
    const shareSpy = vi.fn().mockResolvedValue(undefined);
    navigator.share = shareSpy;
    const { html } = newShareButton({ getUrl: () => "https://example.com/?size=4&board-id=1" });

    const button = html.querySelector("button") as HTMLButtonElement;
    button.click();
    await vi.waitFor(() => expect(shareSpy).toHaveBeenCalledTimes(1));

    expect(shareSpy.mock.calls[0][0]).toMatchObject({ url: "https://example.com/?size=4&board-id=1" });
  });

  it("does nothing further when the user cancels the native share sheet (AbortError)", async () => {
    const abortError = Object.assign(new Error("cancelled"), { name: "AbortError" });
    navigator.share = vi.fn().mockRejectedValue(abortError);
    const writeTextSpy = vi.spyOn(navigator.clipboard, "writeText");
    const { html } = newShareButton({ getUrl: () => "https://example.com/?size=4&board-id=1" });

    const button = html.querySelector("button") as HTMLButtonElement;
    button.click();
    await vi.waitFor(() => expect(navigator.share).toHaveBeenCalledTimes(1));

    expect(writeTextSpy).not.toHaveBeenCalled();
    // no confirmation flash shown, flash message div remains hidden
    const flashMessage = html.querySelector("div:last-of-type") as HTMLDivElement;
    expect(flashMessage?.style.display).toBe("none");
  });

  it("falls back to clipboard copy when navigator.share fails for a reason other than cancellation", async () => {
    navigator.share = vi.fn().mockRejectedValue(new Error("no share target"));
    const writeTextSpy = vi.spyOn(navigator.clipboard, "writeText").mockResolvedValue(undefined);
    const { html } = newShareButton({ getUrl: () => "https://example.com/?size=4&board-id=1" });

    const button = html.querySelector("button") as HTMLButtonElement;
    button.click();
    await vi.waitFor(() => expect(writeTextSpy).toHaveBeenCalledWith("https://example.com/?size=4&board-id=1"));
  });

  it("copies to the clipboard and flashes a confirmation when Web Share is unavailable", async () => {
    expect(navigator.share).toBeUndefined();
    const writeTextSpy = vi.spyOn(navigator.clipboard, "writeText").mockResolvedValue(undefined);
    const { html } = newShareButton({ getUrl: () => "https://example.com/?size=4&board-id=1" });

    const button = html.querySelector("button") as HTMLButtonElement;
    button.click();
    await vi.waitFor(() => expect(writeTextSpy).toHaveBeenCalledWith("https://example.com/?size=4&board-id=1"));
    await vi.waitFor(() => expect(html.textContent).toBe("Link copied!"));
    expect(button.disabled).toBe(true);
  });

  it("shows the link itself when the Clipboard API write is rejected (e.g. permission denied)", async () => {
    vi.spyOn(navigator.clipboard, "writeText").mockRejectedValue(new Error("permission denied"));
    const { html } = newShareButton({ getUrl: () => "https://example.com/?size=4&board-id=1" });

    const button = html.querySelector("button") as HTMLButtonElement;
    button.click();
    await vi.waitFor(() => expect(html.textContent).toBe("https://example.com/?size=4&board-id=1"));
  });

  it("shows the link itself when the Clipboard API is entirely unavailable (e.g. insecure context)", async () => {
    const original = navigator.clipboard;
    Object.defineProperty(navigator, "clipboard", { value: undefined, configurable: true });
    const { html } = newShareButton({ getUrl: () => "https://example.com/?size=4&board-id=1" });

    const button = html.querySelector("button") as HTMLButtonElement;
    button.click();
    await vi.waitFor(() => expect(html.textContent).toBe("https://example.com/?size=4&board-id=1"));

    Object.defineProperty(navigator, "clipboard", { value: original, configurable: true });
  });

  it("calls getUrl fresh on every click rather than caching the first result", async () => {
    let current = "https://example.com/?size=4&board-id=1";
    const writeTextSpy = vi.spyOn(navigator.clipboard, "writeText").mockResolvedValue(undefined);
    const { html } = newShareButton({ getUrl: () => current });

    const button = html.querySelector("button") as HTMLButtonElement;
    button.click();
    await vi.waitFor(() => expect(writeTextSpy).toHaveBeenCalledWith(current));

    current = "https://example.com/?size=8&board-id=2";
    // Wait out the first click's confirmation flash so the button is
    // clickable (not disabled) again before the second click.
    await vi.waitFor(() => expect(button.disabled).toBe(false), { timeout: 2000 });
    button.click();
    await vi.waitFor(() => expect(writeTextSpy).toHaveBeenCalledWith(current));
  });

  it("flashes a message below the button on clipboard copy", async () => {
    const writeTextSpy = vi.spyOn(navigator.clipboard, "writeText").mockResolvedValue(undefined);
    const { html } = newShareButton({
      getUrl: () => "https://example.com/?size=4&board-id=1",
      title: "Share",
    });

    const button = html.querySelector("button") as HTMLButtonElement;
    const flashMessage = html.querySelector("div:last-of-type") as HTMLDivElement;

    // Check initial state: flash message is hidden, aria-label present
    expect(flashMessage?.style.display).toBe("none");
    expect(button?.getAttribute("aria-label")).toBe("Share");

    // Click and verify flash appears
    button.click();
    await vi.waitFor(() => expect(writeTextSpy).toHaveBeenCalled());
    await vi.waitFor(() => expect(flashMessage?.style.display).toBe("block"));
    expect(flashMessage?.textContent).toBe("Link copied!");

    // Wait for the flash to complete and verify it's hidden again
    await vi.waitFor(() => expect(button?.disabled).toBe(false), { timeout: 2000 });
    expect(flashMessage?.style.display).toBe("none");
  });
});
