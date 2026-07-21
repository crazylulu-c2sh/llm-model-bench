import { describe, expect, it } from "vitest";
import { chooseImageDelivery, isLoopbackOrPrivateOrigin } from "./vision-origin";

describe("isLoopbackOrPrivateOrigin", () => {
  it.each([
    "http://localhost:1234",
    "http://127.0.0.1:1234",
    "http://127.0.0.2:1234",
    "http://10.0.0.1:1234",
    "http://10.255.255.255:1234",
    "http://192.168.0.1:1234",
    "http://192.168.1.100:80",
    "http://172.16.0.1:1234",
    "http://172.31.255.255:1234",
    // RFC 6598 CGNAT / Tailscale (100.64.0.0/10)
    "http://100.64.0.1:1234",
    "http://100.100.1.2:20080",
    "http://100.127.255.255:1234",
  ])("private/loopback: %s → true", (origin) => {
    expect(isLoopbackOrPrivateOrigin(origin)).toBe(true);
  });

  it.each([
    "http://100.63.255.255:1234",   // 100.64.0.0/10 미만
    "http://100.128.0.1:1234",      // 100.64.0.0/10 초과
    "https://example.com",
    "https://api.openai.com",
    "http://8.8.8.8:1234",
  ])("public: %s → false", (origin) => {
    expect(isLoopbackOrPrivateOrigin(origin)).toBe(false);
  });
});

describe("chooseImageDelivery", () => {
  it("private origin → base64", () => {
    expect(chooseImageDelivery("http://100.100.1.2:20080")).toBe("base64");
    expect(chooseImageDelivery("http://127.0.0.1:1234")).toBe("base64");
  });

  it("public origin → url", () => {
    expect(chooseImageDelivery("https://example.com")).toBe("url");
  });
});
