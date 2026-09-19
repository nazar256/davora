import { useCallback, useRef } from "react";

import type { UploadSource } from "./model";
import { runUploadOrchestration, type UploadOrchestrationInput } from "./orchestration";
import type { UploadOrchestrationPorts } from "./orchestrationPorts";

export interface UseUploadInput {
  canUpload(): boolean;
  buildOrchestrationInput(
    files: readonly File[],
    source: UploadSource
  ): UploadOrchestrationInput<File> | undefined;
  ports: UploadOrchestrationPorts<File>;
}

export function useUpload(input: UseUploadInput) {
  const inputRef = useRef(input);
  inputRef.current = input;

  const uploadFiles = useCallback(async (files: FileList | File[] | null, source: UploadSource = "picker") => {
    if (!inputRef.current.canUpload() || !files || files.length === 0) {
      return;
    }
    const orchestrationInput = inputRef.current.buildOrchestrationInput(Array.from(files), source);
    if (!orchestrationInput) {
      return;
    }
    await runUploadOrchestration(orchestrationInput, inputRef.current.ports);
  }, []);

  return { uploadFiles };
}
