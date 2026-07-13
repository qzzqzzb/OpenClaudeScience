import {
  chooseLocalFolder,
  isUserCancelled,
} from "@/server/shared/adapters/localFolderPicker.adapter";

export { isUserCancelled };

export async function chooseLocalSkillFolder(): Promise<string | null> {
  return chooseLocalFolder("选择本地技能文件夹");
}
