import { useCallback, useEffect, useMemo, useState } from "react";
import {
  checkHealth,
  clearOverride,
  resolveApiConfig,
  saveOverride,
  type HealthStatus,
  type KeyValueStore,
} from "../runtime-config/index.js";

interface Props {
  buildApiBaseUrl?: string;
  buildWebsocketUrl?: string;
  allowOverride: boolean;
}

type SocketState = "idle" | "connecting" | "open" | "failed";

function browserStore(): KeyValueStore | null {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

/**
 * Shows which backend this build talks to and lets a developer switch it
 * (localhost, LAN IP, Cloudflare tunnel, remote demo) without a rebuild.
 */
export function ConnectionPanel({ buildApiBaseUrl, buildWebsocketUrl, allowOverride }: Props) {
  const store = useMemo(browserStore, []);
  const initial = useMemo(
    () =>
      resolveApiConfig({
        search: window.location.search,
        store,
        buildApiBaseUrl,
        buildWebsocketUrl,
        allowOverride,
      }),
    [store, buildApiBaseUrl, buildWebsocketUrl, allowOverride],
  );

  const [config, setConfig] = useState(initial.config);
  const [pending, setPending] = useState(initial.pending);
  const [message, setMessage] = useState(initial.rejected ? `Ignored link: ${initial.rejected}` : "");
  const [draft, setDraft] = useState("");
  const [health, setHealth] = useState<HealthStatus | "checking">("checking");
  const [socket, setSocket] = useState<SocketState>("idle");

  const refresh = useCallback(async (apiBaseUrl: string) => {
    setHealth("checking");
    setHealth(await checkHealth(apiBaseUrl));
  }, []);

  useEffect(() => {
    void refresh(config.apiBaseUrl);
  }, [config, refresh]);

  function apply(rawUrl: string) {
    if (!store) {
      setMessage("This browser blocks local storage, so the backend cannot be changed here.");
      return;
    }
    try {
      setConfig(saveOverride(store, rawUrl));
      setPending(undefined);
      setDraft("");
      setMessage("");
      // Drop ?api= from the address bar so a reload does not ask again.
      window.history.replaceState(null, "", window.location.pathname);
    } catch (error) {
      setMessage((error as Error).message);
    }
  }

  function reset() {
    if (store) clearOverride(store);
    setConfig(resolveApiConfig({ store, buildApiBaseUrl, buildWebsocketUrl, allowOverride }).config);
    setMessage("Using the build default again.");
  }

  function testSocket() {
    setSocket("connecting");
    let settled = false;
    const ws = new WebSocket(config.websocketUrl);
    const timer = window.setTimeout(() => {
      if (!settled) {
        settled = true;
        setSocket("failed");
        ws.close();
      }
    }, 5000);
    ws.onopen = () => {
      settled = true;
      window.clearTimeout(timer);
      setSocket("open");
      ws.close();
    };
    ws.onerror = () => {
      if (settled) return;
      settled = true;
      window.clearTimeout(timer);
      setSocket("failed");
    };
  }

  return (
    <section className="panel" aria-labelledby="backend-title">
      <h2 id="backend-title">Backend</h2>

      {pending && (
        <div className="confirm" role="alertdialog" aria-labelledby="confirm-title">
          <p id="confirm-title">
            This link wants to send your requests to <code>{pending}</code>. Only continue if you started this
            backend or tunnel yourself.
          </p>
          <div className="row">
            <button onClick={() => apply(pending)}>Use this backend</button>
            <button className="secondary" onClick={() => setPending(undefined)}>
              Ignore
            </button>
          </div>
        </div>
      )}

      <dl className="facts">
        <dt>API</dt>
        <dd>
          <code>{config.apiBaseUrl}</code> <span className="tag">{config.source}</span>
        </dd>
        <dt>Live updates</dt>
        <dd>
          <code>{config.websocketUrl}</code>
        </dd>
        <dt>Status</dt>
        <dd>
          {health === "checking" && <span className="status">checking…</span>}
          {health !== "checking" && health.state === "up" && (
            <span className="status up">reachable · {health.latencyMs} ms</span>
          )}
          {health !== "checking" && health.state === "down" && (
            <span className="status down">not reachable · {health.reason}</span>
          )}
        </dd>
      </dl>

      <div className="row">
        <button className="secondary" onClick={() => void refresh(config.apiBaseUrl)}>
          Check again
        </button>
        <button className="secondary" onClick={testSocket} disabled={socket === "connecting"}>
          Test live connection
        </button>
        {socket === "open" && <span className="status up">WebSocket opened</span>}
        {socket === "failed" && <span className="status down">WebSocket failed</span>}
      </div>

      {allowOverride && (
        <form
          className="row"
          onSubmit={(event) => {
            event.preventDefault();
            apply(draft);
          }}
        >
          <label className="sr-only" htmlFor="api-url">
            Backend URL
          </label>
          <input
            id="api-url"
            placeholder="https://your-tunnel.trycloudflare.com or http://192.168.1.20:8080"
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
          />
          <button type="submit" disabled={!draft.trim()}>
            Switch
          </button>
          {config.source === "override" && (
            <button type="button" className="secondary" onClick={reset}>
              Reset
            </button>
          )}
        </form>
      )}
      {message && <p className="message">{message}</p>}
    </section>
  );
}
