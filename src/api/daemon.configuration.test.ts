import { Code, ConnectError } from "@connectrpc/connect";
import { describe, expect, it } from "vitest";

import {
  decodeJSONDocument,
  isConfigurationRPCAvailable,
  type ConfigRecoveryInfo,
  type ServiceChangePlan,
  type ServiceChangeReport,
} from "./daemon";

describe("configuration JSON documents", () => {
  it("keeps null distinct from an empty report", () => {
    expect(decodeJSONDocument<ServiceChangeReport>("null")).toBeNull();
    expect(decodeJSONDocument<ConfigRecoveryInfo>("null")).toBeNull();
  });

  it("keeps fields this client does not know yet", () => {
    const plan = decodeJSONDocument<ServiceChangePlan>(
      JSON.stringify({
        started: true,
        unchanged: false,
        liveOnly: false,
        restartRequired: true,
        changedDocument: false,
        targetRevision: "abc123",
        futureDomain: { status: "published" },
      }),
    );
    expect(plan?.targetRevision).toBe("abc123");
    expect((plan as ServiceChangePlan & { futureDomain: unknown }).futureDomain).toEqual({
      status: "published",
    });
  });

  it("rejects a document that is not an object", () => {
    expect(() => decodeJSONDocument("[]")).toThrow("not an object");
    expect(() => decodeJSONDocument('"text"')).toThrow("not an object");
  });

  it("treats only Unimplemented as an older kernel", () => {
    expect(
      isConfigurationRPCAvailable(new ConnectError("unknown method", Code.Unimplemented)),
    ).toBe(true);
    expect(isConfigurationRPCAvailable(new ConnectError("unavailable", Code.Unavailable))).toBe(
      false,
    );
    expect(isConfigurationRPCAvailable(new Error("boom"))).toBe(false);
  });
});
