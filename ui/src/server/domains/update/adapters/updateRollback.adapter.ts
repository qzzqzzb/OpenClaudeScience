import { rollbackUpdate } from "./updateInfrastructure.adapter";
import type { UpdateStatus } from "../update.types";

export async function rollbackUpdateInstall(): Promise<UpdateStatus> {
  return rollbackUpdate();
}
