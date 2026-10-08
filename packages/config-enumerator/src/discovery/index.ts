export { discoverPage, parseDiscoveryPlan, fingerprintReport } from "./discover.js";
export { scanDocument } from "./scan.js";
export { createDiscoveryDraft, createReviewTemplate, compileReviewedModel, renderDiscoveryReport } from "./model-draft.js";
export type {
  LocatorEvidence, ObservedOption, ObservedControl, PageObservation, ScanOptions, DiscoveryStep, DiscoveryScene, DiscoveryPlan,
  DiscoverySnapshot, SceneResult, DiscoveryReport, DraftField, DiscoveryDraft, ReviewInput, ReviewedModel,
} from "./types.js";
