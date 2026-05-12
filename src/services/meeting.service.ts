import { AssemblyAI } from "assemblyai";
import { env } from "@/env";

const client = new AssemblyAI({
  apiKey: env.ASSEMBLY_API_KEY,
});

function msToTime(ms: number) {
  const seconds = ms / 1000;
  const minutes = Math.floor(seconds / 60);
  const remainingSeconds = Math.floor(seconds % 60);
  return `${minutes.toString().padStart(2, "0")}:${remainingSeconds.toString().padStart(2, "0")}`;
}

export class MeetingService {
  /**
   * Processes a meeting by transcribing the audio and extracting summaries (chapters).
   */
  async processMeeting(meetingUrl: string) {
    console.log(`[MeetingService] Processing meeting: ${meetingUrl}`);
    
    const transcript = await client.transcripts.transcribe({
      audio: meetingUrl,
      auto_chapters: true,
    });

    const summaries =
      transcript.chapters?.map((chapter) => ({
        start: msToTime(chapter.start),
        end: msToTime(chapter.end),
        gist: chapter.gist,
        headline: chapter.headline,
        summary: chapter.summary,
      })) || [];

    if (!transcript.text) {
      throw new Error("No transcript found for the meeting");
    }

    return {
      summaries,
      text: transcript.text,
    };
  }
}

export const meetingService = new MeetingService();

