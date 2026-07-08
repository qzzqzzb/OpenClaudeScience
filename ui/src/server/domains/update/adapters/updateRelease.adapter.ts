import { checkForUpdate } from "@/app/api/update/_lib/update";
import type { UpdateStatus } from "../update.types";

export async function checkUpdateRelease(): Promise<UpdateStatus> {
  return checkForUpdate();
}
