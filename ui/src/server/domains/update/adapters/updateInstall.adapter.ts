import { applyUpdate } from "./updateInfrastructure.adapter";
import type { UpdateStatus } from "../update.types";

export async function applyUpdateInstall(): Promise<UpdateStatus> {
  return applyUpdate();
}
