import {
  chooseLocalFolder,
  isUserCancelled,
} from "@/app/api/_lib/local-folder-picker";

export { isUserCancelled };

export async function chooseWorkspaceFolder(
  title: string
): Promise<string | null> {
  return chooseLocalFolder(title);
}
