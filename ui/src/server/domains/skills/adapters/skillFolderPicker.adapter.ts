import {
  chooseLocalFolder,
  isUserCancelled,
} from "@/app/api/_lib/local-folder-picker";

export { isUserCancelled };

export async function chooseLocalSkillFolder(): Promise<string | null> {
  return chooseLocalFolder("选择本地技能文件夹");
}
