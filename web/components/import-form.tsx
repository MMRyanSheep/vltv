"use client";

import { ArrowUpRight, CheckCircle2, FileJson, FolderOpen, Upload } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { dateLabel, timeLabel } from "@/lib/archive";
import { REPLAY_MAX_BYTES, REPORT_MAX_BYTES } from "@/lib/import-limits";

type Receipt = { match_id: string; round_count: number; ssversion: string; played_at: string | null };
type Mode = "pair" | "directory";
type ReplayFailure = { file: File; message: string };
type ReplayBatch = { imported: number; failures: ReplayFailure[] };

async function readJson(file: File) {
  try {
    return JSON.parse(await file.text());
  } catch {
    throw new Error(`${file.name} 不是有效的 JSON 文件。`);
  }
}

export async function sendImport(body: File | string, contentType: string): Promise<Receipt> {
  const response = await fetch("/admin/api/import", {
    method: "POST", headers: { "Content-Type": contentType }, body,
  });
  const result = await response.json().catch(() => null);
  if (!response.ok) throw new Error(result?.error ?? `导入失败（HTTP ${response.status}）。`);
  if (!result?.match_id) throw new Error("未收到导入结果，请重试。");
  return result;
}

function FilePicker({ label, file, onChange }: {
  label: string; file: File | null; onChange: (file: File | null) => void;
}) {
  return <label className="file-picker">
    <FileJson size={23} className="accent" aria-hidden="true" />
    <span><strong>{label}</strong>{file && <small>{file.name}</small>}</span>
    <input type="file" accept=".json,application/json" onChange={(event) => onChange(event.target.files?.[0] ?? null)} />
  </label>;
}

export function ImportForm() {
  const [mode, setMode] = useState<Mode>("pair");
  const [summary, setSummary] = useState<File | null>(null);
  const [timeline, setTimeline] = useState<File | null>(null);
  const [directory, setDirectory] = useState<File[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [receipt, setReceipt] = useState<Receipt | null>(null);
  const [batch, setBatch] = useState<ReplayBatch | null>(null);
  const [progress, setProgress] = useState("");
  const replays = directory.filter((file) => /\.vrf$/i.test(file.name));
  const available = mode === "pair" ? Boolean(summary && timeline) : directory.length > 0;
  const finished = Boolean(receipt) || (batch !== null && batch.failures.length === 0);

  function resetStatus() {
    setReceipt(null);
    setBatch(null);
    setError("");
  }

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!available || busy || finished) return;
    setError("");
    setBusy(true);
    try {
      if (mode === "directory" && replays.length > 0) {
        const pending = batch?.failures.map(({ file }) => file) ?? replays;
        const failures: ReplayFailure[] = [];
        let imported = batch?.imported ?? 0;
        for (const [index, file] of pending.entries()) {
          setProgress(`正在上传和解析 ${index + 1}/${pending.length} · ${file.webkitRelativePath || file.name}`);
          try {
            if (file.size === 0) throw new Error("回放文件为空。");
            if (file.size > REPLAY_MAX_BYTES) throw new Error("单个回放超过 128 MiB。");
            await sendImport(file, "application/octet-stream");
            imported++;
          } catch (failure) {
            failures.push({ file, message: failure instanceof Error ? failure.message : "导入失败，请重试。" });
          }
        }
        setBatch({ imported, failures });
        return;
      }
      let report;
      if (mode === "pair" && summary && timeline) {
        if (summary.size + timeline.size > REPORT_MAX_BYTES) throw new Error("报告超过 8 MB。");
        report = { summary: await readJson(summary), timeline: await readJson(timeline) };
      } else {
        const root = directory[0]?.webkitRelativePath.split("/")[0];
        const summaryFile = directory.find((file) => file.webkitRelativePath === `${root}/json1.json`);
        const roundFiles = directory.filter((file) => file.webkitRelativePath.startsWith(`${root}/rounds/`) && file.name.endsWith(".json"));
        if (!summaryFile || roundFiles.length === 0) {
          throw new Error("请选择包含 .vrf 回放的文件夹，或包含 json1.json 和 rounds/ 的单场回放导出目录。");
        }
        if (roundFiles.reduce((size, file) => size + file.size, summaryFile.size) > REPORT_MAX_BYTES) {
          throw new Error("报告超过 8 MB。");
        }
        const metadata = await readJson(summaryFile);
        report = {
          summary: metadata,
          timeline: { match_id: metadata?.match_id, rounds: await Promise.all(roundFiles.map(readJson)) },
        };
      }
      const body = JSON.stringify(report);
      if (new Blob([body]).size > REPORT_MAX_BYTES) throw new Error("报告超过 8 MB。");
      setReceipt(await sendImport(body, "application/json"));
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : "导入失败，请重试。");
    } finally {
      setProgress("");
      setBusy(false);
    }
  }

  return <section className="import-panel" aria-label="导入比赛">
    <form onSubmit={submit}>
      <fieldset disabled={busy}>
        <legend className="sr-only">导入格式</legend>
        <div className="records-tabs import-tabs" role="group" aria-label="导入格式">
          <button type="button" aria-pressed={mode === "pair"} onClick={() => { setMode("pair"); resetStatus(); }}>报告文件</button>
          <button type="button" aria-pressed={mode === "directory"} onClick={() => { if (mode !== "directory") { setMode("directory"); resetStatus(); } }}>回放文件夹</button>
        </div>
        <div className="file-pickers">
          {mode === "pair" ? <>
            <FilePicker label="选择比赛摘要 JSON" file={summary}
              onChange={(file) => { setSummary(file); resetStatus(); }} />
            <FilePicker label="选择回合事件 JSON" file={timeline}
              onChange={(file) => { setTimeline(file); resetStatus(); }} />
          </> : <label className="file-picker">
            <FolderOpen size={23} className="accent" aria-hidden="true" />
            <span>
              <strong>选择回放文件夹</strong>
              {directory[0] && <small>{directory[0].webkitRelativePath.split("/")[0]}{replays.length > 0 && ` · ${replays.length} 个 .vrf 文件`}</small>}
            </span>
            <input type="file" {...{ webkitdirectory: "" }} multiple
              onChange={(event) => { setDirectory(Array.from(event.target.files ?? [])); event.target.value = ""; resetStatus(); }} />
          </label>}
        </div>
        <div className="import-actions">
          <button type="submit" className="button button-primary" disabled={!available || finished}>
            <Upload size={17} />{busy ? "正在导入…" : batch?.failures.length ? "重试失败文件" : "开始导入"}
          </button>
        </div>
      </fieldset>
      {progress && <p role="status">{progress}</p>}
      {error && <div className="form-error" role="alert">{error}</div>}
      {!busy && batch && <div role="status" className={batch.failures.length ? "form-error" : "form-success"}>
        {batch.failures.length === 0 && <CheckCircle2 size={21} className="accent" />}
        <span>已归档 {batch.imported}/{replays.length} 场比赛</span>
        {batch.failures.length > 0 && <ul>
          {batch.failures.map(({ file, message }) =>
            <li key={file.webkitRelativePath || file.name}>{file.webkitRelativePath || file.name} · {message}</li>,
          )}
        </ul>}
      </div>}
      {receipt && <div className="form-success" role="status">
        <CheckCircle2 size={21} className="accent" />
        <span>已归档 {receipt.round_count} 个回合 · SwingScore v {receipt.ssversion}
          {receipt.played_at && <> · 比赛时间 {dateLabel(receipt.played_at)} {timeLabel(receipt.played_at)}</>}
        </span>
        <Link href={`/matches/${receipt.match_id}`}>查看比赛 <ArrowUpRight size={16} /></Link>
      </div>}
    </form>
  </section>;
}
