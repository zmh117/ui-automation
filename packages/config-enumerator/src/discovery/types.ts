import type { ConfigurationModel, JsonValue, Rule } from "../types.js";

/** selector 为稳定 CSS 或 anchor= 语义关系，仅匹配自身及祖先可见的节点。shadowPath 逐层列出开放宿主。 */
export interface DomAddress { selector: string; shadowPath?: string[] }
export interface DocumentContext { url: string; framePath: DomAddress[] }
export interface LocatorEvidence extends DomAddress {
  shadowPath: string[];
  basis: "test-id" | "id" | "semantic" | "relation" | "radio-group" | "unresolved";
  unique: boolean;
  reason?: string;
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
  entry?: EntryEvidence;
  row?: { locator: LocatorEvidence; key: string | null };
}
export interface EntryEvidence {
  kind: "open-entry" | "activate-tab" | "open-dropdown" | "open-confirmation";
  intent: "create" | "edit" | "view" | "expand" | "delete";
  allowed: boolean; reason: string;
  expected?: DomAddress;
}
export interface ConfirmationEntry { target: DomAddress; expected: DomAddress; framePath?: DomAddress[] }
export interface ExplorationOptions {
  maxDepth?: number; maxActions?: number; settleMs?: number;
  excludeNames?: string[]; excludeUrlIncludes?: string[];
  confirmationEntries?: ConfirmationEntry[];
}
export interface ExplorationHop {
  label: string; kind: EntryEvidence["kind"]; target: DomAddress;
  source: DocumentContext; pageUrl: string; expected?: DomAddress;
  destination?: { kind: "dialog" | "inline" | "navigation" | "popup" | "dropdown" | "tab"; url: string; frameUrl: string; scope: DomAddress[] };
}
export interface ExplorationResult {
  sceneId: string; path: ExplorationHop[]; depth: number;
  status: "explored" | "skipped" | "blocked" | "limited" | "failed" | "cancelled";
  reason?: string; snapshotId?: string;
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
  includeRegions?: boolean;
  confirmationEntries?: ConfirmationEntry[];
}
/** 一次文档扫描，frames 交由 Playwright 协调器进入。 */
export interface PageObservation {
  url: string; controls: ObservedControl[]; cells: ObservedCell[];
  dialogs: ObservedDialog[]; frames: LocatorEvidence[];
  warnings: string[]; truncated: boolean; unresolvedControls: number;
  pageLabels?: string[];
  regions?: { label: string; kind: string; locator: LocatorEvidence; context: DocumentContext; displayText: string }[];
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
  schemaVersion: 3; id: string; scenes: DiscoveryScene[];
  exploration?: ExplorationOptions;
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
  status: "scanned" | "unavailable" | "limited" | "excluded";
  reason?: string;
}
export interface DiscoverySnapshot extends Omit<PageObservation, "frames"> {
  id: string; sceneId: string; afterStep: number;
  documents: DocumentScan[]; associations: DialogAssociation[];
  path?: ExplorationHop[];
}
export interface SceneResult {
  id: string;
  status: "completed" | "blocked" | "failed" | "limited" | "cancelled";
  completedSteps: number; reason?: string;
}
export interface DiscoveryReport {
  schemaVersion: 3; artifactType: "page-discovery"; reportId: string;
  plan: DiscoveryPlan; startedAt: string; finishedAt: string;
  status: "completed" | "partial" | "cancelled";
  scope: "specified-scenes-and-openers" | "bounded-entry-exploration";
  snapshots: DiscoverySnapshot[]; scenes: SceneResult[]; limitations: string[];
  exploration?: { actions: number; results: ExplorationResult[] };
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
  schemaVersion: 3; artifactType: "unreviewed-configuration-draft";
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
  mapping: { schemaVersion: 3; reportId: string; fields: {
    id: string; sourceId: string; url: string; context: DocumentContext;
    locator: LocatorEvidence; observedIn: string[];
  }[] };
}
