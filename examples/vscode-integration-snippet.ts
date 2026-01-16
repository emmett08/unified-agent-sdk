import * as vscode from 'vscode';
import { UnifiedAgentSDK, AllowAllToolsPolicy } from 'unified-agent-sdk';
import { createVSCodeWorkspace } from 'unified-agent-sdk/workspaces/vscode';

export async function runAgentCommand() {
  const sdk = new UnifiedAgentSDK({
    providers: {
      aiSdk: { openaiApiKey: process.env.OPENAI_API_KEY },
      ollama: { host: 'http://127.0.0.1:11434' },
    },
  });

  const folder = vscode.workspace.workspaceFolders?.[0];
  if (!folder) throw new Error('Open a folder first');

  const ws = createVSCodeWorkspace(vscode, folder.uri, true);

  const run = sdk.run({
    prompt: 'Make a small change to README.md (add a heading). Use patches.',
    workspace: ws,
    workspaceMode: 'live',
    routing: { modelClass: 'fast' },
    policy: new AllowAllToolsPolicy(),
  });

  for await (const ev of run.events) {
    if (ev.type === 'file_change') {
      // You can refresh explorer / open diff / etc.
      console.log(ev.change);
    }
  }

  await run.result;
}
