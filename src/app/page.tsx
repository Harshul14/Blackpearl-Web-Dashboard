// app/page.tsx
import { auth } from "@clerk/nextjs/server";
import { redirect } from "next/navigation";

export default async function Home() {
  const { userId } = await auth();
  if (!userId) {
    // If not signed in, redirect to sign-in page
    redirect("/sign-in");
  }
  // If signed in, redirect to dashboard
  redirect("/dashboard");
}

