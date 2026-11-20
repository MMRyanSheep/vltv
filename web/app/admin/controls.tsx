"use client";

import { ChevronRight, ImageIcon, Search } from "lucide-react";
import Link from "next/link";
import { useActionState, useState } from "react";
import { signIn } from "./actions";

export type Entry = { id: string; name: string | null; fallback: string; image?: string };

export function Login() {
  const [error, submit, pending] = useActionState(signIn, "");
  const [username, setUsername] = useState("");
  return <section className="admin-login" aria-labelledby="admin-login-title">
    <form action={submit} className="panel admin-form">
      <h1 id="admin-login-title">管理员登录</h1>
      <label>用户名<input name="username" autoComplete="username" required
        value={username} onChange={(event) => setUsername(event.target.value)} /></label>
      <label>密码<input name="password" type="password" autoComplete="current-password" required /></label>
      {error && <p className="admin-error" role="alert">{error}</p>}
      <button className="button button-primary" disabled={pending}>{pending ? "登录中…" : "登录"}</button>
      <Link className="admin-back" href="/">返回战绩站</Link>
    </form>
  </section>;
}

export function Entries({ entries, href }: { entries: Entry[]; href: string }) {
  const [search, setSearch] = useState("");
  const query = search.trim().toLowerCase();
  const visible = entries.filter(({ id, name, fallback }) =>
    [id, name ?? "", fallback].some((value) => value.toLowerCase().includes(query)));
  return <>
    {entries.length > 0 && <label className="admin-search"><Search size={16} aria-hidden="true" />
      <input type="search" aria-label="搜索记录" placeholder="搜索" value={search}
        onChange={(event) => setSearch(event.target.value)} />
    </label>}
    <ul className="admin-list">
      {visible.map(({ id, name, fallback }) => <li key={id}>
        <Link href={`${href}&edit=${encodeURIComponent(id)}`} prefetch={false}>
          <span>{name ?? fallback}</span><small>{id.length === 36 ? `#${id.slice(0, 8)}` : id}</small>
          <ChevronRight size={16} aria-hidden="true" />
        </Link>
      </li>)}
    </ul>
    {visible.length === 0 && <p className="admin-empty">{query ? "没有匹配的记录" : "暂无记录"}</p>}
  </>;
}

export function NameForm({ entry, action }: {
  entry: Entry; action: (error: string, form: FormData) => Promise<string>;
}) {
  const [error, submit, pending] = useActionState(action, "");
  const [name, setName] = useState(entry.name ?? "");
  return <form action={submit} className="admin-form">
    <label>显示名称<input name="name" value={name} maxLength={80} placeholder={entry.fallback}
      onChange={(event) => setName(event.target.value)} /></label>
    {error && <p className="admin-error" role="alert">{error}</p>}
    <button className="button button-primary" disabled={pending || name.trim() === (entry.name ?? "")}>
      {pending ? "保存中…" : "保存"}
    </button>
  </form>;
}

type ImageState = { error?: string; saved?: boolean };

export function ImageForm({ label, image, action, hideHint }: {
  label: string; image?: string; action: (state: ImageState, form: FormData) => Promise<ImageState>; hideHint?: boolean;
}) {
  const [state, submit, pending] = useActionState(action, {});
  return <form action={submit} className="admin-form admin-image-form">
    <div className="admin-image-preview">
      {image ? <img src={image} alt={`当前${label}`} /> : <ImageIcon size={24} aria-hidden="true" />}
    </div>
    <label>{label}<input name="image" type="file" accept="image/jpeg,image/png,image/webp" required disabled={pending}
      aria-describedby={hideHint ? undefined : "admin-image-requirements"} onChange={({ currentTarget }) => {
        const tooLarge = (currentTarget.files?.[0]?.size ?? 0) > 5 * 1024 * 1024;
        currentTarget.setCustomValidity(tooLarge ? "图片大小不能超过 5 MB" : "");
        if (tooLarge) currentTarget.reportValidity();
      }} /></label>
    {!hideHint && <p id="admin-image-requirements" className="admin-hint">JPG、PNG 或 WebP，最大 5 MB，宽高均不超过 4096 像素。</p>}
    {!pending && state.error && <p className="admin-error" role="alert">{state.error}</p>}
    {!pending && state.saved && <p className="accent" role="status">图片已保存</p>}
    <button className="button button-primary" disabled={pending}>{pending ? "上传中…" : "上传图片"}</button>
  </form>;
}
