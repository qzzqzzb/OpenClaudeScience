import { getUpdateStatus } from "@/app/api/update/_lib/update";
import type { UpdateStatus } from "../update.types";

export async function readUpdateStatus(): Promise<UpdateStatus> {
  return getUpdateStatus();
}
