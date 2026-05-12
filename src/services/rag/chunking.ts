import * as ParserNamespace from "web-tree-sitter";
const Parser = (ParserNamespace as any).default || ParserNamespace;


export interface IChunk {
  content: string;
  startLine: number;
  endLine: number;
  type: string;
}

export class ChunkingService {
  private parser: any = null;

  /**
   * Initializes the parser with the necessary WASM files.
   */
  async init() {
    if (this.parser) return;
    await Parser.init();
    this.parser = new Parser();
    
    // In a real environment, you would load the specific language wasm
    // Example: const TypeScript = await Parser.Language.load('/tree-sitter-typescript.wasm');
    // this.parser.setLanguage(TypeScript);
  }

  /**
   * Chunks code using AST boundaries if possible, falling back to line-based chunking.
   */
  async chunk(code: string, filename: string): Promise<IChunk[]> {
    const extension = filename.split(".").pop();
    
    // Fallback line-based chunking for now
    // We'll implement AST-aware chunking once WASM files are confirmed
    return this.lineBasedChunk(code);
  }

  private lineBasedChunk(code: string, maxLines = 50, overlap = 5): IChunk[] {
    const lines = code.split("\n");
    const chunks: IChunk[] = [];
    
    for (let i = 0; i < lines.length; i += (maxLines - overlap)) {
      const chunkLines = lines.slice(i, i + maxLines);
      chunks.push({
        content: chunkLines.join("\n"),
        startLine: i + 1,
        endLine: i + chunkLines.length,
        type: "block",
      });
      
      if (i + maxLines >= lines.length) break;
    }
    
    return chunks;
  }
}

export const chunkingService = new ChunkingService();
