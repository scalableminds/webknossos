import { useState } from "react";

// Copy for the job-started card, captured when the job starts so that later edits to the form
// don't change it.
export type StartedJob = {
  title: string;
  description: string;
};

/** Tracks the job that was just started from an AI job tab, so its sidebar can confirm it. */
export function useStartedJob() {
  const [startedJob, setStartedJob] = useState<StartedJob | null>(null);
  return { startedJob, setStartedJob };
}
