import { VSCodeWorkspace, type VSCodeWorkspaceOptions } from './vscode-workspace.js';

export { VSCodeWorkspace, type VSCodeWorkspaceOptions };

/**
 * Convenience factory to avoid direct dependency on VS Code types.
 * Pass the `vscode` module object and the workspace root `Uri`.
 */
export function createVSCodeWorkspace(vscode: any, workspaceRoot: any, preferWorkspaceEdit = true): VSCodeWorkspace {
  return new VSCodeWorkspace({ vscode, workspaceRoot, preferWorkspaceEdit });
}
