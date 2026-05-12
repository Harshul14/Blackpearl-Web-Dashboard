import { db } from "@/server/db";
import { aiService } from "../ai.service";

export class RetrievalService {
  /**
   * Performs hybrid search (Vector + Keyword) for relevant code chunks.
   */
  async retrieve(query: string, projectId: string, limit = 10) {
    const queryEmbedding = await aiService.generateEmbedding(query);
    
    // 1. Vector Search
    const vectorResults: any[] = await db.$queryRaw`
      SELECT id, content, "fileName", "startLine", "endLine", 
             (embedding <=> ${queryEmbedding}::vector) as distance
      FROM "CodeChunk"
      WHERE "projectId" = ${projectId}
      ORDER BY distance ASC
      LIMIT ${limit * 2}
    `;

    // 2. Keyword Search (Basic ILIKE fallback for now)
    // In a production setup, we'd use pg_search / tsvector
    const keywordResults = await db.codeChunk.findMany({
      where: {
        projectId,
        content: {
          contains: query,
          mode: 'insensitive'
        }
      },
      take: limit
    });

    // 3. Simple Reranking / Merging
    const seenIds = new Set();
    const merged = [];

    for (const res of [...vectorResults, ...keywordResults]) {
      if (!seenIds.has(res.id)) {
        merged.push(res);
        seenIds.add(res.id);
      }
    }

    // 4. LLM-based Reranking (Phase 3 Enterprise Hardening)
    // For now, we take top 20 and pick top 10 using relevance scoring
    return await this.rerank(query, merged.slice(0, 20), limit);
  }

  private async rerank(query: string, chunks: any[], limit: number) {
    if (chunks.length <= limit) return chunks;

    const rerankPrompt = `Analyze the following code chunks and rank them by relevance to the query: "${query}".
    Return ONLY a comma-separated list of IDs in order of relevance.
    IDs: ${chunks.map(c => c.id).join(", ")}
    
    Chunks:
    ${chunks.map(c => `[ID: ${c.id}] ${c.content.slice(0, 500)}`).join("\n---\n")}`;

    try {
      const response = await aiService.summarizeCommit(rerankPrompt); // Using a placeholder service call
      const rankedIds = response.split(",").map(id => id.trim());
      
      return chunks
        .filter(c => rankedIds.includes(c.id))
        .sort((a, b) => rankedIds.indexOf(a.id) - rankedIds.indexOf(b.id))
        .slice(0, limit);
    } catch (e) {
      console.warn("Reranking failed, falling back to original order.");
      return chunks.slice(0, limit);
    }
  }
}

export const retrievalService = new RetrievalService();
