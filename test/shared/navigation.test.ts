import { describe, expect, it } from "vitest";
import { mayFrameNavigate } from "../../src/shared/navigation";

const app = "lauda-app://app";
const preview = "lauda-doc://4f2a/.lauda-preview";

describe("what a frame may load", () => {
  it("never moves a window's own page", () => {
    expect(mayFrameNavigate({ url: "https://example.com", isMainFrame: true, parentURL: null }, app)).toBe(false);
    expect(mayFrameNavigate({ url: `${app}/renderer/index.html`, isMainFrame: true, parentURL: null }, app)).toBe(
      false,
    );
  });

  it("loads the preview's page into the window", () => {
    expect(mayFrameNavigate({ url: preview, isMainFrame: false, parentURL: `${app}/renderer/index.html` }, app)).toBe(
      true,
    );
  });

  it("gives the window no other frame", () => {
    const parentURL = `${app}/renderer/index.html`;
    expect(mayFrameNavigate({ url: "https://example.com", isMainFrame: false, parentURL }, app)).toBe(false);
    expect(mayFrameNavigate({ url: "lauda-doc://4f2a/secret.png", isMainFrame: false, parentURL }, app)).toBe(false);
  });

  it("lets a document's web embeds load in the preview, over https only", () => {
    expect(
      mayFrameNavigate({ url: "https://www.youtube.com/embed/x", isMainFrame: false, parentURL: preview }, app),
    ).toBe(true);
    expect(mayFrameNavigate({ url: "http://example.com", isMainFrame: false, parentURL: preview }, app)).toBe(false);
    expect(mayFrameNavigate({ url: "file:///etc/passwd", isMainFrame: false, parentURL: preview }, app)).toBe(false);
    expect(mayFrameNavigate({ url: `${app}/renderer/index.html`, isMainFrame: false, parentURL: preview }, app)).toBe(
      false,
    );
  });

  it("leaves what happens inside an embed to the embed", () => {
    expect(
      mayFrameNavigate(
        { url: "https://ads.example/frame", isMainFrame: false, parentURL: "https://www.youtube.com/embed/x" },
        app,
      ),
    ).toBe(true);
  });

  it("refuses a frame with no parent", () => {
    expect(mayFrameNavigate({ url: "https://example.com", isMainFrame: false, parentURL: null }, app)).toBe(false);
  });
});
