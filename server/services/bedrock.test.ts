import { describe, test, before } from "node:test";
import assert from "node:assert/strict";

// bedrock.ts loads the AWS config on import; give it placeholder values.
// No AWS call is made by these tests.
let extractJsonObject: (text: string) => unknown;
before(async () => {
  process.env.AWS_REGION ??= "us-east-1";
  process.env.DYNAMODB_TABLE ??= "test";
  process.env.S3_BUCKET ??= "test";
  process.env.COGNITO_USER_POOL_ID ??= "us-east-1_test";
  process.env.COGNITO_CLIENT_ID ??= "test";
  ({ extractJsonObject } = await import("./bedrock"));
});

describe("extractJsonObject", () => {
  test("parses a bare JSON object", () => {
    assert.deepEqual(extractJsonObject('{"signals":[]}'), { signals: [] });
  });

  test("ignores markdown fences and surrounding prose", () => {
    const text = 'Here you go:\n```json\n{"a": 1, "b": {"c": [2]}}\n```\nHope that helps.';
    assert.deepEqual(extractJsonObject(text), { a: 1, b: { c: [2] } });
  });

  test("throws when there is no JSON object", () => {
    assert.throws(() => extractJsonObject("I can't help with that."), /did not contain JSON/);
  });

  test("throws on malformed JSON instead of returning partial data", () => {
    assert.throws(() => extractJsonObject('{"price": 12.5,'), /did not contain JSON|JSON/);
  });
});
