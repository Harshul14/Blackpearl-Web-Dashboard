
const { z } = require('zod');
const dotenv = require('dotenv');
const path = require('path');

dotenv.config({ path: path.join(__dirname, '.env') });

const serverSchema = z.object({
  DATABASE_URL: z.string().url(),
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  CLERK_SECRET_KEY: z.string(),
  GITHUB_TOKEN: z.string(),
  GEMINI_API_KEY: z.string().optional(),
  ASSEMBLY_API_KEY: z.string(),
  STRIPE_SECRET_KEY: z.string(),
  STRIPE_WEBHOOK_SECRET: z.string(),
  OPENROUTER_API_KEY: z.string().optional(),
  OPENROUTER_MODEL: z.string().default("nvidia/nemotron-3-super-120b-a12b:free"),
});

const clientSchema = z.object({
  NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY: z.string(),
  NEXT_PUBLIC_CLERK_SIGN_IN_URL: z.string(),
  NEXT_PUBLIC_CLERK_SIGN_UP_URL: z.string(),
  NEXT_PUBLIC_APP_URL: z.string().url(),
  NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY: z.string(),
  NEXT_PUBLIC_SUPABASE_URL: z.string().url().optional(),
  NEXT_PUBLIC_SUPABASE_ANON_KEY: z.string().optional(),
});

const runtimeEnv = {
  DATABASE_URL: process.env.DATABASE_URL,
  NODE_ENV: process.env.NODE_ENV,
  CLERK_SECRET_KEY: process.env.CLERK_SECRET_KEY,
  GITHUB_TOKEN: process.env.GITHUB_TOKEN,
  GEMINI_API_KEY: process.env.GEMINI_API_KEY,
  ASSEMBLY_API_KEY: process.env.ASSEMBLY_API_KEY,
  STRIPE_SECRET_KEY: process.env.STRIPE_SECRET_KEY,
  STRIPE_WEBHOOK_SECRET: process.env.STRIPE_WEBHOOK_SECRET,
  OPENROUTER_API_KEY: process.env.OPENROUTER_API_KEY,
  OPENROUTER_MODEL: process.env.OPENROUTER_MODEL,
  NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY: process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY,
  NEXT_PUBLIC_CLERK_SIGN_IN_URL: process.env.NEXT_PUBLIC_CLERK_SIGN_IN_URL,
  NEXT_PUBLIC_CLERK_SIGN_UP_URL: process.env.NEXT_PUBLIC_CLERK_SIGN_UP_URL,
  NEXT_PUBLIC_APP_URL: process.env.NEXT_PUBLIC_APP_URL,
  NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY: process.env.STRIPE_PUBLISHABLE_KEY, // Note: using process.env.STRIPE_PUBLISHABLE_KEY as in src/env.js
  NEXT_PUBLIC_SUPABASE_URL: process.env.NEXT_PUBLIC_SUPABASE_URL,
  NEXT_PUBLIC_SUPABASE_ANON_KEY: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
};

console.log("Checking Server Props...");
const serverResult = serverSchema.safeParse(runtimeEnv);
if (!serverResult.success) {
  console.error("Server Validation Failed:", serverResult.error.flatten().fieldErrors);
} else {
  console.log("Server Validation Passed");
}

console.log("\nChecking Client Props...");
const clientResult = clientSchema.safeParse(runtimeEnv);
if (!clientResult.success) {
  console.error("Client Validation Failed:", clientResult.error.flatten().fieldErrors);
} else {
  console.log("Client Validation Passed");
}
