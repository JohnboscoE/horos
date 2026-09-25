import { useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { api } from "../api";
import { DecisionCard, ErrorNote, Section } from "../ui/bits";

/** Public decision-log replay: every entry, its hash link, signature and verification. */
export function Log() {
  const [params] = useSearchParams();
  const decisionId = params.get("decision");
  const [log, setLog] = useState<any>(null);
  const [verify, setVerify] = useState<any>(null);
  const [replay, setReplay] = useState<any>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    api("/api/log").then(setLog).catch((e) => setErr(e.message));
    api("/api/log/verify").then(setVerify).catch(() => {});
    if (decisionId) api(`/api/decisions/${decisionId}/replay`).then(setReplay).catch((e) => setErr(e.message));
  }, [decisionId]);

  return (
    <div className="space-y-8">
      <ErrorNote error={err} />
      <div className="card flex flex-wrap items-center gap-4 text-sm">
        <div>
          <div className="label">Chain</div>
          {verify ? (verify.ok ? <span className="text-accent">verified · {verify.count} entries</span> : <span className="text-bad">broken at #{verify.brokenAt}: {verify.reason}</span>) : "…"}
        </div>
        <div className="min-w-0 flex-1">
          <div className="label">Head</div>
          <span className="mono">{log?.head?.head}</span>
        </div>
        <div className="min-w-0">
          <div className="label">Signer</div>
          <span className="mono">{log?.signer}</span>
        </div>
      </div>

      {replay && (
        <Section title="Replay">
          <DecisionCard d={replay.decision} />
          <div className="card space-y-2">
            <div className="label">Input snapshot (hash {replay.decision.input_snapshot_hash})</div>
            <pre className="mono max-h-80 overflow-auto whitespace-pre-wrap rounded bg-ink p-3">{JSON.stringify(replay.decision.input_snapshot, null, 2)}</pre>
          </div>
          {replay.log.map((e: any) => <Entry key={e.seq} e={e} />)}
        </Section>
      )}

      <Section title="All entries">
        {(log?.entries ?? []).slice().reverse().map((e: any) => <Entry key={e.seq} e={e} />)}
      </Section>
    </div>
  );
}

function Entry({ e }: { e: any }) {
  return (
    <details className="card">
      <summary className="flex cursor-pointer flex-wrap items-center gap-3 text-sm">
        <span className="font-mono text-muted">#{e.seq}</span>
        <span className="text-accent">{e.body.kind}</span>
        <span className="text-muted">{e.body.data?.decisionType ?? ""}</span>
        <a className="text-xs text-muted hover:text-accent" href={`/log?decision=${e.body.decisionId}`}>{e.body.decisionId}</a>
        <span className="ml-auto text-xs text-muted">{e.body.at}</span>
      </summary>
      <div className="mt-3 space-y-1">
        <div className="mono text-muted">prev {e.prevHash}</div>
        <div className="mono">hash {e.entryHash}</div>
        <div className="mono text-muted">sig {e.signature}</div>
        <pre className="mono mt-2 max-h-72 overflow-auto whitespace-pre-wrap rounded bg-ink p-3">{JSON.stringify(e.body.data, null, 2)}</pre>
      </div>
    </details>
  );
}
