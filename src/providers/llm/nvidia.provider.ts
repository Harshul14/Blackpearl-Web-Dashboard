import { env } from "@/env";
import { type ILLMCompletionOptions, type ILLMProvider, type IMessage } from "@/types/llm";
import axios from "axios";

export class NvidiaProvider implements ILLMProvider {
  public name = "NVIDIA";
  private apiKey: string;
  private defaultModel: string;

  constructor() {
    this.apiKey = env.NVIDIA_API_KEY!;
    this.defaultModel = env.NVIDIA_MODEL || "qwen/qwen2.5-72b-instruct";
  }

  async generateCompletion(
    messages: IMessage[],
    options?: ILLMCompletionOptions,
  ): Promise<string> {
    try {
      const model = options?.model || this.defaultModel;
      const payload = {
        model: model,
        messages: messages,
        temperature: options?.temperature ?? 0.60,
        max_tokens: options?.maxTokens || 16384,
        top_p: options?.topP || 0.95,
        stream: false,
        // chat_template_kwargs: { enable_thinking: false },
      };

      console.log(`[NVIDIA] [DEBUG] Sending completion request...`);
      console.log(`[NVIDIA] [DEBUG] Model: ${model}`);
      
      const startTime = Date.now();
      const response = await axios.post(
        "https://integrate.api.nvidia.com/v1/chat/completions",
        payload,
        {
          headers: {
            Authorization: `Bearer ${this.apiKey}`,
            "Content-Type": "application/json",
            Accept: "application/json",
          },
          timeout: 6000000, // 60s timeout is more reasonable than 100m
        },
      );
      const duration = Date.now() - startTime;

      console.log(`[NVIDIA] [DEBUG] Completion received in ${duration}ms`);
      return response.data.choices[0].message.content;
    } catch (error: any) {
      console.error(`[NVIDIA] [ERROR] Completion failed: ${error.message}`);
      if (error.response) {
        console.error(`[NVIDIA] [ERROR] Details: ${JSON.stringify(error.response.data)}`);
      }
      
      const errorMessage = error.response?.data?.error?.message || error.message;
      throw new Error(`NVIDIA failed: ${errorMessage}`);
    }
  }

  async generateEmbedding(text: string): Promise<number[]> {
    const model = env.NVIDIA_EMBEDDING_MODEL || "nvidia/nv-embedqa-mistral-7b-v2";
    try {
      console.log(`[NVIDIA] [DEBUG] Sending embedding request...`);
      console.log(`[NVIDIA] [DEBUG] Model: ${model}`);

      const startTime = Date.now();
      const response = await axios.post(
        "https://integrate.api.nvidia.com/v1/embeddings",
        {
          model: model,
          input: [text],
          encoding_format: "float",
          input_type: "query",
        },
        {
          headers: {
            Authorization: `Bearer ${this.apiKey}`,
            "Content-Type": "application/json",
            Accept: "application/json",
          },
          timeout: 60000, // 60s timeout
        }
      );
      const duration = Date.now() - startTime;

      console.log(`[NVIDIA] [DEBUG] Embedding received in ${duration}ms`);
      return response.data.data[0].embedding;
    } catch (error: any) {
      console.error(`[NVIDIA] [ERROR] Embedding failed: ${error.message}`);
      if (error.response) {
        console.error(`[NVIDIA] [ERROR] Details: ${JSON.stringify(error.response.data)}`);
      }
      const errorMessage = error.response?.data?.error?.message || error.message;
      throw new Error(`NVIDIA embedding failed: ${errorMessage}`);
    }
  }
}
