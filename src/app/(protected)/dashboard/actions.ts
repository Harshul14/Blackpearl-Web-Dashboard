"use server";
import { aiService } from "@/services/ai.service";
import { llmService } from "@/services/llm.service";
import { db } from "@/server/db";

export async function askQuestion(question: string, projectId: string) {
  const queryVector = await aiService.generateEmbedding(question);
  const vectorQuery = `[${queryVector.join(",")}]`;

  const result = (await db.$queryRaw`
        SELECT "fileName", "sourceCode", "summary",
        1 - ("summaryEmbedding" <=> ${vectorQuery}::vector) AS similarity
        FROM "SourceCodeEmbedding"
        WHERE 1 - ("summaryEmbedding" <=> ${vectorQuery}::vector) > 0.5
        AND "projectId"= ${projectId}
        ORDER BY similarity DESC
        LIMIT 10
    `) as { fileName: string; sourceCode: string; summary: string }[];
  let context = "";

  for (const doc of result) {
    context += `source: ${doc.fileName}\n 
    code content: ${doc.sourceCode}\n
    summary of file: ${doc.summary}\n\n`;
  }

  const output = await llmService.generateCompletion([
    {
      role: "system",
      content: `You are an AI code assistant who answers questions about the codebase. Your target audience is a technical intern.
        AI assistant is a brand new, powerful, human-like artificial intelligence.
        
        The traits of AI include expert knowledge, helpfulness, cleverness, and articulateness.
        AI is a well-behaved and well-mannered individual.
        AI is always friendly, kind, and inspiring, and he is eager to provide vivid and thoughtful responses to the user.
        AI has the sum of all knowledge in their brain, and is able to accurately answer nearly any question about any topic in it.
        If the question is asking about code or a specific file, AI will provide the detailed answer, giving step by step instructions.
        
        START CONTEXT BLOCK
        ${context}
        END OF CONTEXT BLOCK
        
        AI assistant will take into account any CONTEXT BLOCK that is provided in a conversation.
        If the context does not provide the answer to question, the AI assistant will say, "I'm sorry, but I don't know the answer."
        AI assistant will not apologize for previous responses, but instead will indicate when new information was gained.
        AI assistant will not invent anything that is not drawn directly from the context.
        Answer in markdown syntax, with code snippets if needed. Be as detailed as possible when answering, make sure to provide a complete answer.`,
    },
    {
      role: "user",
      content: question,
    },
  ], {
    fallback: true,
  });

  return {
    output,
    filesReferences: result,
  };
}

