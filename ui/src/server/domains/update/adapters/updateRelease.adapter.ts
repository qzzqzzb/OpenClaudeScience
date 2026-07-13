import { checkForUpdate } from "./updateInfrastructure.adapter";
import type { UpdateStatus } from "../update.types";

export async function checkUpdateRelease(): Promise<UpdateStatus> {
  return checkForUpdate();
}
