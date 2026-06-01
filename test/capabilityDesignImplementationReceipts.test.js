import assert from "node:assert/strict";
import test from "node:test";

import {
  loadCapabilityCatalog,
  loadProviderRegistry,
} from "../src/capabilityCatalog.js";
import {
  loadCapabilityDesignImplementationReceipts,
  validateCapabilityDesignImplementationReceipt,
  validateCapabilityDesignImplementationReceipts,
} from "../src/capabilityDesignImplementationReceipts.js";

test("capability design implementation receipts match catalog and provider claims", async () => {
  const catalog = await loadCapabilityCatalog();
  const providerRegistry = await loadProviderRegistry();
  const receipts = await loadCapabilityDesignImplementationReceipts();

  assert.ok(receipts.some((receipt) => receipt.implemented_as === "status.snapshot.read"));
  const validated = validateCapabilityDesignImplementationReceipts(receipts, {
    catalog,
    providerRegistry,
  });
  const statusReceipt = validated.find((receipt) => receipt.implemented_as === "status.snapshot.read");
  assert.equal(statusReceipt.provider, "soma.provider.status");
  assert.equal(statusReceipt.provider_contract, "soma.status.snapshot.v1");
  assert.equal(statusReceipt.receipt_confers_authority, false);
  assert.ok(statusReceipt.tests.length >= 1);
});

test("capability design implementation receipt rejects missing catalog or provider linkage", async () => {
  const catalog = await loadCapabilityCatalog();
  const providerRegistry = await loadProviderRegistry();

  assert.throws(
    () => validateCapabilityDesignImplementationReceipt({
      receipt_type: "capability_design_implementation",
      source_design: { capability: "status.snapshot.read" },
      implemented_as: "status.snapshot.missing",
      provider: "soma.provider.status",
      provider_contract: "soma.status.snapshot.v1",
      implemented_by: "test",
      tests: ["test/example.test.js"],
      authority: {
        receipt_confers_authority: false,
        grant_written: false,
        activation_performed: false,
        catalog_mutation_runtime: false,
      },
    }, {
      catalog,
      providerRegistry,
    }),
    /implemented_as status\.snapshot\.missing must exist in the capability catalog/,
  );

  assert.throws(
    () => validateCapabilityDesignImplementationReceipt({
      receipt_type: "capability_design_implementation",
      source_design: { capability: "status.snapshot.read" },
      implemented_as: "status.snapshot.read",
      provider: "soma.provider.scoped-files",
      provider_contract: "soma.status.snapshot.v1",
      implemented_by: "test",
      tests: ["test/example.test.js"],
      authority: {
        receipt_confers_authority: false,
        grant_written: false,
        activation_performed: false,
        catalog_mutation_runtime: false,
      },
    }, {
      catalog,
      providerRegistry,
    }),
    /provider soma\.provider\.scoped-files must claim implemented_as status\.snapshot\.read/,
  );
});
