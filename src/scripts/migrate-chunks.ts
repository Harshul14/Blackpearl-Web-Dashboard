import { db } from "../server/db";
import { chunkingService } from "../services/rag/chunking";
import { aiService } from "../services/ai.service";

/**
 * Migration script to generate granular chunks for existing indexed repositories.
 */
async function migrateExistingRepos() {
  console.log("Starting chunk migration...");
  
  const files = await db.sourceCodeEmbedding.findMany();
  console.log(`Found ${files.length} files to process.`);

  for (const file of files) {
    console.log(`Processing ${file.fileName}...`);
    
    // Check if chunks already exist for this file
    const existingChunks = await db.codeChunk.count({
      where: { fileName: file.fileName, projectId: file.projectId }
    });

    if (existingChunks > 0) {
      console.log(`Skipping ${file.fileName}, chunks already exist.`);
      continue;
    }

    const chunks = await chunkingService.chunk(file.sourceCode, file.fileName);
    
    for (const chunk of chunks) {
      const embedding = await aiService.generateEmbedding(chunk.content);
      const codeChunk = await db.codeChunk.create({
        data: {
          content: chunk.content,
          fileName: file.fileName,
          startLine: chunk.startLine,
          endLine: chunk.endLine,
          projectId: file.projectId,
        },
      });

      await db.$executeRaw`
        UPDATE "CodeChunk"
        SET "embedding" = ${embedding}::vector
        WHERE "id" = ${codeChunk.id}
      `;
    }
  }

  console.log("Migration complete.");
}

migrateExistingRepos().catch(console.error);
