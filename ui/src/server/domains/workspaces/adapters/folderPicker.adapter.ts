import {
  chooseLocalFolder,
  isUserCancelled,
} from "@/server/shared/adapters/localFolderPicker.adapter";

export { isUserCancelled };

export async function chooseWorkspaceFolder(
  title: string
): Promise<string | null> {
  return chooseLocalFolder(title);
}
