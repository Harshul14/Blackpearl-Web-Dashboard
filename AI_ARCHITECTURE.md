# AI Logic & Architecture

This document explains the architecture and implementation of AI features in the BlackPearl project. The system is designed for high availability, utilizing multiple LLM providers and semantic search techniques to provide intelligent codebase analysis.

## 1. LLM Provider Infrastructure

The core of the AI logic resides in `src/services/llm.service.ts`. It manages multiple AI providers to ensure requests are fulfilled even if one service is down or rate-limited.

### Fallback Sequence
Requests are attempted in the following exact order:
1.  **Google (Gemini)**: Primary provider (Gemini 2.0 Flash).
2.  **OpenRouter**: First fallback, providing access to a wide range of models.
3.  **NVIDIA**: Final fallback for high-performance inference.

### Failover Mechanism
The `LLMService` automatically triggers the next provider in the sequence if:
-   An API call fails (network error, 5xx status).
-   A timeout occurs.
-   Rate limits are exceeded.
-   The provider returns an invalid or empty response.

### Retry Logic
Each provider attempt includes **exponential backoff** retries (default: 3 attempts). If a rate limit is detected, the backoff delay increases more aggressively.

---

## 2. Core AI Workflows

### A. Repository Indexing & Semantic Search
When a project is created or updated, the `GitHubService` (`src/services/github.service.ts`) performs the following steps:

1.  **Code Ingestion**: Loads files from the repository using `GithubRepoLoader`.
2.  **File Summarization**: For each file, the `AIService` generates a high-level technical summary (under 100 words).
3.  **Embedding Generation**: The summary is converted into a vector embedding (using Google's `text-embedding-004` or similar).
4.  **Vector Storage**: The file content, summary, and embedding are stored in the `SourceCodeEmbedding` table in PostgreSQL (using `pgvector`).

### B. Retrieval-Augmented Generation (RAG)
When a user asks a question about the codebase (`askQuestion` in `src/app/(protected)/dashboard/actions.ts`):

1.  **Query Embedding**: The user's question is converted into a vector.
2.  **Vector Search**: The system performs a cosine similarity search against the stored `summaryEmbedding` to find the top 10 most relevant files.
3.  **Context Assembly**: The relevant code snippets and summaries are gathered into a "Context Block."
4.  **Answer Generation**: The context and the question are sent to the LLM with a specialized system prompt. The LLM is instructed to answer *only* based on the provided context to prevent hallucinations.

### C. Commit Summarization
The project automatically tracks repository activity:
1.  **Diff Fetching**: Fetches the `git diff` for new commits via the GitHub API.
2.  **AI Summarization**: The diff is sent to the LLM with a system prompt that understands `git diff` format.
3.  **Human-Readable Output**: The AI produces a concise list of changes, mapping modifications to specific files.

---

## 3. Meeting Intelligence
Meeting processing is handled by `src/services/meeting.service.ts` using **AssemblyAI**:

1.  **Transcription**: Converts meeting audio/video URLs into text.
2.  **Chapter Extraction**: Uses AssemblyAI's `auto_chapters` feature to identify meeting segments.
3.  **Summary Generation**: For each chapter, the system extracts a "gist" (short title), a "headline", and a detailed "summary".

---

## 4. Technical Specifications

| Feature | Provider(s) | Model / Tool |
| :--- | :--- | :--- |
| **Primary LLM** | Google | `gemini-2.0-flash` |
| **Fallback LLM** | OpenRouter | Configurable (e.g., `mistral-7b`) |
| **Secondary Fallback** | NVIDIA | `qwen2.5-72b-instruct` |
| **Embeddings** | Google | `text-embedding-004` |
| **Transcription** | AssemblyAI | AssemblyAI Transcribe |
| **Vector DB** | PostgreSQL | `pgvector` extension |

## 5. Environment Variables
The AI logic relies on the following keys:
- `GEMINI_API_KEY`: Required for primary flow and embeddings.
- `OPENROUTER_API_KEY`: Required for first fallback.
- `NVIDIA_API_KEY`: Required for final fallback.
- `ASSEMBLY_API_KEY`: Required for meeting transcription.
- `GITHUB_TOKEN`: Required to fetch code and diffs for analysis.
