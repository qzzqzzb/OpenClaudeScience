import path from "path";

export interface WorkspaceRootAdapter {
  getWorkspaceRoot(): string;
}

export const workspaceRootAdapter: WorkspaceRootAdapter = {
  getWorkspaceRoot() {
    return path.resolve(
      process.env.INTERNAGENTS_APP_ROOT ||
        process.env.INTERNAGENTS_WORKSPACE_ROOT ||
        process.env.WORKSPACE_ROOT ||
        path.join(process.cwd(), "..")
    );
  },
};

export function getWorkspaceRoot(): string {
  return workspaceRootAdapter.getWorkspaceRoot();
}
