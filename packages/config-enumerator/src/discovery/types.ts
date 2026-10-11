import type { ConfigurationModel, JsonValue, Rule } from "../types.js";

/** selector 只在所在根内匹配；shadowPath 按外到内列出开放 Shadow 宿主。 */
export interface DomAddress { selector: string; shadowPath?: string[] }
export interface DocumentContext { url: string; framePath: DomAddress[] }
export interface LocatorEvidence extends DomAddress {
  shadowPath: string[];
  basis: "test-id" | "id" | "radio-group" | "structure";
  unique: boolean;
}
export interface OptionCoverage {
  status: "complete" | "partial" | "unknown";
  source: "native-select" | "aria-setsize" | "rendered-dom";
  observedCount: number;
  totalCount: number | null;
  reasons: string[];
}
export interface ObservedOption {
  label: string; value: JsonValue; valueKnown: boolean;
  disabled: boolean; selected: boolean;
}
export interface ObservedControl {
  key: string; context: DocumentContext;
  category: "field" | "action"; kind: string; label: string;
  locator: LocatorEvidence;
  currentValue: JsonValue; valueKnown: boolean;
  disabled: boolean; readOnly: boolean; required: boolean;
  multiple: boolean | null;
  attributes: Record<string, string>;
  options: ObservedOption[]; optionCoverage: OptionCoverage | null;
  notes: string[]; dialog: LocatorEvidence | null;
}
export interface ObservedDialog { label: string; locator: LocatorEvidence; context: DocumentContext }
export interface ObservedCell {
  key: string; context: DocumentContext; locator: LocatorEvidence;
  table: LocatorEvidence; row: LocatorEvidence;
  rowKey: string | null; rowIndex: number | null;
  columnKey: string | null; columnIndex: number; columnLabel: string;
  displayText: string; displayTruncated: boolean;
  businessValue: JsonValue; valueKnown: boolean;
  valueSource: "explicit-dom-json" | "unknown";
  notes: string[];
}
export interface PopupLink { opener: DomAddress; popup: DomAddress }
export interface ScanOptions {
  maxControls: number; maxOptions: number; maxTextLength: number;
  maxCells: number; maxShadowDepth: number;
  scopes: DomAddress[];
  framePath: DomAddress[];
  popup?: PopupLink;
}
/** 一次文档扫描，frames 交由 Playwright 协调器进入。 */
export interface PageObservation {
  url: string; controls: ObservedControl[]; cells: ObservedCell[];
  dialogs: ObservedDialog[]; frames: LocatorEvidence[];
  warnings: string[]; truncated: boolean;
}
export interface DiscoveryStep {
  kind: "open-dropdown" | "activate-tab" | "open-dialog";
  target: DomAddress; expected: DomAddress;
}
export interface DiscoveryScene {
  id: string; url: string; ready: DomAddress;
  framePath?: DomAddress[]; scope?: DomAddress;
  steps: DiscoveryStep[];
}
export interface DiscoveryPlan {
  schemaVersion: 2; id: string; scenes: DiscoveryScene[];
  limits?: {
    maxSnapshots?: number; maxControls?: number; maxOptions?: number;
    maxTextLength?: number; timeoutMs?: number; maxCells?: number;
    maxFrames?: number; maxFrameDepth?: number; maxShadowDepth?: number;
  };
}
export interface DialogAssociation {
  step: number; label: string; context: DocumentContext; opener: DomAddress;
  dialog: DomAddress; parentDialog: DomAddress | null;
  transition: "hidden-to-visible";
}
export interface DocumentScan {
  context: DocumentContext;
  status: "scanned" | "unavailable" | "limited";
  reason?: string;
}
export interface DiscoverySnapshot extends Omit<PageObservation, "frames"> {
  id: string; sceneId: string; afterStep: number;
  documents: DocumentScan[]; associations: DialogAssociation[];
}
export interface SceneResult {
  id: string;
  status: "completed" | "blocked" | "failed" | "limited" | "cancelled";
  completedSteps: number; reason?: string;
}
export interface DiscoveryReport {
  schemaVersion: 2; artifactType: "page-discovery"; reportId: string;
  plan: DiscoveryPlan; startedAt: string; finishedAt: string;
  status: "completed" | "partial" | "cancelled";
  scope: "specified-scenes-and-openers";
  snapshots: DiscoverySnapshot[]; scenes: SceneResult[]; limitations: string[];
}
export interface DraftField {
  sourceId: string; suggestedId: string; label: string; kind: string;
  url: string; context: DocumentContext; locator: LocatorEvidence;
  observedIn: string[]; suggestedValues: JsonValue[]; observedOptions: ObservedOption[];
  observations: {
    snapshotId: string; currentValue: JsonValue; valueKnown: boolean;
    multiple: boolean | null; disabled: boolean; readOnly: boolean;
    required: boolean; attributes: Record<string, string>;
    optionCoverage: OptionCoverage | null;
  }[];
  needsReview: string[];
}
export interface DiscoveryDraft {
  schemaVersion: 2; artifactType: "unreviewed-configuration-draft";
  reportId: string; status: "needs-review"; fields: DraftField[];
  businessRules: "not-inferred";
}
export interface ReviewInput {
  reportId: string;
  confirmed: { scope: boolean; domains: boolean; businessRules: boolean };
  modelId: string; version: string;
  fields: { sourceId: string; include: boolean; id: string; values: JsonValue[] }[];
  rules: Rule[];
}
export interface ReviewedModel {
  model: ConfigurationModel;
  mapping: { schemaVersion: 2; reportId: string; fields: {
    id: string; sourceId: string; url: string; context: DocumentContext;
    locator: LocatorEvidence; observedIn: string[];
  }[] };
}
