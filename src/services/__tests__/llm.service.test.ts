import { describe, it, expect, vi, beforeEach } from "vitest";
import { LLMService } from "@/services/llm.service";
import { OpenRouterProvider } from "@/providers/llm/openrouter.provider";
import { GeminiProvider } from "@/providers/llm/gemini.provider";
import { NvidiaProvider } from "@/providers/llm/nvidia.provider";

// Mock env
vi.mock("@/env", () => ({
  env: {
    GEMINI_API_KEY: "test-gemini-key",
    OPENROUTER_API_KEY: "test-openrouter-key",
    NVIDIA_API_KEY: "test-nvidia-key",
    OPENROUTER_MODEL: "test-model",
    NVIDIA_MODEL: "test-nvidia-model",
  },
}));

// Mock the providers
vi.mock("@/providers/llm/openrouter.provider", () => ({
  OpenRouterProvider: vi.fn().mockImplementation(function() {
    return {
      name: "OpenRouter",
      generateCompletion: vi.fn(),
    };
  }),
}));

vi.mock("@/providers/llm/gemini.provider", () => ({
  GeminiProvider: vi.fn().mockImplementation(function() {
    return {
      name: "Gemini",
      generateCompletion: vi.fn(),
      generateEmbedding: vi.fn(),
    };
  }),
}));

vi.mock("@/providers/llm/nvidia.provider", () => ({
  NvidiaProvider: vi.fn().mockImplementation(function() {
    return {
      name: "NVIDIA",
      generateCompletion: vi.fn(),
    };
  }),
}));

describe("LLMService", () => {
  let llmService: LLMService;
  let mockOpenRouter: any;
  let mockGemini: any;
  let mockNvidia: any;

  beforeEach(() => {
    vi.clearAllMocks();
    llmService = new LLMService();
    
    // Providers are instantiated in the constructor
    mockGemini = vi.mocked(GeminiProvider).mock.results[0].value;
    mockOpenRouter = vi.mocked(OpenRouterProvider).mock.results[0].value;
    mockNvidia = vi.mocked(NvidiaProvider).mock.results[0].value;
  });

  it("should be defined", () => {
    expect(llmService).toBeDefined();
  });

  it("should use primary provider (Gemini/Google) successfully", async () => {
    mockGemini.generateCompletion.mockResolvedValue("Success from Gemini");

    const result = await llmService.generateCompletion([{ role: "user", content: "hi" }]);

    expect(result).toBe("Success from Gemini");
    expect(mockGemini.generateCompletion).toHaveBeenCalledTimes(1);
    expect(mockOpenRouter.generateCompletion).not.toHaveBeenCalled();
    expect(mockNvidia.generateCompletion).not.toHaveBeenCalled();
  });

  it("should fallback to OpenRouter if Gemini fails", async () => {
    mockGemini.generateCompletion.mockRejectedValue(new Error("Gemini failed"));
    mockOpenRouter.generateCompletion.mockResolvedValue("Success from OpenRouter fallback");

    const result = await llmService.generateCompletion([{ role: "user", content: "hi" }], { fallback: true, maxRetries: 1 });

    expect(result).toBe("Success from OpenRouter fallback");
    expect(mockGemini.generateCompletion).toHaveBeenCalledTimes(1);
    expect(mockOpenRouter.generateCompletion).toHaveBeenCalledTimes(1);
    expect(mockNvidia.generateCompletion).not.toHaveBeenCalled();
  });

  it("should fallback to NVIDIA if both Gemini and OpenRouter fail", async () => {
    mockGemini.generateCompletion.mockRejectedValue(new Error("Gemini failed"));
    mockOpenRouter.generateCompletion.mockRejectedValue(new Error("OpenRouter failed"));
    mockNvidia.generateCompletion.mockResolvedValue("Success from NVIDIA fallback");

    const result = await llmService.generateCompletion([{ role: "user", content: "hi" }], { fallback: true, maxRetries: 1 });

    expect(result).toBe("Success from NVIDIA fallback");
    expect(mockGemini.generateCompletion).toHaveBeenCalledTimes(1);
    expect(mockOpenRouter.generateCompletion).toHaveBeenCalledTimes(1);
    expect(mockNvidia.generateCompletion).toHaveBeenCalledTimes(1);
  });

  it("should throw error if all providers fail", async () => {
    mockGemini.generateCompletion.mockRejectedValue(new Error("Gemini failed"));
    mockOpenRouter.generateCompletion.mockRejectedValue(new Error("OpenRouter failed"));
    mockNvidia.generateCompletion.mockRejectedValue(new Error("NVIDIA failed"));

    await expect(llmService.generateCompletion([{ role: "user", content: "hi" }], { fallback: true, maxRetries: 1 }))
      .rejects.toThrow("NVIDIA failed");
  });

  it("should trigger fallback on empty response", async () => {
    mockGemini.generateCompletion.mockResolvedValue("   "); // Empty response
    mockOpenRouter.generateCompletion.mockResolvedValue("Success from OpenRouter after empty Gemini");

    const result = await llmService.generateCompletion([{ role: "user", content: "hi" }], { fallback: true, maxRetries: 1 });

    expect(result).toBe("Success from OpenRouter after empty Gemini");
    expect(mockGemini.generateCompletion).toHaveBeenCalledTimes(1);
    expect(mockOpenRouter.generateCompletion).toHaveBeenCalledTimes(1);
  });
});
