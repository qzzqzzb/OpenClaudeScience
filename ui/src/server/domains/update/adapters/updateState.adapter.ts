import { getUpdateStatus } from "./updateInfrastructure.adapter";
import type { UpdateStatus } from "../update.types";

export async function readUpdateStatus(): Promise<UpdateStatus> {
  return getUpdateStatus();
}
