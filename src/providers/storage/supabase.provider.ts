import { createClient } from "@supabase/supabase-js";
import { env } from "@/env";

const supabaseUrl = env.NEXT_PUBLIC_SUPABASE_URL ?? "";
const supabaseKey = env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "";

export const supabase = supabaseUrl && supabaseKey ? createClient(supabaseUrl, supabaseKey) : null as any;

export async function uploadFile(
  file: File,
  setProgress?: (progress: number) => void,
): Promise<string> {
  return new Promise(async (resolve, reject) => {
    try {
      if (!supabase) {
        throw new Error("Supabase is not configured. Please add NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY to your .env file.");
      }
      const fileName = `${Date.now()}-${file.name}`;
      
      // Note: This is a simple implementation. For progress tracking, 
      // standard Supabase upload doesn't provide it directly in the promise,
      // but we can simulate it or use specialized hooks if needed.
      // For now, we'll just handle the upload.
      
      const { data, error } = await supabase.storage
        .from("meetings") // Ensure this bucket exists in Supabase
        .upload(fileName, file, {
          cacheControl: "3600",
          upsert: false
        });

      if (error) {
        throw error;
      }

      const { data: { publicUrl } } = supabase.storage
        .from("meetings")
        .getPublicUrl(data.path);

      if (setProgress) setProgress(100);
      resolve(publicUrl);
    } catch (error: any) {
      console.error("[Supabase] Upload error:", error.message);
      reject(error);
    }
  });
}
