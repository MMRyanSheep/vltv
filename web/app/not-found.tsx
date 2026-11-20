import Link from "next/link";

export default function NotFound() {
  return <section className="panel status-panel">
    <h1>未找到记录</h1>
    <p>这场比赛或选手尚未归档，或链接有误。</p>
    <Link className="button button-primary" href="/">返回战绩总览</Link>
  </section>;
}
