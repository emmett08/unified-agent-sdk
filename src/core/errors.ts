export class UnifiedAgentError extends Error {
  constructor(message: string, cause?: unknown) {
    super(message, cause ? { cause } : undefined);
    this.name = 'UnifiedAgentError';
  }
}

export class ProviderUnavailableError extends UnifiedAgentError {
  constructor(provider: string, detail?: string) {
    super(`Provider unavailable: ${provider}${detail ? ` (${detail})` : ''}`);
    this.name = 'ProviderUnavailableError';
  }
}

export class ToolDeniedError extends UnifiedAgentError {
  constructor(toolName: string, reason: string) {
    super(`Tool denied: ${toolName} (${reason})`);
    this.name = 'ToolDeniedError';
  }
}

export class ToolCancelledError extends UnifiedAgentError {
  constructor(toolName: string) {
    super(`Tool cancelled: ${toolName}`);
    this.name = 'ToolCancelledError';
  }
}
