import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";

import {
  cancelProjectJob,
  getProjectJob,
  listProjectJobs,
  rerunProjectJob,
  streamProjectJobEvents,
  type ProjectJob,
  type ProjectJobEvent,
  type ProjectJobKind,
  type ProjectJobStatus,
} from "../../../api/projects";
import { toErrorMessage } from "../../../lib/errors";
import { readSseJson } from "../../../lib/sse";
import { maxEventSeq, shouldStream, toEvent } from "./events";

function useJobLoaders(args: {
  projectId: string;
  pushLog: (message: string) => void;
  jobsStatusFilter: ProjectJobStatus | "";
  jobsKindFilter: ProjectJobKind | "";
  selectedJobId: string | null;
  setJobs: React.Dispatch<React.SetStateAction<ProjectJob[]>>;
  setJobsLoading: React.Dispatch<React.SetStateAction<boolean>>;
  setJobsError: React.Dispatch<React.SetStateAction<string>>;
  setSelectedJobId: React.Dispatch<React.SetStateAction<string | null>>;
  setSelectedJob: React.Dispatch<React.SetStateAction<ProjectJob | null>>;
  setSelectedEvents: React.Dispatch<React.SetStateAction<ProjectJobEvent[]>>;
  selectedSeqRef: React.MutableRefObject<number>;
}) {
  const loadJobs = useCallback(async () => {
    args.setJobsLoading(true);
    args.setJobsError("");
    try {
      const data = await listProjectJobs(args.projectId, {
        status: args.jobsStatusFilter,
        kind: args.jobsKindFilter,
        limit: 50,
        offset: 0,
      });
      args.setJobs(data.items);
      if (!args.selectedJobId && data.items.length > 0) args.setSelectedJobId(data.items[0].id);
    } catch (error: unknown) {
      args.setJobsError(toErrorMessage(error, "Failed to load jobs"));
    } finally {
      args.setJobsLoading(false);
    }
  }, [
    args.jobsKindFilter,
    args.jobsStatusFilter,
    args.projectId,
    args.selectedJobId,
    args.setJobs,
    args.setJobsError,
    args.setJobsLoading,
    args.setSelectedJobId,
  ]);

  const loadSelectedJob = useCallback(async () => {
    if (!args.selectedJobId) {
      args.setSelectedJob(null);
      args.setSelectedEvents([]);
      return;
    }
    try {
      const detail = await getProjectJob(args.projectId, args.selectedJobId);
      args.setSelectedJob(detail);
      args.setSelectedEvents(detail.event_tail || []);
      args.selectedSeqRef.current = maxEventSeq(detail.event_tail || []);
    } catch (error: unknown) {
      args.setSelectedJob(null);
      args.setSelectedEvents([]);
      args.pushLog(toErrorMessage(error, "Failed to load job detail"));
    }
  }, [
    args.projectId,
    args.pushLog,
    args.selectedJobId,
    args.selectedSeqRef,
    args.setSelectedEvents,
    args.setSelectedJob,
  ]);

  return { loadJobs, loadSelectedJob };
}

function useJobStream(args: {
  projectId: string;
  pushLog: (message: string) => void;
  setStreaming: React.Dispatch<React.SetStateAction<boolean>>;
  setSelectedEvents: React.Dispatch<React.SetStateAction<ProjectJobEvent[]>>;
  selectedSeqRef: React.MutableRefObject<number>;
  streamAbortRef: React.MutableRefObject<AbortController | null>;
  loadJobs: () => Promise<void>;
  loadSelectedJob: () => Promise<void>;
}) {
  const stopStream = useCallback(() => {
    if (!args.streamAbortRef.current) return;
    args.streamAbortRef.current.abort();
    args.streamAbortRef.current = null;
    args.setStreaming(false);
  }, [args.setStreaming, args.streamAbortRef]);

  const streamSelectedJob = useCallback(async (job: ProjectJob) => {
    stopStream();
    if (!shouldStream(job)) return;
    const controller = new AbortController();
    args.streamAbortRef.current = controller;
    try {
      const response = await streamProjectJobEvents(args.projectId, job.id, {
        fromSeq: args.selectedSeqRef.current,
        signal: controller.signal,
      });
      if (!response.ok || !response.body) return;
      args.setStreaming(true);
      for await (const raw of readSseJson(response)) {
        if (controller.signal.aborted) break;
        const event = toEvent(raw);
        if (!event) continue;
        const seq = Number(event.seq || 0);
        if (seq > 0) args.selectedSeqRef.current = Math.max(args.selectedSeqRef.current, seq);
        args.setSelectedEvents((previous) => [...previous, event].slice(-500));
        if (event.type === "job.terminal") {
          await args.loadJobs();
          await args.loadSelectedJob();
          break;
        }
      }
    } catch (error: unknown) {
      if (!(error instanceof DOMException) || error.name !== "AbortError") {
        args.pushLog(toErrorMessage(error, "Failed to stream job events"));
      }
    } finally {
      if (args.streamAbortRef.current === controller) args.streamAbortRef.current = null;
      args.setStreaming(false);
    }
  }, [
    args.loadJobs,
    args.loadSelectedJob,
    args.projectId,
    args.pushLog,
    args.selectedSeqRef,
    args.setSelectedEvents,
    args.setStreaming,
    args.streamAbortRef,
    stopStream,
  ]);

  return { stopStream, streamSelectedJob };
}

function useJobMutations(args: {
  projectId: string;
  pushLog: (message: string) => void;
  selectedJobId: string | null;
  setSelectedJobId: React.Dispatch<React.SetStateAction<string | null>>;
  loadJobs: () => Promise<void>;
  loadSelectedJob: () => Promise<void>;
}) {
  const cancelSelectedJob = useCallback(async () => {
    if (!args.selectedJobId) return;
    await cancelProjectJob(args.projectId, args.selectedJobId);
    args.pushLog("Cancel requested");
    await args.loadJobs();
    await args.loadSelectedJob();
  }, [args.loadJobs, args.loadSelectedJob, args.projectId, args.pushLog, args.selectedJobId]);

  const rerunSelectedJob = useCallback(async () => {
    if (!args.selectedJobId) return;
    const rerun = await rerunProjectJob(args.projectId, args.selectedJobId);
    args.pushLog(`Rerun queued: ${rerun.id}`);
    args.setSelectedJobId(rerun.id);
    await args.loadJobs();
  }, [args.loadJobs, args.projectId, args.pushLog, args.selectedJobId, args.setSelectedJobId]);

  return { cancelSelectedJob, rerunSelectedJob };
}

function useJobEffects(args: {
  projectId: string;
  selectedJobId: string | null;
  selectedJob: ProjectJob | null;
  loadJobs: () => Promise<void>;
  loadSelectedJob: () => Promise<void>;
  streamSelectedJob: (job: ProjectJob) => Promise<void>;
  stopStream: () => void;
  setJobs: React.Dispatch<React.SetStateAction<ProjectJob[]>>;
  setSelectedJob: React.Dispatch<React.SetStateAction<ProjectJob | null>>;
  setSelectedJobId: React.Dispatch<React.SetStateAction<string | null>>;
  setSelectedEvents: React.Dispatch<React.SetStateAction<ProjectJobEvent[]>>;
  selectedSeqRef: React.MutableRefObject<number>;
}) {
  useEffect(() => {
    void args.loadJobs();
  }, [args.loadJobs]);

  useEffect(() => {
    void args.loadSelectedJob();
  }, [args.loadSelectedJob]);

  useEffect(() => {
    if (!args.selectedJob || !shouldStream(args.selectedJob)) return;
    void args.streamSelectedJob(args.selectedJob);
    return () => args.stopStream();
  }, [args.selectedJob, args.stopStream, args.streamSelectedJob]);

  useEffect(() => {
    const timer = window.setInterval(() => {
      void args.loadJobs();
      if (args.selectedJobId) void args.loadSelectedJob();
    }, 8000);
    return () => window.clearInterval(timer);
  }, [args.loadJobs, args.loadSelectedJob, args.selectedJobId]);

  useEffect(() => {
    args.setJobs([]);
    args.setSelectedJob(null);
    args.setSelectedJobId(null);
    args.setSelectedEvents([]);
    args.selectedSeqRef.current = 0;
    args.stopStream();
  }, [
    args.projectId,
    args.selectedSeqRef,
    args.setJobs,
    args.setSelectedEvents,
    args.setSelectedJob,
    args.setSelectedJobId,
    args.stopStream,
  ]);
}

function useJobsWorkspaceState() {
  const [jobs, setJobs] = useState<ProjectJob[]>([]);
  const [jobsLoading, setJobsLoading] = useState(false);
  const [jobsError, setJobsError] = useState("");
  const [jobsStatusFilter, setJobsStatusFilter] = useState<ProjectJobStatus | "">("");
  const [jobsKindFilter, setJobsKindFilter] = useState<ProjectJobKind | "">("");
  const [selectedJobId, setSelectedJobId] = useState<string | null>(null);
  const [selectedJob, setSelectedJob] = useState<ProjectJob | null>(null);
  const [selectedEvents, setSelectedEvents] = useState<ProjectJobEvent[]>([]);
  const [streaming, setStreaming] = useState(false);
  const streamAbortRef = useRef<AbortController | null>(null);
  const selectedSeqRef = useRef(0);
  return {
    jobs,
    setJobs,
    jobsLoading,
    setJobsLoading,
    jobsError,
    setJobsError,
    jobsStatusFilter,
    setJobsStatusFilter,
    jobsKindFilter,
    setJobsKindFilter,
    selectedJobId,
    setSelectedJobId,
    selectedJob,
    setSelectedJob,
    selectedEvents,
    setSelectedEvents,
    streaming,
    setStreaming,
    streamAbortRef,
    selectedSeqRef,
  };
}

function buildJobsWorkspaceResult(args: {
  jobs: ProjectJob[];
  jobsLoading: boolean;
  jobsError: string;
  jobsStatusFilter: ProjectJobStatus | "";
  setJobsStatusFilter: React.Dispatch<React.SetStateAction<ProjectJobStatus | "">>;
  jobsKindFilter: ProjectJobKind | "";
  setJobsKindFilter: React.Dispatch<React.SetStateAction<ProjectJobKind | "">>;
  selectedJobId: string | null;
  setSelectedJobId: React.Dispatch<React.SetStateAction<string | null>>;
  selectedJob: ProjectJob | null;
  selectedJobSummary: string;
  selectedEvents: ProjectJobEvent[];
  streaming: boolean;
  loadJobs: () => Promise<void>;
  cancelSelectedJob: () => Promise<void>;
  rerunSelectedJob: () => Promise<void>;
}) {
  return {
    jobs: args.jobs,
    jobsLoading: args.jobsLoading,
    jobsError: args.jobsError,
    jobsStatusFilter: args.jobsStatusFilter,
    setJobsStatusFilter: args.setJobsStatusFilter,
    jobsKindFilter: args.jobsKindFilter,
    setJobsKindFilter: args.setJobsKindFilter,
    selectedJobId: args.selectedJobId,
    setSelectedJobId: args.setSelectedJobId,
    selectedJob: args.selectedJob,
    selectedJobSummary: args.selectedJobSummary,
    selectedEvents: args.selectedEvents,
    streaming: args.streaming,
    loadJobs: args.loadJobs,
    cancelSelectedJob: args.cancelSelectedJob,
    rerunSelectedJob: args.rerunSelectedJob,
  };
}

export function useJobsWorkspace(projectId: string, pushLog: (message: string) => void) {
  const state = useJobsWorkspaceState();

  const loaders = useJobLoaders({
    projectId,
    pushLog,
    jobsStatusFilter: state.jobsStatusFilter,
    jobsKindFilter: state.jobsKindFilter,
    selectedJobId: state.selectedJobId,
    setJobs: state.setJobs,
    setJobsLoading: state.setJobsLoading,
    setJobsError: state.setJobsError,
    setSelectedJobId: state.setSelectedJobId,
    setSelectedJob: state.setSelectedJob,
    setSelectedEvents: state.setSelectedEvents,
    selectedSeqRef: state.selectedSeqRef,
  });
  const stream = useJobStream({
    projectId,
    pushLog,
    setStreaming: state.setStreaming,
    setSelectedEvents: state.setSelectedEvents,
    selectedSeqRef: state.selectedSeqRef,
    streamAbortRef: state.streamAbortRef,
    loadJobs: loaders.loadJobs,
    loadSelectedJob: loaders.loadSelectedJob,
  });
  const mutations = useJobMutations({
    projectId,
    pushLog,
    selectedJobId: state.selectedJobId,
    setSelectedJobId: state.setSelectedJobId,
    loadJobs: loaders.loadJobs,
    loadSelectedJob: loaders.loadSelectedJob,
  });

  useJobEffects({
    projectId,
    selectedJobId: state.selectedJobId,
    selectedJob: state.selectedJob,
    loadJobs: loaders.loadJobs,
    loadSelectedJob: loaders.loadSelectedJob,
    streamSelectedJob: stream.streamSelectedJob,
    stopStream: stream.stopStream,
    setJobs: state.setJobs,
    setSelectedJob: state.setSelectedJob,
    setSelectedJobId: state.setSelectedJobId,
    setSelectedEvents: state.setSelectedEvents,
    selectedSeqRef: state.selectedSeqRef,
  });

  const selectedJobSummary = useMemo(() => {
    if (!state.selectedJob) return "No job selected";
    return `${state.selectedJob.kind} · ${state.selectedJob.status}`;
  }, [state.selectedJob]);

  return buildJobsWorkspaceResult({
    jobs: state.jobs,
    jobsLoading: state.jobsLoading,
    jobsError: state.jobsError,
    jobsStatusFilter: state.jobsStatusFilter,
    setJobsStatusFilter: state.setJobsStatusFilter,
    jobsKindFilter: state.jobsKindFilter,
    setJobsKindFilter: state.setJobsKindFilter,
    selectedJobId: state.selectedJobId,
    setSelectedJobId: state.setSelectedJobId,
    selectedJob: state.selectedJob,
    selectedJobSummary,
    selectedEvents: state.selectedEvents,
    streaming: state.streaming,
    loadJobs: loaders.loadJobs,
    cancelSelectedJob: mutations.cancelSelectedJob,
    rerunSelectedJob: mutations.rerunSelectedJob,
  });
}
