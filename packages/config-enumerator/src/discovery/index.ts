export { discoverPage, parseDiscoveryPlan, fingerprintReport } from "./discover.js";
export { scanDocument } from "./scan.js";
export { createDiscoveryDraft, createReviewTemplate, compileReviewedModel, renderDiscoveryReport } from "./model-draft.js";
export { resolveDomElement, findElement, waitElement, enterFrames } from "./dom.js";
export type * from "./types.js";
export { readHandsontable, readHandsontableDOM, requireHandsontableCell, createHandsontableReport } from './handsontable.js';
export type { HandsontableCell, HandsontableTarget, HandsontableReading, HandsontableObservation, HandsontableReadOptions } from './handsontable.js';
export { createUiElementModel, findUiRelations, renderUiElementModel } from './ui-model.js';
export type { UiElementModel, UiElement, UiObservation, UiRelation, UiRelationEvidence, UiElementKind, UiRelationKind } from './ui-model.js';
