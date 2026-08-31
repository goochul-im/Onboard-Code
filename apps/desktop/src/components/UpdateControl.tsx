import { isTauri } from "@tauri-apps/api/core";
import { relaunch } from "@tauri-apps/plugin-process";
import { check, type Update } from "@tauri-apps/plugin-updater";
import { useCallback, useEffect, useRef, useState } from "react";
import { formatUpdateProgress } from "./updateProgress";

type UpdateState =
  | { status: "checking" | "current" }
  | { status: "available"; version: string }
  | { status: "installing"; label: string }
  | { status: "error" };

export function UpdateControl() {
  const [state, setState] = useState<UpdateState>({ status: "checking" });
  const update = useRef<Update | null>(null);
  const checkSequence = useRef(0);

  const checkForUpdate = useCallback(async () => {
    if (!isTauri()) {
      setState({ status: "current" });
      return;
    }
    const sequence = ++checkSequence.current;
    setState({ status: "checking" });
    try {
      await update.current?.close();
      const result = await check({ timeout: 15_000 });
      if (sequence !== checkSequence.current) {
        await result?.close();
        return;
      }
      update.current = result;
      setState(update.current
        ? { status: "available", version: update.current.version }
        : { status: "current" });
    } catch (error) {
      console.warn("업데이트를 확인하지 못했습니다.", error);
      setState({ status: "error" });
    }
  }, []);

  useEffect(() => {
    void checkForUpdate();
    return () => {
      checkSequence.current += 1;
      void update.current?.close();
    };
  }, [checkForUpdate]);

  const installUpdate = async () => {
    const nextUpdate = update.current;
    if (!nextUpdate) return;
    let downloaded = 0;
    let total = 0;
    setState({ status: "installing", label: formatUpdateProgress(nextUpdate.version, 0, 0) });
    try {
      await nextUpdate.downloadAndInstall((event) => {
        if (event.event === "Started") total = event.data.contentLength ?? 0;
        if (event.event === "Progress") downloaded += event.data.chunkLength;
        setState({
          status: "installing",
          label: formatUpdateProgress(nextUpdate.version, downloaded, total),
        });
      });
      await relaunch();
    } catch (error) {
      console.error("업데이트를 설치하지 못했습니다.", error);
      setState({ status: "error" });
    }
  };

  if (state.status === "checking" || state.status === "current") return null;
  if (state.status === "error") return null;
  if (state.status === "installing") {
    return <button className="secondary-button small update-button" type="button" disabled>{state.label}</button>;
  }
  if (state.status !== "available") return null;
  return (
    <button className="secondary-button small update-button" type="button" onClick={() => void installUpdate()}>
      v{state.version} 업데이트
    </button>
  );
}
