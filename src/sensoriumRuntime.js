import {
  SensorBrokerManager,
  SENSOR_BROKER_DEFAULT_BINARY,
} from "./sensorBroker.js";
import { SensoriumSubscriber } from "./sensoriumSubscriber.js";

const ENABLED_VALUES = new Set(["1", "true", "yes", "on"]);

export function isSensoriumRuntimeEnabled(env = process.env) {
  return ENABLED_VALUES.has(String(env.SOMA_SENSORIUM_ENABLED ?? "").trim().toLowerCase());
}

export async function createSensoriumRuntime({
  env = process.env,
  logger = console,
  managerFactory = defaultManagerFactory,
  subscriberFactory = defaultSubscriberFactory,
} = {}) {
  if (!isSensoriumRuntimeEnabled(env)) {
    return {
      enabled: false,
      subscriber: null,
      helper_path: "",
      async stop() {},
    };
  }

  const helperPath = env.SOMA_SENSOR_BROKER || SENSOR_BROKER_DEFAULT_BINARY;
  const manager = managerFactory({ binaryPath: helperPath });

  try {
    await manager.start();
  } catch (cause) {
    const error = new Error(
      `Sensorium runtime opt-in failed: could not start sensor broker helper at ${helperPath}.`,
    );
    error.code = "sensorium_runtime_start_failed";
    error.helper_path = helperPath;
    error.cause = cause;
    logger.error?.(error.message);
    throw error;
  }

  logger.info?.(`Sensorium runtime enabled with helper ${helperPath}`);

  return {
    enabled: true,
    subscriber: subscriberFactory({ manager }),
    helper_path: helperPath,
    async stop() {
      await manager.stop();
    },
  };
}

function defaultManagerFactory({ binaryPath }) {
  return new SensorBrokerManager({ binaryPath });
}

function defaultSubscriberFactory({ manager }) {
  return new SensoriumSubscriber({ manager });
}
