import { Request, Response } from "express";
import dns from "dns";
import { aiQueue, aiQueueEvents } from "../queue/aiQueue";
import { feedbackService } from "../services/FeedbackService";
import { messageService } from "../services/MessageService";
import { promptService } from "../services/PromptService";
import { editWrapper } from "../utils/editWrapper";
import config from "../../config.json";
import { logger } from "shared-service";
import { isOpenAIModel } from "../utils/openRouterModels";
import { mongooseConnection } from "../config/database";
import {
  RESPONSE_FORMAT_EDITS,
  RESPONSE_FORMAT_FULL,
} from "../utils/responseFormats";
import { config as envConfig } from "../config/env";
import { benchmarkingService } from "../services/BenchmarkingService";
import { accessControlService } from "../services/AccessControlService";

type GrammarEdit = {
  originalWord: string;
  correctedWord: string;
  errorType: "spelling" | "grammar" | "punctuation" | "other";
};

import { ProviderFactory } from "../services/providers/ProviderFactory";
import { getIO } from "../socket";
import * as crypto from "crypto";
import axios from "axios";
import {
  chunkJsonlByTokens,
  sanitizePromptForFilters,
  attemptRepairJson,
  mergeFilters,
} from "../utils/aiUtils";
export class AIController {
  private async getUser(userId: string) {
    const PHOENIX_USER_COLLECTION = process.env.COLLECTION_PHOENIX_USER;
    return await mongooseConnection.db
      .collection(PHOENIX_USER_COLLECTION)
      .findOne({ phoenixUserId: userId });
  }

  private async processServerRes(
    msgWithPrompt: string,
    req: Request,
    res: Response,
    extraContext: any = {},
    useSyncMode: boolean = false,
  ) {
    const {
      userId,
      chatId,
      state,
      tabId,
      aiModel,
      isMemoryEnabled,
      bypassCache,
      domain,
      platform: requestPlatform,
    } = req.body;

    const platform =
      (requestPlatform as string) ||
      this.getChatName(domain || "") ||
      "unknown";

    const learnedContext = await feedbackService.generateLearnedContext(
      userId,
      isMemoryEnabled === false ? "IDEA" : "TONE",
    );
    const negativeContext =
      isMemoryEnabled === false
        ? ""
        : await feedbackService.generateLearnedContext(userId, "NEGATIVE");

    const structureConstraint =
      "\nCRITICAL: DO NOT use JSON format. DO NOT return an array of objects. Focus ONLY on the TONE of the examples below, but use standard Markdown/Plain Text for the current task output. \n";
    const newTaskConstraint =
      "\n### NEW TASK:\nUsing the tone of the good examples above and avoiding the patterns from disliked examples, fulfill this request in standard Markdown (NOT JSON).\n";

    const finalPrompt =
      learnedContext || negativeContext
        ? `${learnedContext}${negativeContext}${newTaskConstraint}${structureConstraint}${msgWithPrompt}`
        : `${structureConstraint}\n${msgWithPrompt}`;

    const roomId = tabId || userId;
    const context = extraContext.context || [];
    const provider = ProviderFactory.getProvider(aiModel);

    if (!bypassCache) {
      const cachedResponse = await provider.getCachedResponse(
        finalPrompt,
        context,
        { model: aiModel },
      );
      if (cachedResponse) {
        logger.debug(
          `[AIController] Cache hit for request in room ${roomId}. Bypassing queue.`,
        );
        const io = getIO();
        io.to(roomId).emit(
          "AIresp",
          JSON.stringify({ resp: "", done: false, loading: "Thinking..." }),
          chatId,
          state,
        );
        io.to(roomId).emit(
          "AIresp",
          JSON.stringify({ resp: cachedResponse, done: false }),
          chatId,
          state,
        );
        io.to(roomId).emit(
          "AIresp",
          JSON.stringify({ resp: "", done: true }),
          chatId,
          state,
        );

        return res.status(200).json({
          status: "success",
          message: cachedResponse,
          cached: true,
        });
      } else {
        logger.debug(
          `[AIController] Cache miss for request in room ${roomId}. Proceeding to queue.`,
        );
      }
    } else {
      logger.debug(`[AIController] Cache bypass requested for room ${roomId}`);
    }
    if (useSyncMode) {
      try {
        logger.debug(
          `[AIController] Sync mode enabled - generating response directly`,
        );
        const primaryStart = Date.now();
        const response = await provider.generateResponse(finalPrompt, context, {
          model: aiModel,
          bypassCache,
        });
        const primaryLatencyMs = Date.now() - primaryStart;
        const requestId = `${crypto
          .createHash("sha256")
          .update(finalPrompt)
          .digest("hex")}-${Date.now()}`;
        benchmarkingService.run({
          requestId,
          userId,
          prompt: finalPrompt,
          primaryModel: aiModel,
          primaryResponse: response,
          primaryLatencyMs,
          platform: platform as any,
        });

        return res.status(200).json({
          status: "success",
          message: response,
          cached: false,
        });
      } catch (error: any) {
        logger.error(`[AIController] Sync generation error: ${error.message}`);
        return res.status(500).json({
          status: "error",
          message: error.message || "Model generation failed",
          uiMessage:
            "The selected AI model is currently unavailable. Please switch to another model and try again.",
        });
      }
    }

    const jobData = {
      prompt: finalPrompt,
      context: context,
      model: aiModel,
      userId,
      chatId,
      state,
      tabId,
      roomId,
      bypassCache: bypassCache || false,
      platform,
    };

    // const job = await aiQueue.add("generate-response", jobData);
    const jobHash = crypto
      .createHash("sha256")
      .update(finalPrompt)
      .digest("hex");
    const priority = tabId ? 1 : 10;
    const jobId = bypassCache ? `${jobHash}-${Date.now()}` : jobHash;
    const job = await aiQueue.add("generate-response", jobData, {
      jobId: jobId,
      priority: priority,
    });

    try {
      await job.waitUntilFinished(aiQueueEvents);
      return res.status(200).json({
        status: "queued",
        jobId: job.id,
        message: "Request queued for processing",
      });
    } catch (error: any) {
      return res.status(500).json({
        status: "error",
        jobId: job.id,
        message: error.message || "Model generation failed",
        uiMessage:
          "The selected AI model is currently unavailable. Please switch to another model and try again.",
      });
    }
  }

  nativeAI = async (req: Request, res: Response) => {
    try {
      await this.processServerRes(req.body.messages, req, res);
    } catch (error: any) {
      logger.error(`NativeAI Controller Error: ${error.message}`);
      res.status(500).json({ message: error.message });
    }
  };

  generateIdea = async (req: Request, res: Response) => {
    try {
      let conversation = req.body.message;
      const {
        userId,
        selectedIdea,
        isMemoryEnabled,
        isExternal,
        userFeedback,
      } = req.body;

      if (isExternal && isMemoryEnabled) {
        const msgResult: any = await messageService.getMessages(req);
        if (msgResult.error) {
          return res
            .status(msgResult.status)
            .json({ message: msgResult.message });
        }
        conversation = msgResult;
      }

      const user = await this.getUser(userId);
      const userName = user ? user.name : "unknown";

      const isFeedback = userFeedback && Object.keys(userFeedback).length > 0;
      const baseTemplate = config.ideaPrompt;
      let msgWithPrompt;

      if (isFeedback) {
        const { feedbackPrompt, previousResponse } = userFeedback;
        const wrapperResp = editWrapper(
          baseTemplate,
          previousResponse,
          feedbackPrompt,
        );
        msgWithPrompt = promptService.interpolate(wrapperResp, {
          selectedIdea,
          messages: isMemoryEnabled ? conversation : "",
          userName,
          todayDate: new Date().toDateString(),
        });
      } else {
        msgWithPrompt = promptService.interpolate(baseTemplate, {
          selectedIdea,
          messages: isMemoryEnabled ? conversation : "",
          userName,
          todayDate: new Date().toDateString(),
        });
      }

      await this.processServerRes(msgWithPrompt, req, res);
    } catch (error: any) {
      logger.error(`GenerateIdea Error: ${error.message}`);
      res.status(500).json({ message: error.message });
    }
  };

  lastMessagesReply = async (req: Request, res: Response) => {
    try {
      let conversation = req.body.message;
      if (
        req.body.isExternal &&
        (!conversation || conversation.trim() === "")
      ) {
        const msgResult: any = await messageService.getMessages(req);
        if (msgResult.error)
          return res
            .status(msgResult.status)
            .json({ message: msgResult.message });
        conversation = msgResult;
      }

      const { userId, role, userFeedback } = req.body;
      const user = await this.getUser(userId);
      const userName = user ? user.name : "unknown";

      const isFeedback = userFeedback && Object.keys(userFeedback).length > 0;
      const baseTemplate = config.msgReplyPrompt;
      let msgWithPrompt;

      if (isFeedback) {
        const { feedbackPrompt, previousResponse } = userFeedback;
        const wrapperResp = editWrapper(
          baseTemplate,
          previousResponse,
          feedbackPrompt,
        );
        msgWithPrompt = promptService.interpolate(wrapperResp, {
          role,
          messages: conversation,
          userName,
          todayDate: new Date().toDateString(),
        });
      } else {
        msgWithPrompt = promptService.interpolate(baseTemplate, {
          role,
          messages: conversation,
          userName,
          todayDate: new Date().toDateString(),
        });
      }

      await this.processServerRes(msgWithPrompt, req, res);
    } catch (error: any) {
      logger.error(`LastMessagesReply Error: ${error.message}`);
      res.status(500).json({ message: error.message });
    }
  };

  generateTodo = async (req: Request, res: Response) => {
    try {
      let conversation = req.body.message;
      if (req.body.isExternal) {
        const msgResult: any = await messageService.getMessages(req);
        if (msgResult.error)
          return res
            .status(msgResult.status)
            .json({ message: msgResult.message });
        conversation = msgResult;
      }

      const { userId, userFeedback } = req.body;
      const user = await this.getUser(userId);
      const userName = user ? user.name : "unknown";

      const isFeedback = userFeedback && Object.keys(userFeedback).length > 0;
      const baseTemplate = config.todoPrompt;
      let msgWithPrompt;

      if (isFeedback) {
        const { feedbackPrompt, previousResponse } = userFeedback;
        const wrapperResp = editWrapper(
          baseTemplate,
          previousResponse,
          feedbackPrompt,
        );
        msgWithPrompt = promptService.interpolate(wrapperResp, {
          messages: conversation,
          userName,
          todayDate: new Date().toDateString(),
        });
      } else {
        msgWithPrompt = promptService.interpolate(baseTemplate, {
          messages: conversation,
          userName,
          todayDate: new Date().toDateString(),
        });
      }
      await this.processServerRes(msgWithPrompt, req, res);
    } catch (error: any) {
      logger.error(`GenerateTodo Error: ${error.message}`);
      res.status(500).json({ message: error.message });
    }
  };

  createMeeting = async (req: Request, res: Response) => {
    try {
      let conversation = req.body.message;
      if (req.body.isExternal) {
        const msgResult: any = await messageService.getMessages(req);
        if (msgResult.error)
          return res
            .status(msgResult.status)
            .json({ message: msgResult.message });
        conversation = msgResult;
      }

      const { userId, userFeedback, aiModel, role } = req.body;
      const user = await this.getUser(userId);
      const userName = user ? user.name : "unknown";
      const isOpenRouter = isOpenAIModel(aiModel);

      const isFeedback = userFeedback && Object.keys(userFeedback).length > 0;
      const baseTemplate = config.meetingDetectionPrompt;
      let msgWithPrompt;

      if (isFeedback) {
        const { feedbackPrompt, previousResponse } = userFeedback;
        const wrapperResp = editWrapper(
          baseTemplate,
          previousResponse,
          feedbackPrompt,
        );

        msgWithPrompt = promptService.interpolate(wrapperResp, {
          role,
          messages: conversation,
          userName,
          todayDate: new Date().toDateString(),
        });
      } else {
        msgWithPrompt = promptService.interpolate(baseTemplate, {
          messages: conversation,
          userName,
          todayDate: new Date().toDateString(),
          ...(isOpenRouter && {
            tone: "Use advanced pattern recognition for meeting detection.",
          }),
        });
      }

      await this.processServerRes(msgWithPrompt, req, res);
    } catch (error: any) {
      logger.error(`CreateMeeting Error: ${error.message}`);
      res.status(500).json({ message: error.message });
    }
  };

  getChatSummary = async (req: Request, res: Response) => {
    try {
      const {
        chatId,
        userId,
        userRes,
        domain,
        platform: chatName,
        messages,
        tabId,
        aiModel,
        email,
        isExternal,
      } = req.body;

      const platform =
        chatName ||
        this.getChatName(Array.isArray(domain) ? domain[0] : domain);
      const isOpenRouter = isOpenAIModel(aiModel);
      const toneInstruction = this.getToneInstruction(
        Array.isArray(domain) ? domain[0] : domain,
        platform,
        isOpenRouter,
      );

      const enhancedUserRes = `${toneInstruction}\n\nUSER_INPUT:\n${userRes}\n\n`;

      let finalRes = "";

      if (platform !== "phoenix") {
        const msgResult: any = await messageService.getMessages(req);
        if (msgResult.error)
          return res
            .status(msgResult.status)
            .json({ message: msgResult.message });
        finalRes = enhancedUserRes + msgResult;
      } else {
        finalRes = enhancedUserRes + messages;
      }

      await this.processServerRes(finalRes, req, res, {}, false);
    } catch (error: any) {
      logger.error(`GetChatSummary Error: ${error.message}`);
      res.status(500).json({ message: error.message });
    }
  };

  private getChatName(domain: string) {
    const {
      DOMAIN_SLACK,
      DOMAIN_ROCKET,
      DOMAIN_WHATSAPP,
      DOMAIN_TEAMS,
      DOMAIN_GCHAT,
      DOMAIN_GMAIL,
    } = process.env;
    if (domain === DOMAIN_SLACK) return "slack";
    if (domain === DOMAIN_ROCKET) return "rocketChat";
    if (domain === DOMAIN_WHATSAPP) return "whatsApp";
    if (domain === DOMAIN_TEAMS) return "teams";
    if (domain === DOMAIN_GCHAT || domain === DOMAIN_GMAIL) return "googleChat";
    return "";
  }

  private getToneInstruction(
    domain: string,
    platform: string,
    isOpenRouter: boolean,
  ) {
    const strictFormat =
      "\nSTRICT FORMATTING RULE: Return ONLY a Markdown-formatted summary with clear headings and bullet points. NEVER return a JSON object, code block, or array of strings. Even if previous examples were in JSON, ignore that structure and use standard text.\n";
    const {
      DOMAIN_SLACK,
      DOMAIN_WHATSAPP,
      DOMAIN_GCHAT,
      DOMAIN_GMAIL,
      DOMAIN_TEAMS,
    } = process.env;

    switch (domain) {
      case DOMAIN_SLACK:
        return (
          "\nPlease provide a professional and concise summary suitable for workplace communication. Use formal language and focus on key business points, decisions, and action items. Do NOT include introductory phrases. ONLY return the final text.\n" +
          strictFormat
        );
      case DOMAIN_WHATSAPP:
        return (
          "\nPlease provide a summary that matches the conversational tone of the chat. Adapt to the communication style present in the messages.\n" +
          strictFormat
        );
      case DOMAIN_GCHAT:
      case DOMAIN_GMAIL:
        return (
          "\nPlease provide a professional and concise summary suitable for workplace communication. Focus on key business points and action items.\n" +
          strictFormat
        );
      case DOMAIN_TEAMS:
        return (
          "\nSummarize the conversation in a professional and formal tone. Present main discussion points, decisions, and action items.\n" +
          strictFormat
        );
      default:
        return (
          "\nPlease provide a clear and comprehensive summary of the conversation.\n" +
          strictFormat
        );
    }
  }

  dnsServer = async (req: Request, res: Response) => {
    try {
      const hostname = req.headers.host?.split(":")[0];
      if (!hostname) {
        return res
          .status(400)
          .json({ status: 400, message: "Invalid hostname" });
      }
      const { address } = await dns.promises.lookup(hostname);
      const isLocal = address === "127.0.0.1";
      return res.json({ address, isLocalhost: isLocal });
    } catch (error: any) {
      logger.error(`DNS Lookup failed: ${error.message}`);
      return res
        .status(500)
        .json({ status: 500, message: "DNS Lookup failed" });
    }
  };

  refreshModels = async (req: Request, res: Response) => {
    try {
      const { getOpenAIModels } = require("../utils/openRouterModels");
      await getOpenAIModels();
      res.json({
        status: "OK",
        message: "Model list refreshed successfully.",
      });
    } catch (error: any) {
      logger.error(`RefreshModels Error: ${error.message}`);
      res.status(500).json({ status: "Error", message: error.message });
    }
  };

  getAllPersonalAiOption = async (req: Request, res: Response) => {
    try {
      const { tone, category, description, name, label, role } = req.body;
      req.body.limit = 100;
      req.body.isExternal = true;

      const conversation = await messageService.getMessages(req as any);
      if (typeof conversation === "object" && (conversation as any).error) {
        return res
          .status((conversation as any).status)
          .json({ message: (conversation as any).message });
      }

      const userInfoParts = [];
      if (name) userInfoParts.push(`User Name: ${name}`);
      if (label) userInfoParts.push(`Label: ${label}`);
      if (role) userInfoParts.push(`role: ${role}`);

      const addingPrompt = userInfoParts.length
        ? `\n\nAdditional User Context:\n${userInfoParts.join("\n")}`
        : "";

      const conversationText = conversation;
      let msgWithPrompt = "";
      if (tone === "true") {
        if (req.body.role && role.length > 0) {
          msgWithPrompt = `${config.role}${addingPrompt}`;
        } else {
          msgWithPrompt = `${config.tones}${addingPrompt}\n\nConversation:\n${conversationText}`;
        }
      } else if (category === "true") {
        msgWithPrompt = `${config.category}${addingPrompt}\n\nConversation:\n${conversationText}`;
      } else if (description === "true") {
        msgWithPrompt = `${config.description}${addingPrompt}`;
      }

      const useSyncMode = req.body.state === "appsAIResponse";
      await this.processServerRes(msgWithPrompt, req, res, {}, useSyncMode);
    } catch (error: any) {
      logger.error(`GetAllPersonalAiOption Error: ${error.message}`);
      res.status(500).json({ message: error.message });
    }
  };

  grammarChecker = async (req: Request, res: Response) => {
    const OPENROUTER_URL = process.env.OPENROUTER_URL;
    const OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY;
    const DEFAULT_MODEL = process.env.OPENROUTER_DEFAULT_MODEL;
    const ADVANCED_MODEL = process.env.OPENROUTER_ADVANCED_MODEL;
    try {
      if (!OPENROUTER_API_KEY) {
        return res.status(500).json({ error: "Missing OPENROUTER_API_KEY" });
      }
      const text =
        this.asString(req.body?.text) ||
        this.asString(req.query?.query as string) ||
        this.asString(req.query?.text as string) ||
        "";

      const mode = (this.asString(req.body?.mode) || "edits").toLowerCase();
      const aiModel = (
        this.asString(req.body?.aiModel) || "default"
      ).toLowerCase();

      if (!text || typeof text !== "string" || !text.trim()) {
        return res.status(400).json({ error: "text is required" });
      }

      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 15000);

      const onAborted = () => {
        try {
          controller.abort();
        } catch {
          /* ignore */
        }
      };

      req.on("aborted", onAborted);
      res.on("close", () => {
        if (!res.writableEnded) onAborted();
      });

      try {
        const model = aiModel === "advanced" ? ADVANCED_MODEL : DEFAULT_MODEL;
        let textForModel = text;
        let windowInfo: { start: number; end: number } | undefined;

        if (mode === "edits") {
          const win = this.extractWindow(text, 900);
          textForModel = win.text;
          windowInfo = { start: win.start, end: win.end };
        }

        const requestBody: any = {
          model,
          stream: true,
          usage: { include: true },
          temperature: 0,
          max_tokens: mode === "edits" ? 350 : 1400,
          response_format:
            mode === "edits" ? RESPONSE_FORMAT_EDITS : RESPONSE_FORMAT_FULL,
          messages:
            mode === "edits"
              ? [
                  { role: "system", content: config.systemPromptEdits.trim() },
                  { role: "user", content: textForModel },
                ]
              : [
                  { role: "system", content: config.systemPromptFull.trim() },
                  { role: "user", content: text },
                ],
        };

        const upstream = await fetch(OPENROUTER_URL, {
          method: "POST",
          headers: {
            Authorization: `Bearer ${OPENROUTER_API_KEY}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify(requestBody),
          signal: controller.signal,
        });

        if (!upstream.ok) {
          const errText = await upstream.text();
          return res.status(502).json({
            error: "AI service failed",
            details: errText,
          });
        }

        const { content, usage } = await this.readOpenRouterSse(upstream);

        let parsed: any;
        try {
          const repaired = attemptRepairJson(content);
          if (repaired !== content) {
            logger.debug(`[AIController] Repaired grammar JSON: ${repaired}`);
          }
          parsed = JSON.parse(repaired);
        } catch (e) {
          return res.status(500).json({
            error: "AI returned invalid JSON",
            details: content?.slice?.(0, 500) || String(content),
          });
        }

        if (mode === "edits") {
          const edits = this.normalizeEdits(parsed?.edits);
          return res.json({
            mode: "edits",
            edits,
            window: windowInfo,
            usage,
          });
        }

        const correctedText =
          typeof parsed?.correctedText === "string" ? parsed.correctedText : "";

        return res.json({
          mode: "full",
          correctedText,
          usage,
        });
      } finally {
        clearTimeout(timeout);
        req.off("aborted", onAborted);
      }
    } catch (error: any) {
      if (req.aborted || res.writableEnded) return;
      if (error?.name === "AbortError") {
        return res.status(504).json({ error: "AI request aborted/timed out" });
      }
      logger.error(`GrammarChecker Error: ${error.message}`);
      res.status(500).json({ error: error.message });
    }
  };

  private asString = (v: any): string | undefined => {
    if (typeof v === "string") return v;
    if (Array.isArray(v) && typeof v[0] === "string") return v[0];
    return undefined;
  };

  private extractWindow = (
    fullText: string,
    maxChars = 900,
  ): { text: string; start: number; end: number } => {
    const end = fullText.length;
    if (end <= maxChars) {
      return { text: fullText, start: 0, end };
    }

    let start = Math.max(0, end - maxChars);
    const slice = fullText.slice(start, end);

    const lastNl = slice.lastIndexOf("\n");
    if (lastNl !== -1 && lastNl < slice.length - 20) {
      start = start + lastNl + 1;
      return { text: fullText.slice(start, end), start, end };
    }

    const boundaryRegex = /[.!?]\s+/g;
    let boundaryPos = -1;
    for (const m of slice.matchAll(boundaryRegex)) {
      boundaryPos = (m.index ?? -1) + m[0].length;
    }
    if (boundaryPos !== -1 && boundaryPos < slice.length - 20) {
      start = start + boundaryPos;
    }

    return { text: fullText.slice(start, end), start, end };
  };

  private normalizeEdits = (raw: any): GrammarEdit[] => {
    if (!Array.isArray(raw)) return [];
    return raw
      .map((e) => ({
        originalWord: typeof e?.originalWord === "string" ? e.originalWord : "",
        correctedWord:
          typeof e?.correctedWord === "string" ? e.correctedWord : "",
        errorType:
          e?.errorType === "spelling" ||
          e?.errorType === "grammar" ||
          e?.errorType === "punctuation" ||
          e?.errorType === "other"
            ? e.errorType
            : "other",
      }))
      .filter(
        (e) =>
          e.originalWord &&
          e.correctedWord &&
          e.correctedWord !== e.originalWord,
      ) as GrammarEdit[];
  };

  private async readOpenRouterSse(
    upstream: any,
  ): Promise<{ content: string; usage: any | null }> {
    if (!upstream.body) {
      throw new Error("OpenRouter streaming response had no body");
    }

    const reader = upstream.body.getReader();
    const decoder = new TextDecoder("utf-8");

    let buffer = "";
    let content = "";
    let usage: any | null = null;

    while (true) {
      const { value, done } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      buffer = buffer.replace(/\r\n/g, "\n");

      while (true) {
        const sepIndex = buffer.indexOf("\n\n");
        if (sepIndex === -1) break;

        const event = buffer.slice(0, sepIndex);
        buffer = buffer.slice(sepIndex + 2);

        const lines = event.split("\n");
        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed || trimmed.startsWith(":")) continue;
          if (!trimmed.startsWith("data:")) continue;

          const dataStr = trimmed.slice(5).trim();
          if (!dataStr) continue;
          if (dataStr === "[DONE]") return { content, usage };

          let chunk: any;
          try {
            chunk = JSON.parse(dataStr);
          } catch {
            continue;
          }

          if (chunk?.error) {
            throw new Error(chunk.error?.message || "Upstream error");
          }

          if (chunk?.usage) usage = chunk.usage;
          const delta = chunk?.choices?.[0]?.delta?.content;
          if (typeof delta === "string") content += delta;

          const msgContent = chunk?.choices?.[0]?.message?.content;
          if (typeof msgContent === "string") content += msgContent;
        }
      }
    }
    return { content, usage };
  }

  generatePersonalityQuestions = async (req: Request, res: Response) => {
    try {
      const {
        jsonlContent,
        category,
        tone,
        personaName,
        personaDescription,
        isFollowUp,
        previousQandA,
        aiModel,
      } = req.body;

      const lines = jsonlContent.trim().split("\n");
      let conversationSamples = "";
      let sampleCount = 0;
      for (let i = 0; i < Math.min(lines.length, 100); i++) {
        try {
          const parsed = JSON.parse(lines[i]);
          if (parsed.messages && Array.isArray(parsed.messages)) {
            const userContent = parsed.messages
              .filter((m: any) => m.role === "user")
              .map((m: any) => m.content)
              .join(" ");
            const assistantContent = parsed.messages
              .filter((m: any) => m.role === "assistant")
              .map((m: any) => m.content)
              .join(" ");
            if (userContent && assistantContent) {
              conversationSamples += `Sample ${i + 1}:\nPrompt: ${userContent}\nCompletion: ${assistantContent}\n\n`;
              sampleCount++;
            }
          } else if (parsed.prompt && parsed.completion) {
            conversationSamples += `Sample ${i + 1}:\nPrompt: ${parsed.prompt}\nCompletion: ${parsed.completion}\n\n`;
            sampleCount++;
          }
        } catch (parseError) {
          logger.warn(`Failed to parse JSONL line ${i}: ${parseError}`);
        }
      }

      if (sampleCount === 0)
        throw new Error("No valid conversation samples found in JSONL");

      const personaContext =
        personaName && personaDescription
          ? `\n\nPersona Context:\nName: ${personaName}\nDescription: ${personaDescription}\n`
          : "";

      let promptText;
      const expectedQuestionCount = 5;

      if (isFollowUp && previousQandA) {
        const previousContext = JSON.stringify(previousQandA, null, 2);
        promptText = promptService.interpolate(
          config.personalityQuestionsFollowUpBatchPrompt || "",
          {
            personaContext,
            category,
            tone,
            previousContext,
          },
        );
      } else {
        promptText = promptService.interpolate(
          config.personalityQuestionsPrompt || "",
          {
            personaContext,
            category,
            tone,
            conversationSamples,
          },
        );
      }

      const model = aiModel || envConfig.personality.model;
      const provider = ProviderFactory.getProvider(model);
      logger.info(
        `[AIController] Generating personality questions with model: ${model}`,
      );
      const response = await provider.generateResponse(promptText, [], {
        model,
      });

      let questions: any;
      try {
        const repaired = attemptRepairJson(response);
        if (repaired !== response) {
          logger.debug(
            `[AIController] Repaired personality questions JSON: ${repaired}`,
          );
        }
        const jsonMatch = repaired.match(/\[[\s\S]*\]/);
        questions = JSON.parse(jsonMatch ? jsonMatch[0] : repaired);
      } catch (parseError) {
        logger.error(`Failed to parse AI response: ${response}`);
        throw new Error("Failed to parse AI-generated questions");
      }

      if (
        !Array.isArray(questions) ||
        questions.length !== expectedQuestionCount
      ) {
        throw new Error("Invalid questions format from AI");
      }

      res.status(200).json({ status: 200, questions });
    } catch (error: any) {
      logger.error(`GeneratePersonalityQuestions Error: ${error.message}`);
      res.status(500).json({ message: error.message });
    }
  };

  addFeedback = async (req: Request, res: Response) => {
    try {
      const {
        messageId,
        rating,
        userId,
        contextSnapshot,
        metadata,
        platform,
        domain,
        feature,
        platformName,
        appName,
        modelName,
        userName,
      } = req.body;
      const finalMessageId = messageId || `fallback-${Date.now()}`;

      // Intelligent mapping for our frontend dashboard UI
      const enrichedMetadata = { ...metadata };
      if (!enrichedMetadata.platform && (platform || domain || platformName)) {
        enrichedMetadata.platform =
          platformName ||
          platform ||
          this.getChatName(Array.isArray(domain) ? domain[0] : domain);
      }

      if (!enrichedMetadata.feature) {
        if (appName || feature) {
          enrichedMetadata.feature = appName || feature;
        } else if (contextSnapshot?.isMemoryEnabled === false) {
          enrichedMetadata.feature = "Idea/Rewrite";
        } else {
          // Fallback default
          enrichedMetadata.feature = "Chat/Summary";
        }
      }

      if (modelName && !enrichedMetadata.modelVersion) {
        enrichedMetadata.modelVersion = modelName;
      }

      const feedbackData = {
        userId,
        messageId: finalMessageId,
        rating,
        contextSnapshot: feedbackService.encryptContext(contextSnapshot),
        metadata: enrichedMetadata,
        platformName,
        appName,
        modelName,
        userName,
        timestamp: new Date(),
      };

      const feedback = await feedbackService.addFeedback(feedbackData);
      res.status(201).json(feedback);
    } catch (err: any) {
      logger.error(`Feedback Error: ${err.message}`);
      res.status(500).json({ error: err.message });
    }
  };

  editFeedback = async (req: Request, res: Response) => {
    try {
      const updatePayload = { ...req.body };

      // If the client sends an update containing a raw contextSnapshot,
      // it should be merged with fresh metadata attributes.
      if (
        updatePayload.metadata ||
        updatePayload.platform ||
        updatePayload.domain ||
        updatePayload.feature ||
        updatePayload.platformName ||
        updatePayload.appName ||
        updatePayload.modelName
      ) {
        const enrichedMetadata = { ...(updatePayload.metadata || {}) };
        if (
          !enrichedMetadata.platform &&
          (updatePayload.platform ||
            updatePayload.domain ||
            updatePayload.platformName)
        ) {
          enrichedMetadata.platform =
            updatePayload.platformName ||
            updatePayload.platform ||
            this.getChatName(
              Array.isArray(updatePayload.domain)
                ? updatePayload.domain[0]
                : updatePayload.domain,
            );
        }
        if (
          !enrichedMetadata.feature &&
          (updatePayload.appName || updatePayload.feature)
        ) {
          enrichedMetadata.feature =
            updatePayload.appName || updatePayload.feature;
        }
        if (updatePayload.modelName && !enrichedMetadata.modelVersion) {
          enrichedMetadata.modelVersion = updatePayload.modelName;
        }
        updatePayload.metadata = enrichedMetadata;
      }

      const updated = await feedbackService.editFeedback(
        req.params.id as string,
        updatePayload,
      );
      if (!updated)
        return res.status(404).json({ error: "Feedback not found" });
      res.json(updated);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  };

  deleteFeedback = async (req: Request, res: Response) => {
    try {
      const deleted = await feedbackService.deleteFeedback(
        req.params.id as string,
      );
      if (!deleted)
        return res.status(404).json({ error: "Feedback not found" });
      res.json({ message: "Feedback deleted successfully" });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  };

  getAdminFeedback = async (req: Request, res: Response) => {
    try {
      const page = req.query.page ? parseInt(req.query.page as string, 10) : 1;
      const limit = req.query.limit
        ? parseInt(req.query.limit as string, 10)
        : 50;

      const filters = {
        rating: req.query.rating,
        status: req.query.status,
        model: req.query.model,
        feature: req.query.feature,
        platform: req.query.platform,
        startDate: req.query.startDate,
        endDate: req.query.endDate,
        search: req.query.search,
      };

      const sortBy = (req.query.sortBy as string) || "recent";

      const result = await feedbackService.getAdminFeedback(
        filters,
        page,
        limit,
        sortBy,
      );
      res.status(200).json(result);
    } catch (err: any) {
      logger.error(`Admin GetFeedback Error: ${err.message}`);
      res.status(500).json({ error: err.message });
    }
  };

  updateAdminFeedback = async (req: Request, res: Response) => {
    try {
      const id = req.params.id as string;
      const { reviewStatus, reviewTags, reviewNotes, reviewerScores } = req.body;

      // Get reviewer email from JWT-validated user (set by requireRole middleware)
      const resolvedEmail =
        (req as any).resolvedEmail || req.body.reviewerEmail || req.body.email;

      const updateData: any = {};
      if (reviewStatus) updateData.reviewStatus = reviewStatus;
      if (reviewTags) updateData.reviewTags = reviewTags;
      if (reviewNotes !== undefined) updateData.reviewNotes = reviewNotes;
      if (reviewerScores !== undefined) updateData.reviewerScores = reviewerScores;
      if (resolvedEmail) updateData.reviewerEmail = resolvedEmail;

      const updated = await feedbackService.updateAdminFeedback(id, updateData);

      if (!updated) {
        return res.status(404).json({ error: "Feedback not found" });
      }

      // Audit log for review actions
      if (resolvedEmail) {
        const changes = [];
        if (reviewStatus) changes.push(`status→${reviewStatus}`);
        if (reviewTags?.length) changes.push(`tags→[${reviewTags.join(",")}]`);
        if (reviewNotes !== undefined) changes.push(`notes updated`);
        await accessControlService.logAudit(
          resolvedEmail,
          "FEEDBACK_REVIEWED",
          id,
          "feedback",
          `Reviewed feedback: ${changes.join(", ")}`,
        );
      }

      res.status(200).json(updated);
    } catch (err: any) {
      logger.error(`Admin UpdateFeedback Error: ${err.message}`);
      res.status(500).json({ error: err.message });
    }
  };

  generateRubricScores = async (req: Request, res: Response) => {
    try {
      const { prompt, response, aiModel } = req.body;

      const scoringPrompt = promptService.interpolate(config.rubricScoringPrompt, {
        prompt,
        response,
      });

      const model = aiModel || envConfig.personality.model || "google/gemini-2.0-flash-001";
      const provider = ProviderFactory.getProvider(model);
      
      logger.info(`[AIController] Generating rubric scores with model: ${model}`);
      
      const aiResponse = await provider.generateResponse(scoringPrompt, [], {
        model,
        temperature: 0.1,
      });

      let scores: any;
      try {
        const repaired = attemptRepairJson(aiResponse);
        const jsonMatch = repaired.match(/\{[\s\S]*\}/);
        scores = JSON.parse(jsonMatch ? jsonMatch[0] : repaired);
      } catch (parseError) {
        logger.error(`Failed to parse AI rubric response: ${aiResponse}`);
        throw new Error("Failed to parse AI-generated scores");
      }

      // Filter and validate keys match SCORING_DIMENSIONS
      const dimensions = ["Accuracy", "Relevance", "Helpfulness", "Clarity", "Hallucination", "Tone/Safety"];
      const validatedScores: Record<string, number> = {};
      
      dimensions.forEach(dim => {
        const score = Number(scores[dim] || scores[dim.toLowerCase()]);
        if (!isNaN(score)) {
          validatedScores[dim] = Math.max(1, Math.min(5, Math.round(score)));
        } else {
          validatedScores[dim] = 0;
        }
      });

      res.status(200).json({ status: 200, scores: validatedScores });
    } catch (error: any) {
      logger.error(`GenerateRubricScores Error: ${error.message}`);
      res.status(500).json({ message: error.message });
    }
  };

  deleteAdminFeedback = async (req: Request, res: Response) => {
    try {
      const id = req.params.id as string;
      const resolvedEmail = (req as any).resolvedEmail || "unknown";

      const deleted = await feedbackService.deleteFeedback(id);
      if (!deleted) {
        return res.status(404).json({ error: "Feedback not found" });
      }

      // Audit log for deletion
      await accessControlService.logAudit(
        resolvedEmail,
        "FEEDBACK_DELETED",
        id,
        "feedback",
        `Admin deleted feedback entry ${id}`,
      );

      res.json({ message: "Feedback deleted successfully" });
    } catch (err: any) {
      logger.error(`Admin DeleteFeedback Error: ${err.message}`);
      res.status(500).json({ error: err.message });
    }
  };

  getAdminFeedbackStats = async (req: Request, res: Response) => {
    try {
      const filters = {
        rating: req.query.rating,
        status: req.query.status,
        model: req.query.model,
        feature: req.query.feature,
        platform: req.query.platform,
        startDate: req.query.startDate,
        endDate: req.query.endDate,
        search: req.query.search,
      };
      const stats = await feedbackService.getAggregateStats(filters);
      res.status(200).json(stats);
    } catch (err: any) {
      logger.error(`Admin GetFeedbackStats Error: ${err.message}`);
      res.status(500).json({ error: err.message });
    }
  };

  getModelComparisonStats = async (req: Request, res: Response) => {
    try {
      const filters = {
        rating: req.query.rating,
        status: req.query.status,
        model: req.query.model,
        feature: req.query.feature,
        platform: req.query.platform,
        startDate: req.query.startDate,
        endDate: req.query.endDate,
        search: req.query.search,
      };
      const stats = await feedbackService.getModelComparisonStats(filters);
      res.status(200).json(stats);
    } catch (err: any) {
      logger.error(`Admin GetModelComparisonStats Error: ${err.message}`);
      res.status(500).json({ error: err.message });
    }
  };

  generateProcessingFilters = async (req: Request, res: Response) => {
    const requestId = `req-${Date.now()}`;
    const { jsonl_data } = req.body;
    const requestStart = Date.now();
    try {
      const aiModel = process.env.AI_PROCESSING_FILTERS_MODEL;
      const openRouterUrl = process.env.OPENROUTER_URL;
      const openRouterKey = process.env.OPENROUTER_API_KEY;
      const CONCURRENCY_LIMIT = 10;

      if (!openRouterUrl || !openRouterKey)
        throw new Error("OPENROUTER_URL or OPENROUTER_API_KEY not set");

      logger.info(
        `[Filters] [${requestId}] Starting generateProcessingFilters. ` +
          `Input lines: ${jsonl_data?.length || 0}, model: ${aiModel}, concurrency: ${CONCURRENCY_LIMIT}`,
      );
      const cleanedData = jsonl_data
        .filter((line: string) => {
          if (!line) return false;
          try {
            const parsed = JSON.parse(line);
            const messages = parsed.messages || [];
            const sysMsg = messages.find((m: any) => m.role === "system");
            const userMsg = messages.find((m: any) => m.role === "user");

            const sysContent = sysMsg?.content || "";
            const userContent = userMsg?.content || "";

            // Personality Q&A and Document references don't have "Tone:" in their sys prompt
            // Document references contain "Provide the reference document regarding:" in user prompt
            if (
              !sysContent.includes("Tone:") ||
              userContent.includes("Provide the reference document")
            ) {
              return false;
            }
          } catch (e) {
            // If not valid JSON, we'll exclude or let it fail downstream
            return false;
          }
          return true;
        })
        .map(sanitizePromptForFilters)
        .filter((line: string) => line && line.trim().length > 0);
      logger.debug(
        `[Filters] [${requestId}] Sanitization complete. ` +
          `${jsonl_data.length} → ${cleanedData.length} lines.`,
      );

      const chunks = chunkJsonlByTokens(cleanedData, 15000);
      const totalChunks = chunks.length;
      logger.info(
        `[Filters] [${requestId}] Created ${totalChunks} chunks. ` +
          `Starting parallel processing (concurrency=${CONCURRENCY_LIMIT})...`,
      );
      const processChunk = async (
        chunkLines: string[],
        chunkIndex: number,
      ): Promise<any | null> => {
        const chunkId = `${requestId}-c${chunkIndex + 1}/${totalChunks}`;
        const chunkStart = Date.now();
        const estTokens = Math.ceil(chunkLines.join("\n").length / 3);
        logger.info(
          `[Filters] [${chunkId}] Starting. Lines: ${chunkLines.length}, est. tokens: ~${estTokens}`,
        );

        const analysisPrompt = promptService.interpolate(
          config.processingFiltersPrompt || "",
          { jsonlData: chunkLines.join("\n") },
        );

        const MAX_RETRIES = 3;
        for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
          const attemptStart = Date.now();
          try {
            const response = await axios.post(
              openRouterUrl,
              {
                model: aiModel,
                messages: [
                  {
                    role: "system",
                    content:
                      "You are a JSON filter generator. Analyze the conversation data provided and return ONLY a valid JSON object containing the required filter keys. Do NOT wrap in markdown or add any explanation outside the JSON.",
                  },
                  { role: "user", content: analysisPrompt },
                ],
                temperature: 0.1,
                max_tokens: 4096,
                response_format: { type: "json_object" },
              },
              {
                headers: {
                  Authorization: `Bearer ${openRouterKey}`,
                  "X-Title": "RectifyChat AI",
                },
                timeout: 120000,
              },
            );

            const networkMs = Date.now() - attemptStart;
            const content = response.data?.choices?.[0]?.message?.content || "";
            const cleanJson = content.replace(/```json|```/g, "").trim();
            try {
              const parseStart = Date.now();
              const parsed = JSON.parse(cleanJson);
              const parseMs = Date.now() - parseStart;
              const totalMs = Date.now() - chunkStart;
              return parsed;
            } catch (_parseErr) {
              logger.warn(
                `[Filters] [${chunkId}] JSON parse failed, attempting repair. `,
              );
              try {
                const repairStart = Date.now();
                const repaired = attemptRepairJson(cleanJson);
                const repairMs = Date.now() - repairStart;

                const parseRepairedStart = Date.now();
                const parsed = JSON.parse(repaired);
                const parseRepairedMs = Date.now() - parseRepairedStart;

                const totalMs = Date.now() - chunkStart;
                logger.info(
                  `[Filters] [${chunkId}] ✓ Repaired and parsed successfully.`,
                );
                return parsed;
              } catch (_repairErr) {
                logger.error(
                  `[Filters] [${chunkId}] ✗ JSON unrecoverable after repair. Total time: ${
                    Date.now() - chunkStart
                  }ms. ` +
                    `Giving up this chunk (no retry wasted on JSON errors).`,
                );
                return null;
              }
            }
          } catch (networkError: any) {
            const elapsed = Date.now() - attemptStart;
            const isLastAttempt = attempt >= MAX_RETRIES;
            const status = networkError.response?.status;
            const retryAfterMs = 2000 * attempt;

            logger.warn(
              `[Filters] [${chunkId}] Network error on attempt ${attempt}/${MAX_RETRIES} ` +
                `(${elapsed}ms, HTTP ${status || "?"}): ${
                  networkError.message
                }. ` +
                (isLastAttempt
                  ? "No more retries."
                  : `Retrying in ${retryAfterMs}ms...`),
            );

            if (isLastAttempt) {
              logger.error(
                `[Filters] [${chunkId}] ✗ Exhausted all retries. Chunk failed.`,
              );
              return null;
            }
            await new Promise((r) => setTimeout(r, retryAfterMs));
          }
        }
        return null;
      };

      // --- Sliding-window concurrency semaphore ---
      const runWithConcurrencyLimit = async <T>(
        tasks: (() => Promise<T>)[],
        limit: number,
      ): Promise<Array<T | null>> => {
        const results: Array<T | null> = new Array(tasks.length).fill(null);
        let nextIndex = 0;
        let completedCount = 0;
        const runNext = async (): Promise<void> => {
          const taskIndex = nextIndex++;
          if (taskIndex >= tasks.length) return;
          try {
            results[taskIndex] = await tasks[taskIndex]();
          } catch {
            results[taskIndex] = null;
          }
          completedCount++;
          logger.debug(
            `[Filters] [${requestId}] Progress: ${completedCount}/${tasks.length} chunks done.`,
          );
          await runNext();
        };
        const workers = Array.from(
          { length: Math.min(limit, tasks.length) },
          runNext,
        );
        await Promise.all(workers);
        return results;
      };
      logger.info(
        `[Filters] [${requestId}] All ${totalChunks} chunks queued. Parallel execution started.`,
      );
      const tasks = chunks.map((c, idx) => () => processChunk(c, idx));
      const allResults = await runWithConcurrencyLimit(
        tasks,
        CONCURRENCY_LIMIT,
      );
      const successfulResponses = allResults.filter((r) => r !== null);
      const failedCount = allResults.length - successfulResponses.length;
      logger.info(
        `[Filters] [${requestId}] All chunks finished. ` +
          `${successfulResponses.length}/${totalChunks} succeeded, ${failedCount} failed. ` +
          `Elapsed: ${Date.now() - requestStart}ms`,
      );
      if (successfulResponses.length === 0) {
        logger.error(
          `[Filters] [${requestId}] ✗ No valid responses from any chunk. Aborting.`,
        );
        throw new Error("Failed to return valid JSON from AI");
      }
      if (failedCount > 0) {
        logger.warn(
          `[Filters] [${requestId}] ⚠ Response is partial — ${failedCount} chunk(s) failed. ` +
            `Merging available data...`,
        );
      }
      const merged = mergeFilters(successfulResponses);
      const filterKeyCount = Object.keys(merged).length;
      logger.info(
        `[Filters] [${requestId}] ✓ Merged ${successfulResponses.length} responses → ${filterKeyCount} filter keys. ` +
          `Total wall time: ${Date.now() - requestStart}ms`,
      );
      // Log exactly what the aggregated parsed filters are, per user request
      // logger.info(
      //   `[Filters] [${requestId}] Final Filters JSON:\n${JSON.stringify(merged, null, 2)}`,
      // );
      res.status(200).json({
        status: failedCount > 0 ? "PARTIAL" : "OK",
        filters: merged,
        totalChunks,
        successfulChunks: successfulResponses.length,
        failedChunks: failedCount,
      });
    } catch (error: any) {
      logger.error(
        `[Filters] [${requestId}] ProcessingFilters error after ${
          Date.now() - requestStart
        }ms: ${error.message}`,
      );
      res.status(500).json({ status: "ERROR", message: error.message });
    }
  };
}

export const aiController = new AIController();
