import { env } from "@/env";
import { type ILLMCompletionOptions, type ILLMProvider, type IMessage } from "@/types/llm";
import axios from "axios";

export class OpenRouterProvider implements ILLMProvider {
  public name = "OpenRouter";
  private apiKey: string;
  private defaultModel: string;

  constructor() {
    this.apiKey = env.OPENROUTER_API_KEY;
    this.defaultModel = env.OPENROUTER_MODEL;
  }

  async generateCompletion(
    messages: IMessage[],
    options?: ILLMCompletionOptions,
  ): Promise<string> {
    try {
      const response = await axios.post(
        "https://openrouter.ai/api/v1/chat/completions",
        {
          model: options?.model || this.defaultModel,
          messages: messages,
          temperature: options?.temperature ?? 0.7,
          max_tokens: options?.maxTokens,
          top_p: options?.topP,
          stop: options?.stop,
        },
        {
          headers: {
            Authorization: `Bearer ${this.apiKey}`,
            "Content-Type": "application/json",
            "HTTP-Referer": env.NEXT_PUBLIC_APP_URL, // Optional, for OpenRouter tracking
            "X-Title": "BlackPearl", // Optional, for OpenRouter tracking
          },
          timeout: 30000, // 30s timeout
        },
      );

      return response.data.choices[0].message.content;
    } catch (error: any) {
      const errorMessage = error.response?.data?.error?.message || error.message;
      console.error(`[OpenRouter] Error: ${errorMessage}`);
      throw new Error(`OpenRouter failed: ${errorMessage}`);
    }
  }
}

