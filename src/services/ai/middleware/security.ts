export class SecurityService {
  private static SECRET_PATTERNS = [
    /ey[a-zA-Z0-9._-]{10,}/g, // Generic JWT-like
    /sk_live_[0-9a-zA-Z]{24}/g, // Stripe Live
    /AIza[0-9A-Za-z-_]{35}/g, // Google API Key
    /[0-9a-f]{32}/g, // Generic MD5/Hex secrets
    /ghp_[a-zA-Z0-9]{36}/g, // GitHub PAT
  ];

  /**
   * Scrubs sensitive patterns from code or prompts before sending to LLM.
   */
  static scrub(text: string): string {
    let scrubbed = text;
    for (const pattern of this.SECRET_PATTERNS) {
      scrubbed = scrubbed.replace(pattern, "[REDACTED_SECRET]");
    }
    
    // Basic PII (Email)
    scrubbed = scrubbed.replace(/[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g, "[REDACTED_EMAIL]");
    
    return scrubbed;
  }
}
