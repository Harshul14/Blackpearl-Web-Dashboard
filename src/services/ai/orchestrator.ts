import { Langfuse } from "langfuse";
import { env } from "@/env";
import { type IMessage, type ILLMCompletionOptions } from "@/types/llm";
import { llmService } from "../llm.service";
import { z } from "zod";
import { SecurityService } from "./middleware/security";

export class OrchestratorService {
  private langfuse: Langfuse | null = null;

  constructor() {
    if (env.LANGFUSE_PUBLIC_KEY && env.LANGFUSE_SECRET_KEY) {
      this.langfuse = new Langfuse({
        publicKey: env.LANGFUSE_PUBLIC_KEY,
        secretKey: env.LANGFUSE_SECRET_KEY,
        baseUrl: env.LANGFUSE_BASE_URL || "https://cloud.langfuse.com",
      });
    }
  }

  /**
   * Generates a completion with full observability, retries, and optional structured validation.
   */
  async generateCompletion<T>(
    messages: IMessage[],
    options: ILLMCompletionOptions & { 
      name: string; // Operation name for Langfuse
      schema?: z.ZodSchema<T>; // Optional schema for validation
      userId?: string;
      metadata?: Record<string, any>;
      maxRepairAttempts?: number;
    }
  ): Promise<T | string> {
    const { name, schema, userId, metadata, maxRepairAttempts = 1, ...llmOptions } = options;

    const trace = this.langfuse?.trace({
      name,
      userId,
      metadata,
    });

    const scrubbedMessages = messages.map(m => ({
      ...m,
      content: SecurityService.scrub(m.content)
    }));

    const executeWithValidation = async (currentMessages: IMessage[], attempt: number): Promise<T | string> => {
      const span = trace?.span({
        name: `llm-generation-attempt-${attempt}`,
        input: currentMessages,
      });

      try {
        const result = await llmService.generateCompletion(currentMessages, {
          ...llmOptions,
          fallback: true,
        });

        if (schema) {
          try {
            const parsed = schema.parse(JSON.parse(result));
            span?.end({ output: parsed });
            return parsed;
          } catch (parseError: any) {
            span?.end({ output: result, level: "WARNING", metadata: { error: parseError.message } });
            
            if (attempt <= maxRepairAttempts) {
              console.warn(`[Orchestrator] Schema validation failed for ${name} (attempt ${attempt}). Retrying with repair prompt...`);
              const repairMessages: IMessage[] = [
                ...currentMessages,
                { role: "assistant", content: result },
                { 
                  role: "user", 
                  content: `Your previous response failed validation: ${parseError.message}. Please return the correct JSON structure.` 
                }
              ];
              return await executeWithValidation(repairMessages, attempt + 1);
            }
            throw new Error(`Invalid AI response structure after ${attempt} attempts: ${parseError.message}`);
          }
        }

        span?.end({ output: result });
        return result;
      } catch (error: any) {
        span?.end({ output: error.message, level: "ERROR" });
        throw error;
      }
    };

    try {
      const finalResult = await executeWithValidation(scrubbedMessages, 1);
      return finalResult;
    } finally {
      await this.langfuse?.flush();
    }
  }
}

export const orchestratorService = new OrchestratorService();
