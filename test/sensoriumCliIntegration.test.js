import assert from "node:assert/strict";
import { Readable } from "node:stream";
import test from "node:test";

import { createRequestHandler } from "../src/app.js";
import { parseCli, runCli } from "../src/cli.js";

const capabilityCatalog = {
  schema_version: 1,
  capabilities: [
    {
      key: "perception.sensorium.color.subscribe",
      name: "Sensorium Color Stream Subscription",
      category: "perception",
      risk_class: "high",
      default_status: "disabled",
      allowed_scopes: ["session"],
      activation_policy: "explicit_grant",
      provider_contract: "soma.perception.sensorium.color.v1",
    },
    {
      key: "perception.sensorium.imu.subscribe",
      name: "Sensorium IMU Stream Subscription",
      category: "perception",
      risk_class: "sensitive",
      default_status: "disabled",
      allowed_scopes: ["session"],
      activation_policy: "explicit_grant",
      provider_contract: "soma.perception.sensorium.imu.v1",
    },
  ],
};

const providerRegistry = {
  schema_version: 1,
  providers: [
    {
      id: "soma.provider.sensorium.jetsorano",
      name: "Sensorium Node (jetsorano)",
      runtime: "test",
      local_only: false,
      network_access: true,
      host_segment: "jetsorano",
      capabilities: [
        "perception.sensorium.color.subscribe",
        "perception.sensorium.imu.subscribe",
      ],
    },
  ],
};

const ACTIVE_COLOR_GRANT = {
  id: "grant-sensorium-color",
  status: "active",
  capability: "perception.sensorium.color.subscribe",
  provider: "soma.provider.sensorium.jetsorano",
  scope: "session",
  constraints: {
    topic: "sensor/jetsorano/realsense/color",
    max_seconds: 60,
    max_fps: 10,
    format_required: "jpeg",
    downsample_to: [640, 480],
  },
  approved_by: "user",
  reason: "test fixture",
  created_at: "2026-05-17T00:00:00.000Z",
  review_required: false,
  revoked_at: null,
  revoked_by: "",
  revocation_reason: "",
  replacement_grant_id: "",
  activation_performed: false,
};

const ACTIVE_IMU_GRANT = {
  ...ACTIVE_COLOR_GRANT,
  id: "grant-sensorium-imu",
  capability: "perception.sensorium.imu.subscribe",
  constraints: {
    topic: "sensor/jetsorano/realsense/imu/accel",
    max_seconds: 60,
  },
};

test("sensorium CLI start list and stop flow runs through HTTP handler without payload disclosure", async () => {
  const subscriber = makeFakeSensoriumSubscriber();
  const handler = makeHandler({
    grantStore: { schema_version: 1, grants: [ACTIVE_COLOR_GRANT] },
    sensoriumSubscriber: subscriber,
  });
  const request = requestAgainstHandler(handler);

  const startWrites = [];
  await runCli(parseCli([
    "node",
    "soma",
    "sensorium",
    "subscribe-start",
    "--capability",
    "perception.sensorium.color.subscribe",
    "--topic",
    "sensor/jetsorano/realsense/color",
    "--max-seconds",
    "30",
    "--max-fps",
    "5",
    "--format",
    "jpeg",
    "--downsample",
    "320x240",
  ]), {
    stdout: { write: (value) => startWrites.push(value) },
    request,
  });

  assert.match(startWrites.join(""), /Sensorium subscription started/);
  assert.match(startWrites.join(""), /grant: grant-sensorium-color/);

  const listWrites = [];
  await runCli(parseCli(["node", "soma", "sensorium", "subscriptions", "--json"]), {
    stdout: { write: (value) => listWrites.push(value) },
    request,
  });
  const disclosure = JSON.parse(listWrites.join(""));
  assert.equal(disclosure.active_count, 1);
  assert.equal(disclosure.frames_recorded, false);
  assert.equal(JSON.stringify(disclosure).includes("payload"), false);
  assert.equal(JSON.stringify(disclosure).includes("frame_content"), false);
  assert.equal(JSON.stringify(disclosure).includes("raw_sample"), false);

  const stopWrites = [];
  await runCli(parseCli(["node", "soma", "sensorium", "subscribe-stop", "sub-color-1"]), {
    stdout: { write: (value) => stopWrites.push(value) },
    request,
  });
  assert.match(stopWrites.join(""), /Sensorium subscription stopped/);
  assert.match(stopWrites.join(""), /termination: clean_stop/);

  const emptyWrites = [];
  await runCli(parseCli(["node", "soma", "sensorium", "subscriptions", "--json"]), {
    stdout: { write: (value) => emptyWrites.push(value) },
    request,
  });
  assert.equal(JSON.parse(emptyWrites.join("")).active_count, 0);
});

test("sensorium CLI start fails through handler when no active grant exists", async () => {
  const handler = makeHandler({
    grantStore: { schema_version: 1, grants: [] },
    sensoriumSubscriber: makeFakeSensoriumSubscriber(),
  });

  await assert.rejects(
    () => runCli(parseCli([
      "node",
      "soma",
      "sensorium",
      "subscribe-start",
      "--capability",
      "perception.sensorium.color.subscribe",
      "--topic",
      "sensor/jetsorano/realsense/color",
      "--max-seconds",
      "30",
    ]), {
      stdout: { write() {} },
      request: requestAgainstHandler(handler),
    }),
    { code: "sensorium_subscription_no_grant", statusCode: 403 },
  );
});

test("sensorium CLI start preserves exact-topic and constraint denial from handler", async () => {
  const topicHandler = makeHandler({
    grantStore: { schema_version: 1, grants: [ACTIVE_IMU_GRANT] },
    sensoriumSubscriber: makeFakeSensoriumSubscriber(),
  });

  await assert.rejects(
    () => runCli(parseCli([
      "node",
      "soma",
      "sensorium",
      "subscribe-start",
      "--capability",
      "perception.sensorium.imu.subscribe",
      "--topic",
      "sensor/jetsorano/realsense/imu/gyro",
      "--max-seconds",
      "30",
    ]), {
      stdout: { write() {} },
      request: requestAgainstHandler(topicHandler),
    }),
    { code: "sensorium_subscription_topic_not_authorized", statusCode: 403 },
  );

  const constraintHandler = makeHandler({
    grantStore: { schema_version: 1, grants: [ACTIVE_COLOR_GRANT] },
    sensoriumSubscriber: makeFakeSensoriumSubscriber(),
  });

  await assert.rejects(
    () => runCli(parseCli([
      "node",
      "soma",
      "sensorium",
      "subscribe-start",
      "--capability",
      "perception.sensorium.color.subscribe",
      "--topic",
      "sensor/jetsorano/realsense/color",
      "--max-seconds",
      "120",
    ]), {
      stdout: { write() {} },
      request: requestAgainstHandler(constraintHandler),
    }),
    { code: "sensorium_subscription_grant_constraints_exceeded", statusCode: 403 },
  );
});

test("sensorium CLI subscribe-stop requires an id before calling HTTP", async () => {
  await assert.rejects(
    () => runCli(parseCli(["node", "soma", "sensorium", "subscribe-stop"]), {
      stdout: { write() {} },
      request: async () => {
        throw new Error("request should not be called");
      },
    }),
    { code: "usage_error", statusCode: 2 },
  );
});

function makeHandler({ grantStore, sensoriumSubscriber }) {
  return createRequestHandler({
    harness: { capabilities: [] },
    capabilityCatalog,
    providerRegistry,
    moduleRegistry: { schema_version: 1, modules: [] },
    runtimeProfiles: { schema_version: 1, default_profile: "", profiles: [] },
    modelClient: {
      async chat() {
        return { text: "ok", model: "test", finish_reason: "stop", tokens_used: 1 };
      },
    },
    grantStore,
    sensoriumSubscriber,
    logger: { info() {} },
  });
}

function makeFakeSensoriumSubscriber() {
  const active = new Map();
  return {
    async start({ capability, provider, grantId, scope, body }) {
      const subscriptionId = `sub-color-${active.size + 1}`;
      const startedAt = 1_700_000_000 + active.size;
      const startedAtIso = new Date(startedAt * 1000).toISOString();
      const record = {
        subscription_id: subscriptionId,
        capability,
        provider,
        grant_id: grantId,
        scope,
        topic: body.topic,
        started_at: startedAtIso,
        expires_at: new Date((startedAt + body.constraints.max_seconds) * 1000).toISOString(),
        constraints_declared: body.constraints,
        frames_consumed_so_far: 0,
      };
      active.set(subscriptionId, record);
      return {
        subscription_id: subscriptionId,
        topic: body.topic,
        started_at: startedAt,
        startSummary: {
          event_type: "perception.sensorium.subscription_started",
          timestamp: startedAtIso,
          capability,
          provider,
          grant_id: grantId,
          scope,
          topic: body.topic,
          constraints_declared: body.constraints,
          text_content_included: false,
          frames_recorded: false,
        },
      };
    },
    async stop(subscriptionId, { terminationReason = "clean_stop" } = {}) {
      const record = active.get(subscriptionId);
      if (!record) {
        const error = new Error(`No subscription ${subscriptionId}`);
        error.code = "subscription_not_found";
        throw error;
      }
      active.delete(subscriptionId);
      return {
        endSummary: {
          event_type: "perception.sensorium.subscription_ended",
          timestamp: "2026-05-17T00:00:00.000Z",
          subscription_id: subscriptionId,
          termination_reason: terminationReason,
          frames_consumed: 0,
          duration_seconds: 0,
          text_content_included: false,
          frames_recorded: false,
        },
      };
    },
    describeActive() {
      return {
        family: "perception.sensorium",
        active_count: active.size,
        summary: active.size === 0 ? "No Sensorium subscriptions active" : `${active.size} Sensorium subscription active`,
        streams: Array.from(active.values()).map((record) => ({
          ...record,
          recent_frame_rate: 0,
          expires_in_seconds: 30,
        })),
        frames_recorded: false,
      };
    },
  };
}

function requestAgainstHandler(handler) {
  return async (_baseUrl, method, path, body) => {
    const response = await invokeHandler(handler, { method, url: path, body });
    if (response.statusCode >= 400) {
      const error = new Error(response.body?.message ?? `Soma request failed with HTTP ${response.statusCode}.`);
      error.code = response.body?.error ?? "request_failed";
      error.statusCode = response.statusCode;
      throw error;
    }
    return response.body;
  };
}

async function invokeHandler(handler, { method, url, body }) {
  const req = Readable.from(body === undefined ? [] : [Buffer.from(JSON.stringify(body))]);
  req.method = method;
  req.url = url;
  req.headers = { "content-type": "application/json" };

  const chunks = [];
  const res = {
    statusCode: 0,
    headers: {},
    writeHead(statusCode, headers) {
      this.statusCode = statusCode;
      this.headers = headers;
    },
    end(chunk) {
      if (chunk) {
        chunks.push(Buffer.from(chunk));
      }
    },
  };

  await handler(req, res);

  const raw = Buffer.concat(chunks).toString("utf8");
  return {
    statusCode: res.statusCode,
    headers: res.headers,
    body: raw ? JSON.parse(raw) : null,
  };
}
