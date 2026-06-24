import type { RealtimeTransportClient } from "../types";
import type { RemoteRealtimeClientConfig } from "./client";
import { RemoteRealtimeClient } from "./client";

export {
  type RemoteRealtimeClientConfig,
  type RemoteRealtimeAdapterFactory,
  type RemoteRealtimeAdapterFactoryOptions,
  DEFAULT_REMOTE_REALTIME_ADAPTERS,
} from "./client";

export function createRemoteRealtimeClient(
  config?: RemoteRealtimeClientConfig,
): RealtimeTransportClient {
  return new RemoteRealtimeClient(config);
}
