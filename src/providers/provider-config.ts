export interface AuggieProviderConfig {
  apiKey?: string;
  apiUrl?: string;
  workspaceRoot?: string;
  allowIndexing?: boolean;
  auggiePath?: string;
  rules?: string[]; // paths
  cliArgs?: string[];
}

export interface AiSdkProviderConfig {
  openaiApiKey?: string;
  openaiBaseUrl?: string;
  anthropicApiKey?: string;
  anthropicBaseUrl?: string;
  gatewayApiKey?: string;
  gatewayBaseUrl?: string;
  gatewayHeaders?: Record<string, string>;
  /** AI SDK middleware stack (e.g. extractReasoningMiddleware). */
  middleware?: any[];
  /** Optional tagName for extractReasoningMiddleware convenience. */
  reasoningTagName?: string;
}

export interface OllamaProviderConfig {
  host?: string;
  headers?: Record<string, string>;
  /** Use browser build `ollama/browser` (for web contexts). */
  browser?: boolean;
}
