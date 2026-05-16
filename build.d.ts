import type { BuildRuntime } from "./webview/shared/b3build-model";
export type { NodeDef } from "behavior3";
export type { NodeData, TreeData } from "./webview/shared/b3type";
export type {
  BatchDecorator,
  BatchHook,
  BatchHookClass,
  BatchScript,
  BuildEnv,
  CheckDecorator,
  BuildDecorator,
  BuildHook,
  BuildHookClass,
  BuildLogger,
  BuildRuntime,
  BuildScript,
  FsLike,
  Hook,
  NodeArg,
  NodeArgCheckContext,
  NodeArgChecker,
  NodeArgCheckerClass,
  NodeArgCheckResult,
  PathLike,
} from "./webview/shared/b3build-model";

declare global {
  const behavior3: BuildRuntime;
}
