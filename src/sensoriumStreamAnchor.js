const SENSORIUM_TOPIC_PATTERNS = [
  {
    capability: "perception.sensorium.color.subscribe",
    stream_type: "color",
    pattern: /^sensor\/([a-z0-9-]+)\/realsense\/color$/,
  },
  {
    capability: "perception.sensorium.depth.subscribe",
    stream_type: "depth",
    pattern: /^sensor\/([a-z0-9-]+)\/realsense\/depth$/,
  },
  {
    capability: "perception.sensorium.imu.subscribe",
    stream_type: "imu",
    pattern: /^sensor\/([a-z0-9-]+)\/realsense\/imu\/(?:accel|gyro)$/,
  },
  {
    capability: "perception.sensorium.status.subscribe",
    stream_type: "status",
    pattern: /^sensor\/([a-z0-9-]+)\/status$/,
  },
  {
    capability: "perception.sensorium.pose.subscribe",
    stream_type: "pose",
    pattern: /^perception\/([a-z0-9-]+)\/pose\/features$/,
  },
];

export function createSensoriumStreamAnchor({
  helperStatus,
  nodeSubscriptions = [],
} = {}) {
  const helperStatusState = normalizeHelperStatus(helperStatus);
  const helperStreams = helperStatusState.active_streams;
  const nodeStreams = normalizeNodeSubscriptions(nodeSubscriptions);
  const helperIds = new Set(helperStreams.map((stream) => stream.subscription_id));
  const nodeIds = new Set(nodeStreams.map((stream) => stream.subscription_id));
  const missingInNode = helperStreams
    .filter((stream) => !nodeIds.has(stream.subscription_id))
    .map((stream) => stream.subscription_id);
  const missingInHelper = nodeStreams
    .filter((stream) => !helperIds.has(stream.subscription_id))
    .map((stream) => stream.subscription_id);

  return Object.freeze({
    schema_version: 1,
    source: "helper_status",
    authority_anchor: "sensorium.subscribe.status",
    status_known: helperStatusState.status_known,
    active_streams: helperStreams,
    depth_active: helperStreams.some((stream) => stream.stream_type === "depth"),
    color_active: helperStreams.some((stream) => stream.stream_type === "color"),
    color_inactive_confirmed:
      helperStatusState.status_known &&
      !helperStreams.some((stream) => stream.stream_type === "color"),
    raw_payload_included: false,
    node_reconciliation: {
      checked: true,
      helper_status_known: helperStatusState.status_known,
      matched:
        helperStatusState.status_known &&
        missingInNode.length === 0 &&
        missingInHelper.length === 0,
      helper_count: helperStreams.length,
      node_count: nodeStreams.length,
      missing_in_node: missingInNode,
      missing_in_helper: missingInHelper,
    },
  });
}

export function normalizeHelperStatus(status = {}) {
  if (!isPlainObject(status)) {
    return {
      status_known: false,
      active_streams: [],
    };
  }
  if (!Array.isArray(status.subscriptions)) {
    return {
      status_known: false,
      active_streams: [],
    };
  }
  return {
    status_known: true,
    active_streams: status.subscriptions.map(normalizeSubscription).filter(Boolean),
  };
}

export function classifySensoriumTopic(topic = "") {
  const normalizedTopic = stringValue(topic);
  for (const candidate of SENSORIUM_TOPIC_PATTERNS) {
    const match = normalizedTopic.match(candidate.pattern);
    if (match) {
      return {
        capability: candidate.capability,
        stream_type: candidate.stream_type,
        host: match[1],
      };
    }
  }
  return {
    capability: "",
    stream_type: "unknown",
    host: "",
  };
}

function normalizeNodeSubscriptions(subscriptions) {
  if (!Array.isArray(subscriptions)) {
    return [];
  }
  return subscriptions.map(normalizeSubscription).filter(Boolean);
}

function normalizeSubscription(subscription) {
  if (!isPlainObject(subscription)) {
    return null;
  }
  const subscriptionId = stringValue(subscription.subscription_id);
  const topic = stringValue(subscription.topic);
  if (!subscriptionId || !topic || subscription.active === false) {
    return null;
  }
  const topicClass = classifySensoriumTopic(topic);
  return {
    subscription_id: subscriptionId,
    topic,
    host: topicClass.host,
    capability: topicClass.capability,
    stream_type: topicClass.stream_type,
    started_at: numberOrNull(subscription.started_at),
    active: true,
  };
}

function numberOrNull(value) {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function stringValue(value) {
  return typeof value === "string" ? value.trim() : "";
}

function isPlainObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
