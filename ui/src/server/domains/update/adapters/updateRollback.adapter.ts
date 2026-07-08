import { rollbackUpdate } from "@/app/api/update/_lib/update";
import type { UpdateStatus } from "../update.types";

export async function rollbackUpdateInstall(): Promise<UpdateStatus> {
  return rollbackUpdate();
}
