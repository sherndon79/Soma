import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const schemaPath = new URL("../docs/schemas/desktop-inspection-result.schema.json", import.meta.url);

test("desktop inspection schema documents the current safe child metadata boundary", async () => {
  const schema = JSON.parse(await readFile(schemaPath, "utf8"));
  const childMetadata = schema.$defs.child_metadata;

  assert.equal(schema.title, "Soma Desktop Inspection Result");
  assert.equal(schema.$defs.atspi_tree.properties.text_content_included.const, false);
  assert.equal(schema.$defs.root_object.properties.children_sample.maxItems, 8);
  assert.equal(schema.$defs.root_object.properties.child_metadata_sample.maxItems, 4);
  assert.deepEqual(childMetadata.required, ["service", "path", "role", "child_count"]);
  assert.equal(childMetadata.additionalProperties, false);
  assert.equal("name" in childMetadata.properties, false);
  assert.equal("description" in childMetadata.properties, false);
  assert.equal("text" in childMetadata.properties, false);
  assert.equal("actions" in childMetadata.properties, false);
});
