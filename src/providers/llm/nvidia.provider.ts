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
        chat_template_kwargs: { enable_thinking: false },
      };

      console.log(`[NVIDIA] [DEBUG] Sending request to NVIDIA...`);
      console.log(`[NVIDIA] [DEBUG] API URL: https://integrate.api.nvidia.com/v1/chat/completions`);
      console.log(`[NVIDIA] [DEBUG] Model: ${model}`);
      console.log(`[NVIDIA] [DEBUG] Payload: ${JSON.stringify(payload, null, 2)}`);
      console.log(`[NVIDIA] [DEBUG] Headers mask: { Authorization: 'Bearer nvapi-***', Accept: 'application/json' }`);

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
          timeout: 6000000, 
        },
      );
      const duration = Date.now() - startTime;

      console.log(`[NVIDIA] [DEBUG] Response received in ${duration}ms`);
      console.log(`[NVIDIA] [DEBUG] Status: ${response.status} ${response.statusText}`);
      // console.log(`[NVIDIA] [DEBUG] Response Data: ${JSON.stringify(response.data, null, 2)}`);

      return response.data.choices[0].message.content;
    } catch (error: any) {
      const duration = Date.now() - (error.config?.startTime || 0);
      console.error(`[NVIDIA] [ERROR] Request failed!`);
      if (error.response) {
        console.error(`[NVIDIA] [ERROR] Status: ${error.response.status}`);
        console.error(`[NVIDIA] [ERROR] Data: ${JSON.stringify(error.response.data, null, 2)}`);
      } else {
        console.error(`[NVIDIA] [ERROR] Message: ${error.message}`);
      }
      
      const errorMessage = error.response?.data?.error?.message || error.message;
      throw new Error(`NVIDIA failed: ${errorMessage}`);
    }
  }
}
