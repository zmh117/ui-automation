import type { ConfigurationCase } from "@mes-ui/config-enumerator";
export function selectCandidates<T extends ConfigurationCase>(candidates: T[]): T[];
export function readSmokeSelection(path?: string): any;
export function smokeOverview(selection: any): any;
export function verifyExecutionSelection(selection: any, cases: any[], filtered: boolean): void;
