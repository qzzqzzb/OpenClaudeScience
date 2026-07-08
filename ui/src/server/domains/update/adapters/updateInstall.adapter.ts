import { applyUpdate } from "@/app/api/update/_lib/update";
import type { UpdateStatus } from "../update.types";

export async function applyUpdateInstall(): Promise<UpdateStatus> {
  return applyUpdate();
}
