import { env } from "@/env";
import { type ILLMCompletionOptions, type ILLMProvider, type IMessage } from "@/types/llm";
import { GoogleGenerativeAI } from "@google/generative-ai";

export class GeminiProvider implements ILLMProvider {
  public name = "Gemini";
  private genAI: GoogleGenerativeAI;
  private model: any;

  constructor() {
    this.genAI = new GoogleGenerativeAI(env.GEMINI_API_KEY);
    this.model = this.genAI.getGenerativeModel({
      model: "gemini-2.0-flash", // Default model
    });
  }

  async generateCompletion(
    messages: IMessage[],
    options?: ILLMCompletionOptions,
  ): Promise<string> {
    const geminiModel = options?.model
      ? this.genAI.getGenerativeModel({ model: options.model })
      : this.model;

    // Convert messages to Gemini format
    const prompt = messages.map(m => `${m.role.toUpperCase()}: ${m.content}`).join("\n\n");
    // Alternatively, use chat sessions, but for simple completion logic this works
    
    try {
      const result = await geminiModel.generateContent(prompt);
      const response = await result.response;
      return response.text();
    } catch (error: any) {
      console.error(`[Gemini] Error: ${error.message}`);
      throw new Error(`Gemini failed: ${error.message}`);
    }
  }

  async generateEmbedding(text: string): Promise<number[]> {
    const embeddingModel = this.genAI.getGenerativeModel({
      model: "text-embedding-004",
    });
    try {
      const result = await embeddingModel.embedContent(text);
      return result.embedding.values;
    } catch (error: any) {
      console.error(`[Gemini Embedding] Error: ${error.message}`);
      throw new Error(`Gemini embedding failed: ${error.message}`);
    }
  }
}

