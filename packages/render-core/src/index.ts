// Lip sync utilities
export { RealTimeLipSync } from "./lipsync";

// Motion inference utilities
export { inferMotionFromMessage } from "./motion-inference";

// Mouse tracking utilities
export {
  setupMouseTracking,
  type MouseTrackingMode,
  type MouseCoordinates,
  type MouseTrackable,
  type MouseTrackingOptions,
  type MouseTrackingCleanup,
} from "./mouse-tracking";

// Render management
export {
  RenderManager,
  createRenderManager,
  type RenderManagerOptions,
} from "./render-manager";
