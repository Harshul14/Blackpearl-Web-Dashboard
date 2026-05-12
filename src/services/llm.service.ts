import { type ILLMCompletionOptions, type ILLMProvider, type IMessage } from "@/types/llm";
import { OpenRouterProvider } from "@/providers/llm/openrouter.provider";
import { GeminiProvider } from "@/providers/llm/gemini.provider";
import { NvidiaProvider } from "@/providers/llm/nvidia.provider";
import { env } from "@/env";

export class LLMService {
  private providers: ILLMProvider[] = [];

  constructor() {
    // Initialize providers in exact order of priority
    // 1. Google API models first
    if (env.GEMINI_API_KEY) {
      this.providers.push(new GeminiProvider());
    }
    
    // 2. OpenRouter models second
    if (env.OPENROUTER_API_KEY) {
      this.providers.push(new OpenRouterProvider());
    }
    
    // 3. NVIDIA AI models third
    if (env.NVIDIA_API_KEY) {
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
    for (const provider of this.providers) {
      if (provider?.generateEmbedding) {
        try {
          return await provider.generateEmbedding(text);
        } catch (error) {
          console.warn(`[LLMService] Embedding generation failed for ${provider.name}, trying next...`);
        }
      }
    }
    throw new Error("Embedding generation not supported by current providers or all attempts failed");
  }
}

export const llmService = new LLMService();

