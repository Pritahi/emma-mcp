"use client";

import { FormEvent, KeyboardEvent, useEffect, useMemo, useState } from "react";
import type { ComputeIntent, PlannedOffer, ProvisionedVm, SshKeySummary, SourceMode } from "@/lib/types";

type AppStatus = { mode: SourceMode | "unconfigured" | "locked"; status: string; providerCount: number; message: string };
type AccessStatus = { required: boolean; authorized: boolean; configured: boolean; message: string };
type PlanResponse = { mode: SourceMode; intent: ComputeIntent; offers: PlannedOffer[]; matchCount: number; catalogCount: number; note: string };

const EXAMPLE_PROMPT = "Find a 4-core, 16 GB VM in Europe for under $0.05/hr — I want to run a Python service.";

async function api<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, { ...init, credentials: "same-origin", headers: { "Content-Type": "application/json", ...init?.headers } });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(typeof payload.error === "string" ? payload.error : `Request failed (${response.status})`);
  return payload as T;
}

async function loadWorkspaceData() {
  const [status, keyResult] = await Promise.all([
    api<AppStatus>("/api/status"),
    api<{ keys: SshKeySummary[] }>("/api/ssh-keys"),
  ]);
  return { status, keys: keyResult.keys };
}

function Icon({ name, size = 18 }: { name: string; size?: number }) {
  const common = { width: size, height: size, viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", strokeWidth: 1.8, strokeLinecap: "round" as const, strokeLinejoin: "round" as const, "aria-hidden": true as const };
  const paths: Record<string, React.ReactNode> = {
    spark: <><path d="m12 3 1.7 5.3L19 10l-5.3 1.7L12 17l-1.7-5.3L5 10l5.3-1.7L12 3Z" /><path d="m19 16 .8 2.2L22 19l-2.2.8L19 22l-.8-2.2L16 19l2.2-.8L19 16Z" /></>,
    grid: <><rect x="3.5" y="3.5" width="7" height="7" rx="1.5" /><rect x="13.5" y="3.5" width="7" height="7" rx="1.5" /><rect x="3.5" y="13.5" width="7" height="7" rx="1.5" /><rect x="13.5" y="13.5" width="7" height="7" rx="1.5" /></>,
    box: <><path d="m12 3 9 5-9 5-9-5 9-5Z" /><path d="m3 8 9 5 9-5" /><path d="M3 8v9l9 5 9-5V8" /><path d="M12 13v9" /></>,
    key: <><circle cx="8" cy="15" r="4" /><path d="m11 12 8-8 2 2-2 2 2 2-3 3-2-2-2 2" /></>,
    arrow: <><path d="M5 12h14" /><path d="m13 6 6 6-6 6" /></>,
    down: <><path d="m6 9 6 6 6-6" /></>,
    check: <path d="m5 12 4 4L19 6" />,
    close: <><path d="m18 6-12 12" /><path d="m6 6 12 12" /></>,
    copy: <><rect x="8" y="8" width="12" height="12" rx="2" /><path d="M16 8V5a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h3" /></>,
    terminal: <><path d="m4 17 5-5-5-5" /><path d="M12 19h8" /></>,
    clock: <><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 2" /></>,
    cloud: <><path d="M7 18h10a4 4 0 0 0 .3-8A6 6 0 0 0 6 9.5 4.3 4.3 0 0 0 7 18Z" /></>,
    chevron: <path d="m9 18 6-6-6-6" />,
    shield: <><path d="M12 3 20 6v5c0 5-3.4 8.4-8 10-4.6-1.6-8-5-8-10V6l8-3Z" /><path d="m9 12 2 2 4-4" /></>,
    globe: <><circle cx="12" cy="12" r="9" /><path d="M3 12h18" /><path d="M12 3a14 14 0 0 1 0 18 14 14 0 0 1 0-18Z" /></>,
  };
  return <svg {...common}>{paths[name] ?? paths.spark}</svg>;
}

function ProviderMark({ name }: { name: string }) {
  const initials = name.split(/[\s-]+/).filter(Boolean).map((part) => part[0]).join("").slice(0, 2).toUpperCase();
  const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, "-");
  return <div className={`provider-mark provider-${slug}`} aria-hidden="true">{initials || "C"}</div>;
}

function StatPill({ icon, children }: { icon: string; children: React.ReactNode }) {
  return <span className="stat-pill"><Icon name={icon} size={14} />{children}</span>;
}

export default function Home() {
  const [status, setStatus] = useState<AppStatus | null>(null);
  const [accessGate, setAccessGate] = useState(false);
  const [accessConfigured, setAccessConfigured] = useState(true);
  const [accessMessage, setAccessMessage] = useState("");
  const [accessPassword, setAccessPassword] = useState("");
  const [accessError, setAccessError] = useState("");
  const [loggingIn, setLoggingIn] = useState(false);
  const [prompt, setPrompt] = useState(EXAMPLE_PROMPT);
  const [searching, setSearching] = useState(false);
  const [plan, setPlan] = useState<PlanResponse | null>(null);
  const [selected, setSelected] = useState<PlannedOffer | null>(null);
  const [sshKeys, setSshKeys] = useState<SshKeySummary[]>([]);
  const [sshKeyId, setSshKeyId] = useState<string>("");
  const [loadingKeys, setLoadingKeys] = useState(true);
  const [searchError, setSearchError] = useState("");
  const [showConfirm, setShowConfirm] = useState(false);
  const [confirmedCharge, setConfirmedCharge] = useState(false);
  const [provisioning, setProvisioning] = useState(false);
  const [vm, setVm] = useState<ProvisionedVm | null>(null);
  const [provisionError, setProvisionError] = useState("");
  const [showKeyForm, setShowKeyForm] = useState(false);
  const [keyName, setKeyName] = useState("showcase-key");
  const [publicKey, setPublicKey] = useState("");
  const [addingKey, setAddingKey] = useState(false);
  const [keyError, setKeyError] = useState("");
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const access = await api<AccessStatus>("/api/access");
        if (!alive) return;
        setAccessConfigured(access.configured);
        setAccessMessage(access.message);
        if (access.required && !access.authorized) {
          setAccessGate(true);
          setStatus({ mode: "locked", status: "locked", providerCount: 0, message: access.message });
          setLoadingKeys(false);
          return;
        }
        const workspace = await loadWorkspaceData();
        if (!alive) return;
        setStatus(workspace.status);
        setSshKeys(workspace.keys);
        if (workspace.keys[0]) setSshKeyId(String(workspace.keys[0].id));
      } catch (error) {
        if (alive) setStatus({ mode: "unconfigured", status: "error", providerCount: 0, message: error instanceof Error ? error.message : "Could not load workspace." });
      } finally {
        if (alive) setLoadingKeys(false);
      }
    })();
    return () => { alive = false; };
  }, []);

  const isConnected = status?.mode === "live" && status.status === "connected";
  const selectedKey = sshKeys.find((key) => String(key.id) === sshKeyId);
  const sourceLabel = isConnected ? "LIVE CATALOG" : status?.mode === "locked" ? "LOCKED" : status?.mode === "live" ? "CONNECTION ERROR" : status?.mode === "unconfigured" ? "NOT CONNECTED" : "PREVIEW DATA";
  const estimatedMonthly = selected?.cost?.perHour !== undefined
    ? `${new Intl.NumberFormat("en-US", { style: "currency", currency: selected.cost.currency || "USD", maximumFractionDigits: 2 }).format(selected.cost.perHour * 730)} / mo`
    : selected?.monthlyLabel || "Price shown by emma";

  const resultsSummary = useMemo(() => {
    if (!plan) return "Your request will be checked against every connected provider.";
    return plan.mode === "live"
      ? `${plan.matchCount} matching configuration${plan.matchCount === 1 ? "" : "s"} in emma’s live catalog.`
      : `${plan.matchCount} matching sample offer${plan.matchCount === 1 ? "" : "s"} · no cloud account is connected.`;
  }, [plan]);

  async function unlockWorkspace(event: FormEvent) {
    event.preventDefault();
    setLoggingIn(true);
    setAccessError("");
    try {
      await api<{ authorized: boolean }>("/api/access", { method: "POST", body: JSON.stringify({ password: accessPassword }) });
      const workspace = await loadWorkspaceData();
      setStatus(workspace.status);
      setSshKeys(workspace.keys);
      setSshKeyId(workspace.keys[0] ? String(workspace.keys[0].id) : "");
      setAccessPassword("");
      setAccessGate(false);
    } catch (error) {
      setAccessError(error instanceof Error ? error.message : "Could not unlock this workspace.");
    } finally {
      setLoggingIn(false);
    }
  }

  async function runSearch(event?: FormEvent, promptOverride?: string) {
    event?.preventDefault();
    const searchPrompt = promptOverride ?? prompt;
    setSearching(true);
    setSearchError("");
    setProvisionError("");
    setVm(null);
    setPlan(null);
    setSelected(null);
    try {
      const result = await api<PlanResponse>("/api/plan", { method: "POST", body: JSON.stringify({ prompt: searchPrompt }) });
      setPlan(result);
      setSelected(result.offers[0] ?? null);
      if (!result.offers.length) setSearchError("No matching offers. Try easing the location, budget, or minimum resource requirements.");
    } catch (error) {
      setSearchError(error instanceof Error ? error.message : "Could not search the catalog.");
    } finally {
      setSearching(false);
    }
  }

  function onPromptKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if ((event.metaKey || event.ctrlKey) && event.key === "Enter") void runSearch();
  }

  async function addSshKey(event: FormEvent) {
    event.preventDefault();
    setAddingKey(true);
    setKeyError("");
    try {
      const result = await api<{ key: SshKeySummary }>("/api/ssh-keys", {
        method: "POST",
        body: JSON.stringify({ name: keyName, publicKey }),
      });
      setSshKeys((current) => [result.key, ...current.filter((key) => String(key.id) !== String(result.key.id))]);
      setSshKeyId(String(result.key.id));
      setPublicKey("");
      setShowKeyForm(false);
    } catch (error) {
      setKeyError(error instanceof Error ? error.message : "Could not import this key.");
    } finally {
      setAddingKey(false);
    }
  }

  async function launchVm() {
    if (!selected) return;
    if (!selectedKey) {
      setProvisionError("Choose or import an SSH key before launch.");
      setShowConfirm(false);
      return;
    }
    setProvisioning(true);
    setProvisionError("");
    setShowConfirm(false);
    setConfirmedCharge(false);
    try {
      const result = await api<{ vm: ProvisionedVm }>("/api/provision", {
        method: "POST",
        body: JSON.stringify({ planToken: selected.planToken, sshKeyId: selectedKey.id, name: plan?.intent.name ?? "emma-dev-box", confirmed: true }),
      });
      setVm(result.vm);
      window.setTimeout(() => document.getElementById("result-card")?.scrollIntoView({ behavior: "smooth", block: "center" }), 80);
    } catch (error) {
      setProvisionError(error instanceof Error ? error.message : "Could not provision this machine.");
    } finally {
      setProvisioning(false);
    }
  }

  async function copyCommand() {
    if (!vm?.sshCommand) return;
    try {
      await navigator.clipboard.writeText(vm.sshCommand);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1600);
    } catch { setCopied(false); }
  }

  function startExample() {
    setPrompt(EXAMPLE_PROMPT);
    void runSearch(undefined, EXAMPLE_PROMPT);
  }

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <a className="brand" href="#top" aria-label="emma-mcp home">
          <span className="brand-mark"><Icon name="spark" size={21} /></span>
          <span className="brand-name">emma<span className="brand-dot">.</span><small>mcp</small></span>
        </a>
        <div className="workspace-switcher">
          <span className="workspace-glyph">e</span>
          <span className="workspace-text"><b>emma workspace</b><small>{isConnected ? "Connected project" : status?.mode === "locked" ? "Locked live project" : "Preview project"}</small></span>
          <Icon name="down" size={14} />
        </div>
        <div className="nav-label">WORKSPACE</div>
        <nav className="side-nav" aria-label="Main navigation">
          <a className="nav-item active" href="#launchpad"><Icon name="spark" size={17} /><span>Launchpad</span><span className="nav-count">01</span></a>
          <a className="nav-item" href="#matches"><Icon name="globe" size={17} /><span>Cloud matches</span></a>
          <a className="nav-item" href="#result-card"><Icon name="box" size={17} /><span>Recent launches</span></a>
        </nav>
        <div className="nav-label integrations-label">INTEGRATIONS</div>
        <div className="integration-card">
          <div className="integration-icon"><Icon name="cloud" size={17} /></div>
          <div className="integration-copy"><b>emma API</b><small>{isConnected ? `${status.providerCount} providers connected` : "Connect to go live"}</small></div>
          <span className={`connection-dot ${isConnected ? "connected" : "preview"}`} />
        </div>
        <div className="sidebar-spacer" />
        <div className="sidebar-note">
          <div className="note-icon"><Icon name="shield" size={16} /></div>
          <div><b>Nothing runs by surprise.</b><p>Every launch is reviewed before emma provisions it.</p></div>
        </div>
        <div className="profile-row">
          <div className="avatar">AL</div>
          <div className="profile-copy"><b>Alex Lee</b><small>Builder workspace</small></div>
          <button className="icon-button profile-menu" aria-label="Profile menu"><span>···</span></button>
        </div>
      </aside>

      <main className="main-area" id="top">
        <header className="topbar">
          <div className="breadcrumbs"><span>Compute</span><Icon name="chevron" size={14} /><b>Launchpad</b></div>
          <div className="topbar-right">
            <div className={`api-status ${isConnected ? "is-live" : "is-demo"}`}>
              <span className="status-pulse" />
              {isConnected ? "emma connected" : status?.mode === "locked" ? "live workspace locked" : status?.mode === "live" ? "emma connection error" : status?.mode === "unconfigured" ? "emma not connected" : "demo environment"}
            </div>
            <button className="help-button" onClick={() => document.getElementById("how-it-works")?.scrollIntoView({ behavior: "smooth" })}>How it works <Icon name="arrow" size={14} /></button>
          </div>
        </header>

        <div className="content-wrap">
          <section className="hero" id="launchpad">
            <div className="hero-copy">
              <div className="eyebrow"><span className="eyebrow-line" /> MULTI-CLOUD COMPUTE, WITHOUT THE TAB TOUR</div>
              <h1>Tell us what to build.<br /><em>We’ll find where.</em></h1>
              <p className="hero-lede">One prompt. Every connected cloud. Compare real capacity and cost, then approve an exact machine to launch through emma.</p>
              <div className="hero-footnote"><span className="live-dot" /> {isConnected ? `${status.providerCount || "Multiple"} providers connected through emma` : status?.mode === "live" ? "emma connection needs attention · check server credentials" : status?.mode === "locked" ? "Private live workspace · unlock to continue" : "Preview mode is ready · connect emma for live provisioning"}<span className="footnote-divider" /> <Icon name="shield" size={14} /> Human-approved launches</div>
            </div>
            <div className="hero-art" aria-hidden="true">
              <div className="orbit orbit-a" /><div className="orbit orbit-b" /><div className="orbit orbit-c" />
              <div className="orbit-core"><span className="core-symbol"><Icon name="spark" size={29} /></span></div>
              <span className="orbit-node node-a">AWS</span><span className="orbit-node node-b">GCP</span><span className="orbit-node node-c">AZ</span><span className="orbit-node node-d">OVH</span>
              <span className="art-caption">one intent · many clouds</span>
            </div>
          </section>

          <section className="workbench" aria-label="Prompt to virtual machine">
            <div className="workbench-main">
              <div className="section-kicker"><span className="step-number">01</span><span>DESCRIBE THE RESULT</span><span className="kicker-rule" /><span className="micro-badge"><span className="tiny-spark">✳</span> Prompt compiler</span></div>
              <form className="prompt-card" onSubmit={runSearch}>
                <div className="prompt-card-top"><span className="prompt-label"><Icon name="terminal" size={16} /> YOUR REQUEST</span><span className="prompt-hint">Plain English is enough</span></div>
                <textarea aria-label="Describe the machine you need" value={prompt} onChange={(event) => setPrompt(event.target.value)} onKeyDown={onPromptKeyDown} maxLength={500} placeholder="e.g. Spin up a Python dev box in Germany with at least 8 GB RAM…" />
                <div className="prompt-card-bottom">
                  <div className="prompt-chips"><span className="prompt-chip"><span className="chip-dot" /> region-aware</span><span className="prompt-chip"><span className="chip-dot mint" /> cost-ranked</span><span className="prompt-chip"><span className="chip-dot blue" /> emma-native</span></div>
                  <span className="shortcut">⌘ ↵</span>
                </div>
                {searchError && <div className="inline-error"><span>!</span>{searchError}</div>}
                <div className="prompt-action-row">
                  <button type="button" className="example-link" onClick={startExample}>Use the 90-second demo prompt <Icon name="arrow" size={14} /></button>
                  <button className="primary-button" type="submit" disabled={searching || prompt.trim().length < 8}>
                    {searching ? <><span className="button-spinner" /> Scanning emma…</> : <>Find my best match <Icon name="arrow" size={17} /></>}
                  </button>
                </div>
              </form>

              <div className="results-head" id="matches">
                <div><div className="section-kicker results-kicker"><span className="step-number">02</span><span>COMPARE THE REAL OPTIONS</span></div><h2>Cloud matches <span className={`source-tag ${plan?.mode === "live" ? "live" : "demo"}`}>{plan ? (plan.mode === "live" ? "LIVE CATALOG" : "DEMO DATA") : sourceLabel}</span></h2><p>{resultsSummary}</p></div>
                {plan && <div className="catalog-count"><b>{plan.catalogCount}</b><span>configurations<br />checked</span><span className="count-divider" /><b>{plan.offers.length.toString().padStart(2, "0")}</b><span>best fits<br />shown</span></div>}
              </div>

              {plan ? (
                plan.offers.length ? <div className="offer-list">
                  <div className="offer-list-header"><span>PROVIDER / LOCATION</span><span>COMPUTE</span><span>PRICE / HR</span><span /></div>
                  {plan.offers.map((offer, index) => (
                    <button className={`offer-row ${selected?.id === offer.id ? "selected" : ""}`} key={`${offer.id}-${index}`} onClick={() => { setSelected(offer); setVm(null); setProvisionError(""); }}>
                      <span className="offer-rank">{String(index + 1).padStart(2, "0")}</span>
                      <ProviderMark name={offer.providerName} />
                      <span className="offer-provider"><b>{offer.providerName}</b><small>{offer.regionLabel || offer.locationName}</small></span>
                      <span className="offer-compute"><b>{offer.vCpu} <small>vCPU</small></b><b>{offer.ramGb} <small>GB RAM</small></b><small>{offer.volumeGb} GB {offer.volumeType}</small></span>
                      <span className="offer-price"><b>{offer.hourlyLabel.replace("/hr", "")}</b><small>/ hour</small><em>{offer.monthlyLabel}</em></span>
                      <span className="offer-select" aria-label={`Select ${offer.providerName}`}><Icon name={selected?.id === offer.id ? "check" : "arrow"} size={16} /></span>
                    </button>
                  ))}
                  <div className="offer-list-foot"><Icon name="clock" size={14} /> Pricing is provider-reported and may change before deployment. {plan.mode === "demo" && <b> Sample prices — not live quotes.</b>}</div>
                </div> : <div className="empty-state"><div className="empty-icon"><Icon name="globe" size={22} /></div><b>No exact match this time.</b><p>Try a wider region, a higher budget, or fewer minimum resources. This app won’t quietly lower your requirements.</p></div>
              ) : (
                <div className="waiting-card"><div className="waiting-icon"><Icon name="globe" size={21} /></div><div><b>Waiting on your prompt</b><p>emma will check available locations, configurations and costs in one pass.</p></div><div className="waiting-steps"><span /><span /><span /></div></div>
              )}

              <section className="how-section" id="how-it-works">
                <div className="section-kicker"><span className="step-number">03</span><span>THE RUNWAY</span><span className="kicker-rule" /></div>
                <div className="how-grid"><div className="how-item"><span className="how-index">A</span><b>Compile the ask</b><p>Natural language becomes a concrete CPU, memory, region and cost floor.</p></div><div className="how-item"><span className="how-index">B</span><b>Compare across clouds</b><p>emma’s connected catalog becomes one ranked shortlist—not ten console tabs.</p></div><div className="how-item"><span className="how-index">C</span><b>Approve, then boot</b><p>A signed plan keeps the exact reviewed configuration attached to the launch.</p></div></div>
              </section>
            </div>

            <aside className="launch-panel" aria-label="Launch preview">
              <div className="panel-topline"><span><span className="panel-led" /> LAUNCH PREVIEW</span><button className="more-button" aria-label="More launch options">···</button></div>
              {selected ? (
                <>
                  <div className="selected-overline"><span className="selected-kicker">BEST FIT</span><span className="selected-score"><Icon name="spark" size={13} /> LOWEST MATCH</span></div>
                  <div className="selected-provider"><ProviderMark name={selected.providerName} /><div><h3>{selected.providerName}</h3><span><Icon name="globe" size={13} /> {selected.regionLabel || selected.locationName}</span></div></div>
                  <div className="vm-name-row"><span>VM NAME</span><b>{plan?.intent.name ?? "emma-dev-box"}</b></div>
                  <div className="selected-specs"><div><span>CPU</span><b>{selected.vCpu} <small>vCPU</small></b></div><div><span>MEMORY</span><b>{selected.ramGb} <small>GB</small></b></div><div><span>SYSTEM DISK</span><b>{selected.volumeGb} <small>GB {selected.volumeType}</small></b></div><div><span>OS IMAGE</span><b>{selected.osType ?? "Linux"} <small>{selected.osVersion ?? ""}</small></b></div><div><span>NETWORK</span><b>{selected.cloudNetworkTypes.find((type) => /isolat/i.test(type)) ?? selected.cloudNetworkTypes[0] ?? "—"}</b></div></div>
                  <div className="cost-box"><div><span>ESTIMATED COST</span><b>{selected.hourlyLabel}</b></div><span className="cost-cycle">{estimatedMonthly}</span></div>
                  <div className="field-group"><label htmlFor="ssh-key">SSH KEY</label><div className="select-wrap"><Icon name="key" size={15} /><select id="ssh-key" value={sshKeyId} onChange={(event) => setSshKeyId(event.target.value)} disabled={loadingKeys || sshKeys.length === 0}>
                    {loadingKeys && <option value="">Loading SSH keys…</option>}
                    {!loadingKeys && !sshKeys.length && <option value="">No keys imported</option>}
                    {sshKeys.map((key) => <option value={String(key.id)} key={String(key.id)}>{key.name}{key.source === "demo" ? " · preview" : ""}</option>)}
                  </select><Icon name="down" size={14} /></div>
                    <button className="text-action" onClick={() => { setKeyError(""); setShowKeyForm(true); }}><span>+</span> Import a public key</button>
                  </div>
                  <div className="plan-id-row"><span><span className="mini-lock"><Icon name="shield" size={12} /></span>Signed plan · 3 min validity</span><span className="plan-status"><span /> {selected.source === "live" ? "LIVE" : "PREVIEW"}</span></div>
                  {provisionError && <div className="inline-error panel-error"><span>!</span>{provisionError}</div>}
                  <button className="launch-button" onClick={() => { setConfirmedCharge(false); setShowConfirm(true); }} disabled={provisioning || !selectedKey}>
                    {provisioning ? <><span className="button-spinner dark" /> Creating on emma…</> : <>Review launch <Icon name="arrow" size={16} /></>}
                  </button>
                  <p className="launch-footnote"><Icon name="shield" size={13} /> {selected.source === "live" ? "Nothing changes until you confirm." : "Preview only · no cloud resources will be created."}</p>
                  {vm && <div className={`success-card ${vm.mode === "demo" ? "is-demo" : ""}`} id="result-card">
                    <div className="success-heading"><span className="success-icon"><Icon name="check" size={15} /></span><div><b>{vm.mode === "demo" ? "Demo run complete" : "Launch request sent"}</b><small>{vm.mode === "demo" ? "SIMULATED · NO RESOURCE CREATED" : `${vm.status.toUpperCase()} · EMMA API`}</small></div></div>
                    <div className="success-meta"><span>{vm.name}</span><span>#{vm.id}</span></div>
                    <div className="ssh-command"><code>{vm.sshCommand || `emma vm ${vm.id}`}</code>{vm.sshCommand && <button onClick={copyCommand} aria-label="Copy SSH command"><Icon name={copied ? "check" : "copy"} size={15} /></button>}</div>
                    <p>{vm.message}</p>
                  </div>}
                </>
              ) : (
                <div className="panel-empty"><div className="empty-illustration"><div className="illustration-ring" /><div className="illustration-core"><Icon name="box" size={24} /></div><span className="illustration-dot d1" /><span className="illustration-dot d2" /></div><h3>Your launch starts here.</h3><p>Search for a machine, compare the live options, then review the one you want to build.</p><div className="empty-trust"><Icon name="shield" size={14} /> Nothing provisions without your approval.</div></div>
              )}
              <div className="panel-footer"><div className="footer-emma-mark"><Icon name="spark" size={13} /> POWERED BY EMMA</div><span>INFRASTRUCTURE-AS-PROMPT</span></div>
            </aside>
          </section>

          <footer className="page-footer"><span><b>emma-mcp</b> · Open-source showcase</span><span><span className="footer-dot" /> {isConnected ? "Live connection" : status?.mode === "locked" ? "Live workspace locked" : "Preview environment"}</span><a href="https://docs.emma.ms/docs/platform/integrations/developer-api/" target="_blank" rel="noreferrer">emma API docs <Icon name="arrow" size={12} /></a></footer>
        </div>
      </main>

      {accessGate && <div className="modal-backdrop access-backdrop"><form className="modal-card access-modal" onSubmit={unlockWorkspace}>
        <div className="modal-head"><span className="modal-symbol"><Icon name="shield" size={20} /></span></div>
        <span className="modal-eyebrow">PRIVATE LIVE WORKSPACE</span>
        <h2>{accessConfigured ? "Unlock the launchpad." : "Live access is locked."}</h2>
        <p className="modal-intro">{accessConfigured ? "This deployment uses live emma credentials. Enter the workspace launch password to view provider data and use launch controls." : accessMessage}</p>
        {accessConfigured ? <>
          <label className="form-label" htmlFor="launch-password">Workspace password</label>
          <input id="launch-password" className="form-input" type="password" autoComplete="current-password" value={accessPassword} onChange={(event) => setAccessPassword(event.target.value)} required autoFocus />
          {accessError && <div className="inline-error"><span>!</span>{accessError}</div>}
          <div className="modal-actions access-actions"><button className="modal-primary" type="submit" disabled={loggingIn || !accessPassword}>{loggingIn ? "Unlocking…" : <>Unlock launchpad <Icon name="arrow" size={15} /></>}</button></div>
        </> : <div className="key-safety"><Icon name="shield" size={14} /> Configure APP_PASSWORD on the server, then reload.</div>}
        <div className="modal-safe-note"><Icon name="shield" size={13} /> Cloud credentials stay server-side; sessions expire after 8 hours.</div>
      </form></div>}

      {showConfirm && selected && <div className="modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) setShowConfirm(false); }}>
        <div className="modal-card" role="dialog" aria-modal="true" aria-labelledby="confirm-title">
          <div className="modal-head"><span className="modal-symbol"><Icon name="shield" size={20} /></span><button className="icon-button" onClick={() => setShowConfirm(false)} aria-label="Close confirmation"><Icon name="close" size={18} /></button></div>
          <span className="modal-eyebrow">FINAL CHECK · {selected.source === "live" ? "LIVE INFRASTRUCTURE" : "PREVIEW RUN"}</span>
          <h2 id="confirm-title">{selected.source === "live" ? "Ready to create this VM?" : "Run the preview?"}</h2>
          <p className="modal-intro">This is the exact configuration emma will receive. {selected.source === "live" ? "Creating a resource may incur charges from your cloud provider." : "This run is simulated and will not create a real cloud resource."}</p>
          <div className="confirmation-summary"><div className="confirm-provider"><ProviderMark name={selected.providerName} /><div><b>{selected.providerName}</b><small>{selected.regionLabel || selected.locationName}</small></div><span className="confirm-cost">{selected.hourlyLabel}</span></div><div className="confirm-facts"><span>{plan?.intent.name ?? "emma-dev-box"}</span><span>{selected.vCpu} vCPU</span><span>{selected.ramGb} GB RAM</span><span>{selected.volumeGb} GB {selected.volumeType}</span><span>{selected.osType ?? "Linux"} {selected.osVersion ?? ""}</span><span>{selected.cloudNetworkTypes.find((type) => /isolat/i.test(type)) ?? selected.cloudNetworkTypes[0] ?? "—"} network</span><span>{selectedKey?.name || "No SSH key"}</span></div></div>
          <label className="confirmation-check"><input type="checkbox" checked={confirmedCharge} onChange={(event) => setConfirmedCharge(event.target.checked)} /><span className="custom-check"><Icon name="check" size={12} /></span><span>{selected.source === "live" ? "I reviewed the provider, region, size and estimated price. Proceed." : "I understand this is a simulated result."}</span></label>
          <div className="modal-actions"><button className="cancel-button" onClick={() => setShowConfirm(false)}>Go back</button><button className="modal-primary" onClick={() => void launchVm()} disabled={!confirmedCharge || provisioning}>{provisioning ? "Working…" : selected.source === "live" ? <>Create VM through emma <Icon name="arrow" size={15} /></> : <>Run preview <Icon name="arrow" size={15} /></>}</button></div>
          <div className="modal-safe-note"><Icon name="shield" size={13} /> {selected.source === "live" ? "Your client secret never leaves the server." : "Demo data is clearly labeled; no credentials are used."}</div>
        </div>
      </div>}

      {showKeyForm && <div className="modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) setShowKeyForm(false); }}>
        <form className="modal-card key-modal" onSubmit={addSshKey}>
          <div className="modal-head"><span className="modal-symbol"><Icon name="key" size={20} /></span><button type="button" className="icon-button" onClick={() => setShowKeyForm(false)} aria-label="Close key import"><Icon name="close" size={18} /></button></div>
          <span className="modal-eyebrow">SSH ACCESS</span><h2>Import a public key.</h2><p className="modal-intro">Only the public half goes to emma. Keep your private key on your machine.</p>
          <label className="form-label" htmlFor="key-name">Key name</label><input id="key-name" className="form-input" value={keyName} onChange={(event) => setKeyName(event.target.value)} maxLength={80} required />
          <label className="form-label" htmlFor="public-key">OpenSSH public key</label><textarea id="public-key" className="form-input public-key-input" value={publicKey} onChange={(event) => setPublicKey(event.target.value)} placeholder="ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAA… your-laptop" required />
          <div className="key-safety"><Icon name="shield" size={14} /> Paste a public key only. Private keys are never needed here.</div>
          {keyError && <div className="inline-error"><span>!</span>{keyError}</div>}
          <div className="modal-actions"><button type="button" className="cancel-button" onClick={() => setShowKeyForm(false)}>Cancel</button><button className="modal-primary" type="submit" disabled={addingKey || !publicKey.trim()}>{addingKey ? "Importing…" : <>Import key <Icon name="arrow" size={15} /></>}</button></div>
        </form>
      </div>}
    </div>
  );
}
