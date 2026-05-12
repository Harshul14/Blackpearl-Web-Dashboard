export type MessageRole = "user" | "assistant" | "system";

export interface IMessage {
  role: MessageRole;
  content: string;
}

export interface ILLMCompletionOptions {
  temperature?: number;
  maxTokens?: number;
  topP?: number;
  stop?: string[];
  model?: string;
}

export interface ILLMProvider {
  name: string;
  generateCompletion(messages: IMessage[], options?: ILLMCompletionOptions): Promise<string>;
  generateEmbedding?(text: string): Promise<number[]>;
}

export interface ISummarizeCommitOptions {
  diff: string;
}

export interface ISummarizeCodeOptions {
  filename: string;
  code: string;
}

