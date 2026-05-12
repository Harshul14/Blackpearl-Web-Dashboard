import { type ILLMCompletionOptions, type ILLMProvider, type IMessage } from "@/types/llm";
import { OpenRouterProvider } from "@/providers/llm/openrouter.provider";
import { GeminiProvider } from "@/providers/llm/gemini.provider";
import { NvidiaProvider } from "@/providers/llm/nvidia.provider";
import { env } from "@/env";

export class LLMService {
  private providers: ILLMProvider[] = [];

  constructor() {
    // Initialize providers in exact order of priority, respecting feature flags
    
    // 1. Google API models
    if (env.ENABLE_GEMINI && env.GEMINI_API_KEY) {
      this.providers.push(new GeminiProvider());
    }
    
    // 2. OpenRouter models
    if (env.ENABLE_OPENROUTER && env.OPENROUTER_API_KEY) {
      this.providers.push(new OpenRouterProvider());
    }
    
    // 3. NVIDIA AI models
    if (env.ENABLE_NVIDIA && env.NVIDIA_API_KEY) {
      this.providers.push(new NvidiaProvider());
    }
  }

  /**
   * Generates a completion using providers in priority order.
   * Order: Google -> OpenRouter -> NVIDIA.
   */
  async generateCompletion(
    messages: IMessage[],
    options?: ILLMCompletionOptions & { fallback?: boolean; maxRetries?: number },
  ): Promise<string> {
    const { fallback = false, maxRetries = 3, ...llmOptions } = options || {};
    let lastError: Error | null = null;

    if (this.providers.length === 0) {
      throw new Error("No LLM providers are configured. Please check your environment variables.");
    }

    // Try providers in priority order
    for (let i = 0; i < this.providers.length; i++) {
      const provider = this.providers[i];
      const providerDisplayName = provider.name === "Gemini" ? "Google" : provider.name;

      // If fallback is disabled, only attempt the first available provider
      if (!fallback && i > 0) break;

      try {
        if (i === 0) {
          console.log(`Trying ${providerDisplayName} provider...`);
        } else {
          const prevProvider = this.providers[i - 1];
          const prevProviderDisplayName = prevProvider.name === "Gemini" ? "Google" : prevProvider.name;
          console.log(`${prevProviderDisplayName} failed, falling back to ${providerDisplayName}...`);
        }

        const result = await this.attemptProvider(provider, messages, maxRetries, llmOptions);
        
        // Ensure failure triggers next provider if output is unusable
        if (!result || result.trim().length === 0) {
          throw new Error(`${providerDisplayName} returned no usable output.`);
        }

        return result;
      } catch (error: any) {
        lastError = error;
        console.warn(`[LLMService] ${providerDisplayName} attempt failed: ${error.message}`);
        
        // If fallback is disabled, don't try next providers
        if (!fallback) break;
        
        // Continue to next provider in the list
      }
    }

    if (fallback && this.providers.length > 0) {
      console.error("All providers failed");
    }

    throw lastError || new Error("Failed to generate completion: No available providers.");
  }

  /**
   * Helper method to attempt a provider with retries and backoff.
   */
  private async attemptProvider(
    provider: ILLMProvider,
    messages: IMessage[],
    maxRetries: number,
    options: ILLMCompletionOptions
  ): Promise<string> {
    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        return await provider.generateCompletion(messages, options);
      } catch (error: any) {
        // Only retry if we haven't exhausted attempts for this specific provider
        if (attempt < maxRetries) {
          console.warn(`[LLMService] ${provider.name} failed (attempt ${attempt}): ${error.message}. Retrying...`);
          let delay = Math.pow(2, attempt) * 1000; // Exponential backoff
          
          if (error.message.toLowerCase().includes("rate limit")) {
            delay = Math.pow(3, attempt) * 2000; // More aggressive backoff for rate limits
          }
          
          await new Promise((res) => setTimeout(res, delay));
        } else {
          throw error;
        }
      }
    }
    throw new Error(`${provider.name} failed after ${maxRetries} attempts`);
  }

  /**
   * Generates embeddings using the first available provider that supports them (typically Gemini).
   */
  async generateEmbedding(text: string): Promise<number[]> {
    let lastError: Error | null = null;
    
    for (const provider of this.providers) {
      if (provider?.generateEmbedding) {
        try {
          return await provider.generateEmbedding(text);
        } catch (error: any) {
          lastError = error;
          console.warn(`[LLMService] Embedding generation failed for ${provider.name}, trying next fallback... Error: ${error.message}`);
          // Continue to next provider
        }
      }
    }
    
    throw lastError || new Error("Embedding generation not supported by any configured providers or all attempts failed.");
  }

  /**
   * Generates a streaming completion.
   */
  async *generateStreamingCompletion(
    messages: IMessage[],
    options?: ILLMCompletionOptions & { fallback?: boolean }
  ): AsyncGenerator<string> {
    const { fallback = true, ...llmOptions } = options || {};
    
    for (let i = 0; i < this.providers.length; i++) {
      const provider = this.providers[i];
      if (!fallback && i > 0) break;

      try {
        if (typeof (provider as any).generateStreaming === "function") {
          yield* (provider as any).generateStreaming(messages, llmOptions);
          return; // Success, exit generator
        } else {
          // Fallback to full response if streaming not implemented for this provider
          const result = await this.generateCompletion(messages, { ...options, fallback: false });
          yield result;
          return;
        }
      } catch (error: any) {
        console.warn(`[LLMService] Streaming failed for ${provider.name}: ${error.message}`);
        if (!fallback) throw error;
        // Continue loop for fallback
      }
    }
    
    throw new Error("All providers failed to generate streaming completion.");
  }
}

export const llmService = new LLMService();

