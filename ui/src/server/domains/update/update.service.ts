import { applyUpdateInstall } from "./adapters/updateInstall.adapter";
import { rollbackUpdateInstall } from "./adapters/updateRollback.adapter";
import { checkUpdateRelease } from "./adapters/updateRelease.adapter";
import { readUpdateStatus } from "./adapters/updateState.adapter";
import type { UpdateStatus } from "./update.types";

export async function getCurrentUpdateStatus(): Promise<UpdateStatus> {
  return readUpdateStatus();
}

export async function checkForAvailableUpdate(): Promise<UpdateStatus> {
  return checkUpdateRelease();
}

export async function applyAvailableUpdate(): Promise<UpdateStatus> {
  return applyUpdateInstall();
}

export async function rollbackCurrentUpdate(): Promise<UpdateStatus> {
  return rollbackUpdateInstall();
}
