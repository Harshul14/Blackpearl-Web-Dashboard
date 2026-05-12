"use client";
import { Card } from "@/components/ui/card";
import { useDropzone } from "react-dropzone"; // 61.2k (gzipped: 17.1k)
import React from "react"; // 6.9k (gzipped: 2.7k)
import { uploadFile } from "@/providers/storage/supabase.provider";
import { Presentation, Upload, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { buildStyles, CircularProgressbar } from "react-circular-progressbar";
import { api } from "@/trpc/react";
import useProject from "@/hooks/use-project";
import { toast } from "sonner";
import { useRouter } from "next/navigation";
import { useMutation } from "@tanstack/react-query";
import axios from "axios";

const MeetingCard = () => {
  const project = useProject();
  const processMeeting = useMutation({
    mutationFn: async (data: {
      meetingUrl: string;
      meetingId: string;
      projectId: string;
    }) => {
      const { meetingUrl, meetingId, projectId } = data;
      const response = await axios.post("/api/process-meeting", {
        meetingUrl,
        meetingId,
        projectId,
      });
      return response.data;
    },
  });
  const [isUploading, setIsUploading] = React.useState(false);
  const [progress, setProgress] = React.useState(0);
  const uploadMeeting = api.project.uploadMeeting.useMutation();
  const router = useRouter();
  const [isHovering, setIsHovering] = React.useState(false);

  const { getRootProps, getInputProps } = useDropzone({
    accept: {
      "audio/*": [".mp3", ".wav", ".m4a"],
    },
    multiple: false,
    maxSize: 50_000_000,
    disabled: isHovering, // Disable dropzone when hovering
    onDrop: async (acceptedFiles) => {
      if (!project || isHovering) return;
      setIsUploading(true);
      console.log(acceptedFiles);
      const file = acceptedFiles[0];
      if (!file) return;
      const downloadUrl = (await uploadFile(
        file as File,
        setProgress,
      )) as string;
      // original code
      //   uploadMeeting.mutate({
      //     projectId: project.id,
      //     meetingUrl: downloadUrl,
      //     name: file.name,
      //   });
      if (project?.project?.id) {
        uploadMeeting.mutate(
          {
            projectId: project.project.id,
            meetingUrl: downloadUrl,
            name: file.name,
          },
          {
            onSuccess: (meeting) => {
              toast.success("Meeting uploaded successfully");
              router.push("/meetings");
              processMeeting.mutateAsync({
                meetingUrl: downloadUrl,
                meetingId: meeting.id,
                projectId: project.project!.id,
              });
            },
            onError: () => {
              toast.error("Failed to upload meeting");
            },
          },
        );
      }
      setIsUploading(false);
    },
  });

  return (
    <Card
      className="group relative col-span-2 flex cursor-pointer flex-col items-center justify-center overflow-hidden p-10 transition-all duration-300 hover:bg-gray-50"
      {...getRootProps()}
      onMouseEnter={() => setIsHovering(true)}
      onMouseLeave={() => setIsHovering(false)}
    >
      {/* Minimalistic overlay */}
      <div className="absolute inset-0 bg-gray-100/50 opacity-0 transition-opacity duration-300 group-hover:opacity-100" />

      {/* Coming soon message overlay */}
      <div className="absolute inset-0 flex items-center justify-center bg-gray-50/95 opacity-0 backdrop-blur-sm transition-all duration-300 group-hover:opacity-100">
        <div className="text-center">
          <div className="bg-primary text-primary-foreground mb-2 rounded-lg px-4 py-2 text-sm font-medium">
            🚀 Coming Soon
          </div>

          <p className="max-w-48 text-xs text-gray-600">
            This feature is currently in development and will be available soon.
          </p>
        </div>
      </div>

      {/* Main content with relative positioning to stay above overlay */}
      <div
        className={`relative z-10 flex flex-col items-center transition-opacity duration-300 ${isHovering ? "opacity-0" : "opacity-100"}`}
      >
        {!isUploading && (
          <>
            <Presentation className="h-10 w-10 animate-bounce" />
            <h3 className="mt-2 text-sm font-semibold text-gray-900">
              Create a new meeting
            </h3>
            <p className="mt-1 text-center text-sm text-gray-500">
              Analyse your meeting with BlackPearl.
              <br />
              Powered by AI.
            </p>
            <div className="mt-6">
              <Button disabled={isUploading || isHovering}>
                <Upload className="mr-1.5 -ml-0.5 h-5 w-5" aria-hidden="true" />
                Upload Meeting
              </Button>
            </div>
            <input className="hidden" {...getInputProps()} />
          </>
        )}
        {isUploading && (
          <div className="">
            <CircularProgressbar
              value={progress}
              text={`${progress}%`}
              className="size-20"
              styles={buildStyles({
                pathColor: "#111",
                textColor: "#111",
              })}
            />
            <p className="text-center text-sm text-gray-500">
              Uploading your meeting...
            </p>
          </div>
        )}
      </div>
    </Card>
  );
};

export default MeetingCard;

