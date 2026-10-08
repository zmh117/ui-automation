import type { ConfigurationModel, JsonValue, Rule } from "../types.js";

export interface LocatorEvidence {
  selector: string;
  basis: "test-id" | "id" | "radio-group" | "structure";
  /** 唯一只对本次 DOM 成立，不承诺以后页面结构不变。 */
  unique: boolean;
}
export interface ObservedOption {
  label: string;
  value: JsonValue;
  valueKnown: boolean;
  disabled: boolean;
  selected: boolean;
}
export interface ObservedControl {
  key: string;
  category: "field" | "action";
  kind: string;
  label: string;
  locator: LocatorEvidence;
  currentValue: JsonValue;
  valueKnown: boolean;
  disabled: boolean;
  readOnly: boolean;
  required: boolean;
  /** null 表示 DOM 尚未公开单选/多选语义。 */
  multiple: boolean | null;
  attributes: Record<string, string>;
  options: ObservedOption[];
  notes: string[];
  dialog: string | null;
}
export interface ScanOptions {
  maxControls: number;
  maxOptions: number;
  maxTextLength: number;
  scopeSelector: string;
  dropdownSelector?: string;
  popupSelector?: string;
}
export interface PageObservation {
  url: string;
  controls: ObservedControl[];
  visibleDialogs: string[];
  warnings: string[];
  truncated: boolean;
}
export interface DiscoveryStep {
  kind: "open-dropdown" | "activate-tab" | "open-dialog";
  selector: string;
  expectSelector: string;
}
export interface DiscoveryScene {
  id: string;
  url: string;
  readySelector: string;
  scopeSelector?: string;
  steps: DiscoveryStep[];
}
export interface DiscoveryPlan {
  id: string;
  scenes: DiscoveryScene[];
  limits?: {
    maxSnapshots?: number;
    maxControls?: number;
    maxOptions?: number;
    maxTextLength?: number;
    timeoutMs?: number;
  };
}
export interface DiscoverySnapshot extends PageObservation {
  id: string;
  sceneId: string;
  afterStep: number;
}
export interface SceneResult {
  id: string;
  status: "completed" | "blocked" | "failed" | "limited" | "cancelled";
  completedSteps: number;
  reason?: string;
}
export interface DiscoveryReport {
  schemaVersion: 1;
  artifactType: "page-discovery";
  reportId: string;
  plan: DiscoveryPlan;
  startedAt: string;
  finishedAt: string;
  status: "completed" | "partial" | "cancelled";
  scope: "specified-scenes-and-openers";
  snapshots: DiscoverySnapshot[];
  scenes: SceneResult[];
  limitations: string[];
}
export interface DraftField {
  sourceId: string;
  suggestedId: string;
  label: string;
  kind: string;
  url: string;
  locator: LocatorEvidence;
  observedIn: string[];
  suggestedValues: JsonValue[];
  observedOptions: ObservedOption[];
  observations: { snapshotId: string; currentValue: JsonValue; valueKnown: boolean; multiple: boolean | null; disabled: boolean; readOnly: boolean; required: boolean; attributes: Record<string, string> }[];
  needsReview: string[];
}
export interface DiscoveryDraft {
  schemaVersion: 1;
  artifactType: "unreviewed-configuration-draft";
  reportId: string;
  status: "needs-review";
  fields: DraftField[];
  businessRules: "not-inferred";
}
export interface ReviewInput {
  reportId: string;
  confirmed: { scope: boolean; domains: boolean; businessRules: boolean };
  modelId: string;
  version: string;
  fields: { sourceId: string; include: boolean; id: string; values: JsonValue[] }[];
  rules: Rule[];
}
export interface ReviewedModel {
  model: ConfigurationModel;
  mapping: { reportId: string; fields: { id: string; sourceId: string; url: string; locator: LocatorEvidence; observedIn: string[] }[] };
}
