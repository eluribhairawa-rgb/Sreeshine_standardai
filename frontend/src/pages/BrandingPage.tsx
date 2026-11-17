import { useCallback, useEffect, useRef, useState } from "react";
import type { Dispatch, SetStateAction } from "react";
import { Button, Input, Textarea } from "../components/ui";
import { API_BASE } from "../lib/constants";
import { apiFetch, getHospitalCode } from "../lib/api";
import { applyBranding, fitMm, loadBranding, type BrandingConfig } from "../lib/branding";
import type { Notice } from "../types";

type Props = { setNotice: Dispatch<SetStateAction<Notice | null>> };
type Watermark = {
  id: number; name: string; modules: string[]; opacity: number; scale_pct: number; active: boolean;
  width_px: number | null; height_px: number | null; image_url: string | null;
};
type WatermarkList = { watermarks: Watermark[]; modules: { id: string; label: string }[] };
type Alignment = "left" | "center" | "right";

const PX_PER_MM = 3; // preview scale: 180mm content width -> 540px
const ACCEPT = ".png,.jpg,.jpeg,.svg,image/png,image/jpeg,image/svg+xml";

export default function BrandingPage({ setNotice }: Props) {
  const [cfg, setCfg] = useState<BrandingConfig | null>(null);
  const [title, setTitle] = useState("");
  const [titleFontSize, setTitleFontSize] = useState("");
  const [footerText, setFooterText] = useState("");
  const [alignment, setAlignment] = useState<Alignment>("left");
  const [offsetX, setOffsetX] = useState("0");
  const [offsetY, setOffsetY] = useState("0");
  const [autoFit, setAutoFit] = useState(true);
  const [busy, setBusy] = useState<string>("");
  const [dragging, setDragging] = useState<"logo" | "footer" | "">("");
  const [error, setError] = useState("");
  const logoInput = useRef<HTMLInputElement>(null);
  const footerInput = useRef<HTMLInputElement>(null);

  // ---- watermarks (per module) ----
  const [wmList, setWmList] = useState<Watermark[]>([]);
  const [wmModules, setWmModules] = useState<{ id: string; label: string }[]>([]);
  // Watermarks picked but not saved yet: each gets its own card to choose its modules.
  type WmDraft = { key: string; file: File; url: string; name: string; modules: string[]; opacity: number; scale: number };
  const [drafts, setDrafts] = useState<WmDraft[]>([]);
  const [wmEditing, setWmEditing] = useState<number | null>(null);
  const wmInput = useRef<HTMLInputElement>(null);
  const draftsRef = useRef<WmDraft[]>([]);
  draftsRef.current = drafts;
  useEffect(() => () => { draftsRef.current.forEach((d) => URL.revokeObjectURL(d.url)); }, []);
  // Which watermark the live preview page shows: "auto" (the one being added, else the first saved), "none", or a saved id.
  const [previewWm, setPreviewWm] = useState<string>("auto");

  const hydrate = useCallback((data: BrandingConfig) => {
    setCfg(data);
    setTitle(data.hospital_title || "");
    setTitleFontSize(data.title_font_size_pt != null ? String(data.title_font_size_pt) : "");
    setFooterText(data.footer_text || "");
    setAlignment(data.logo_alignment || "left");
    setOffsetX(String(data.logo_offset_x_mm ?? 0));
    setOffsetY(String(data.logo_offset_y_mm ?? 0));
    setAutoFit(data.auto_fit_scaling !== false);
  }, []);

  // The settings view omits inline image data; the preview fetches the assets via their URLs.
  const refreshGlobal = useCallback(async () => { await loadBranding(); }, []);

  useEffect(() => {
    apiFetch<BrandingConfig>("/api/branding").then(hydrate).catch((e) => setError(e?.message || "Unable to load branding settings."));
  }, [hydrate]);

  const applyWm = (data: WatermarkList) => { setWmList(data.watermarks); setWmModules(data.modules); };
  useEffect(() => {
    apiFetch<WatermarkList>("/api/branding/watermarks").then(applyWm).catch((e) => setError(e?.message || "Unable to load watermarks."));
  }, []);

  const baseUrl = (API_BASE || "").replace(/\/+$/, "").replace(/\/api$/, "");

  const upload = async (kind: "logo" | "footer", file: File | undefined | null) => {
    if (!file) return;
    setBusy(kind);
    setError("");
    try {
      const body = new FormData();
      body.append("file", file);
      const response = await fetch(`${baseUrl}/api/branding/${kind}`, { method: "POST", body, credentials: "include", headers: { "X-Hospital-Code": getHospitalCode() } });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(typeof data?.detail === "string" ? data.detail : data?.error || "Upload failed.");
      setCfg(data);
      await refreshGlobal();
      setNotice({ type: "success", message: kind === "logo" ? "Logo uploaded and auto-fitted." : "Footer image uploaded and auto-fitted." });
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy("");
    }
  };

  const removeAsset = async (kind: "logo" | "footer") => {
    setBusy(kind);
    setError("");
    try {
      setCfg(await apiFetch<BrandingConfig>(`/api/branding/${kind}`, { method: "DELETE" }));
      await refreshGlobal();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy("");
    }
  };

  const save = async () => {
    setBusy("save");
    setError("");
    try {
      const customPt = titleFontSize.trim() ? Number(titleFontSize) : null;
      const data = await apiFetch<BrandingConfig>("/api/branding", {
        method: "PUT",
        body: JSON.stringify({
          hospital_title: title,
          title_font_size_pt: customPt != null && !isNaN(customPt) ? customPt : null,
          footer_text: footerText,
          logo_alignment: alignment,
          logo_offset_x_mm: Number(offsetX) || 0,
          logo_offset_y_mm: Number(offsetY) || 0,
          auto_fit_scaling: autoFit,
        }),
      });
      hydrate(data);
      await refreshGlobal();
      setNotice({ type: "success", message: "Branding saved. New prints and PDFs use it immediately." });
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy("");
    }
  };

  const resetAll = async () => {
    if (!window.confirm("Remove all custom branding and go back to the default HospAI documents?")) return;
    setBusy("reset");
    setError("");
    try {
      await apiFetch("/api/branding/logo", { method: "DELETE" });
      await apiFetch("/api/branding/footer", { method: "DELETE" });
      const data = await apiFetch<BrandingConfig>("/api/branding", {
        method: "PUT",
        body: JSON.stringify({ hospital_title: "", title_font_size_pt: null, footer_text: "", logo_alignment: "left", logo_offset_x_mm: 0, logo_offset_y_mm: 0, auto_fit_scaling: true }),
      });
      hydrate(data);
      applyBranding(null);
      await refreshGlobal();
      setNotice({ type: "success", message: "Branding reset to HospAI defaults." });
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy("");
    }
  };

  const toggleModule = (list: string[], id: string) => (list.includes(id) ? list.filter((m) => m !== id) : [...list, id]);
  const moduleLabel = (id: string) => wmModules.find((m) => m.id === id)?.label || id;
  // Modules already carrying another active watermark are disabled so the choice is never ambiguous.
  const takenBy = (id: string, exceptId: number | null) => wmList.find((w) => w.active && w.id !== exceptId && w.modules.includes(id));

  const addDraftFiles = (files: FileList | null) => {
    if (!files?.length) return;
    const added: WmDraft[] = Array.from(files).map((file, i) => ({
      key: `${Date.now()}-${i}-${file.name}`, file, url: URL.createObjectURL(file),
      name: file.name.replace(/\.[^.]+$/, "").slice(0, 100), modules: [], opacity: 12, scale: 40,
    }));
    setDrafts((cur) => [...cur, ...added]);
    setPreviewWm(`draft:${added[0].key}`);
    setError("");
  };
  const patchDraft = (key: string, patch: Partial<WmDraft>) => setDrafts((cur) => cur.map((d) => (d.key === key ? { ...d, ...patch } : d)));
  const removeDraft = (key: string) => setDrafts((cur) => { cur.filter((d) => d.key === key).forEach((d) => URL.revokeObjectURL(d.url)); return cur.filter((d) => d.key !== key); });
  // A module is unavailable to a draft when a saved active watermark, or another draft in this batch, already has it.
  const draftTakenBy = (id: string, key: string) =>
    takenBy(id, null) || (() => { const o = drafts.find((d) => d.key !== key && d.modules.includes(id)); return o ? { name: o.name || "another new watermark" } : undefined; })();

  const saveDrafts = async () => {
    for (const d of drafts) {
      if (!d.name.trim()) return setError("Give every watermark a name.");
      if (!d.modules.length) return setError(`Choose at least one module for "${d.name || d.file.name}".`);
    }
    setBusy("wm-add");
    setError("");
    let saved = 0;
    try {
      for (const d of drafts) {
        const body = new FormData();
        body.append("file", d.file);
        body.append("name", d.name.trim());
        body.append("modules", d.modules.join(","));
        body.append("opacity", String(d.opacity / 100));
        body.append("scale_pct", String(d.scale));
        const response = await fetch(`${baseUrl}/api/branding/watermarks`, { method: "POST", body, credentials: "include", headers: { "X-Hospital-Code": getHospitalCode() } });
        const data = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(`${d.name}: ${typeof data?.detail === "string" ? data.detail : data?.error || "Upload failed."}`);
        applyWm(data);
        removeDraft(d.key);
        saved += 1;
      }
      await refreshGlobal();
      setPreviewWm("auto");
      setNotice({ type: "success", message: `${saved} watermark${saved === 1 ? "" : "s"} added. They now print on the chosen modules' PDFs.` });
    } catch (e) {
      setError((e as Error).message);
      if (saved) await refreshGlobal();
    } finally {
      setBusy("");
    }
  };

  const updateWatermark = async (wm: Watermark, patch: Partial<Watermark>) => {
    setBusy(`wm-${wm.id}`);
    setError("");
    try {
      applyWm(await apiFetch<WatermarkList>(`/api/branding/watermarks/${wm.id}`, { method: "PUT", body: JSON.stringify({ ...wm, ...patch }) }));
      await refreshGlobal();
      return true;
    } catch (e) {
      setError((e as Error).message);
      return false;
    } finally {
      setBusy("");
    }
  };

  const deleteWatermark = async (wm: Watermark) => {
    if (!window.confirm(`Delete the watermark "${wm.name}"? PDFs for ${wm.modules.map(moduleLabel).join(", ")} will no longer carry it.`)) return;
    setBusy(`wm-${wm.id}`);
    setError("");
    try {
      applyWm(await apiFetch<WatermarkList>(`/api/branding/watermarks/${wm.id}`, { method: "DELETE" }));
      await refreshGlobal();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy("");
    }
  };

  const replaceWatermarkImage = async (wm: Watermark, file: File | undefined | null) => {
    if (!file) return;
    setBusy(`wm-${wm.id}`);
    setError("");
    try {
      const body = new FormData();
      body.append("file", file);
      const response = await fetch(`${baseUrl}/api/branding/watermarks/${wm.id}/image`, { method: "POST", body, credentials: "include", headers: { "X-Hospital-Code": getHospitalCode() } });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(typeof data?.detail === "string" ? data.detail : data?.error || "Upload failed.");
      applyWm(data);
      await refreshGlobal();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy("");
    }
  };

  const onDrop = (kind: "logo" | "footer") => (e: React.DragEvent) => {
    e.preventDefault();
    setDragging("");
    void upload(kind, e.dataTransfer.files?.[0]);
  };

  // ---- live preview (A4 content width, header + footer) ----
  const ox = Number(offsetX) || 0;
  const oy = Number(offsetY) || 0;
  const logoBox = cfg?.logo_box_mm || [70, 28];
  const footerBox = cfg?.footer_box_mm || [150, 9];
  const logoSrc = cfg?.logo ? `${baseUrl}${cfg.logo.url}` : "";
  const footerSrc = cfg?.footer ? `${baseUrl}${cfg.footer.url}` : "";
  const [lw, lh] = fitMm(cfg?.logo?.width_px ?? null, cfg?.logo?.height_px ?? null, logoBox[0], logoBox[1], autoFit);
  const [fw, fh] = fitMm(cfg?.footer?.width_px ?? null, cfg?.footer?.height_px ?? null, footerBox[0], footerBox[1], true);
  const trimmedTitle = title.trim();
  const titleLines = trimmedTitle.replace(/\\n/g, "\n").split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  const maxLineLen = titleLines.length ? Math.max(...titleLines.map((l) => l.length)) : 0;
  const customPt = titleFontSize.trim() ? Number(titleFontSize) : null;
  const titleFontSizePt = (customPt && !isNaN(customPt) && customPt >= 6 && customPt <= 36)
    ? customPt
    : (maxLineLen <= 20 ? 18 : maxLineLen <= 32 ? 15.5 : maxLineLen <= 48 ? 13.5 : maxLineLen <= 65 ? 11.5 : 10);
  const titleEl = titleLines.length ? (
    <div style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 2, textAlign: "center" }}>
      {titleLines.map((line, idx) => (
        <div
          key={idx}
          style={{
            font: `${idx === 0 ? 800 : 600} ${idx === 0 ? titleFontSizePt : Math.max(titleFontSizePt - 3, 9.5)}pt Arial, sans-serif`,
            color: idx === 0 ? "#000" : "#334155",
            textTransform: "uppercase",
            lineHeight: 1.25,
            letterSpacing: "-0.2px",
            wordBreak: "break-word",
          }}
        >
          {line}
        </div>
      ))}
    </div>
  ) : null;
  const logoEl = cfg?.logo ? (
    <img src={logoSrc} alt="Logo preview" style={{ width: lw * PX_PER_MM, height: lh * PX_PER_MM, objectFit: "contain", position: "relative", left: ox * PX_PER_MM, top: oy * PX_PER_MM, display: "block" }} />
  ) : null;

  const draftToPreview = (d: WmDraft) => ({ src: d.url, opacity: d.opacity / 100, scale: d.scale, label: `New: ${d.name || d.file.name}`, modules: d.modules });
  const savedWm = (w: Watermark) => ({ src: w.image_url ? `${baseUrl}${w.image_url}` : "", opacity: w.opacity, scale: w.scale_pct, label: w.name, modules: w.modules });
  const shownWm = previewWm === "none"
    ? null
    : previewWm === "auto"
      ? (drafts[0] ? draftToPreview(drafts[0]) : (wmList[0] ? savedWm(wmList[0]) : null))
      : previewWm.startsWith("draft:")
        ? (() => { const d = drafts.find((x) => x.key === previewWm.slice(6)); return d ? draftToPreview(d) : null; })()
        : (() => { const w = wmList.find((x) => String(x.id) === previewWm); return w ? savedWm(w) : null; })();

  if (!cfg) {
    return <div className="panel"><p className="muted">{error || "Loading branding settings…"}</p></div>;
  }

  const section: React.CSSProperties = { background: "var(--surface, #fff)", border: "1px solid #e2e8f0", borderRadius: 12, padding: 18, marginBottom: 16 };
  const drop = (kind: "logo" | "footer"): React.CSSProperties => ({
    border: `2px dashed ${dragging === kind ? "#2563eb" : "#94a3b8"}`, borderRadius: 10, padding: 16, textAlign: "center", cursor: "pointer",
    background: dragging === kind ? "#eff6ff" : "#f8fafc", color: "#334155", fontSize: 13,
  });

  return (
    <div style={{ display: "grid", gap: 16, gridTemplateColumns: "minmax(300px, 1fr) minmax(340px, 600px)", alignItems: "start" }}>
      <div>
        {error && <div role="alert" style={{ ...section, borderColor: "#fca5a5", background: "#fef2f2", color: "#991b1b" }}>{error}</div>}

        <section style={section}>
          <h3 style={{ margin: "0 0 10px" }}>Hospital title</h3>
          <label className="muted" htmlFor="branding-title" style={{ fontSize: 12, display: "block", marginBottom: 6 }}>
            Printed on documents in place of “HospAI”. Press Shift+Enter or Enter to add a new line.
          </label>
          <Textarea
            id="branding-title"
            rows={2}
            maxLength={200}
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && e.shiftKey) {
                e.stopPropagation();
              }
            }}
            placeholder={"e.g. Sunrise Multispeciality Hospital\nShivaji Nagar, Siddipet"}
            style={{ resize: "vertical", minHeight: 64, fontFamily: "inherit" }}
          />

          <div style={{ marginTop: 14 }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 6 }}>
              <label htmlFor="branding-font-size" className="muted" style={{ fontSize: 12, fontWeight: 600 }}>
                Font size (pt)
              </label>
              <span className="muted" style={{ fontSize: 11 }}>
                {titleFontSize.trim() ? `${titleFontSize} pt (custom)` : "Auto (scales dynamically)"}
              </span>
            </div>
            <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
              <div style={{ width: 100 }}>
                <Input
                  id="branding-font-size"
                  type="number"
                  min={8}
                  max={36}
                  step={0.5}
                  value={titleFontSize}
                  onChange={(e) => setTitleFontSize(e.target.value)}
                  placeholder="Auto"
                />
              </div>
              <div role="group" aria-label="Font size presets" style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                <Button
                  type="button"
                  size="sm"
                  variant={!titleFontSize.trim() ? "primary" : "secondary"}
                  onClick={() => setTitleFontSize("")}
                >
                  Auto
                </Button>
                {[10, 11, 12, 13.5, 15, 16.5, 18, 20].map((pt) => (
                  <Button
                    key={pt}
                    type="button"
                    size="sm"
                    variant={titleFontSize.trim() === String(pt) ? "primary" : "secondary"}
                    onClick={() => setTitleFontSize(String(pt))}
                  >
                    {pt} pt
                  </Button>
                ))}
              </div>
            </div>
          </div>
        </section>

        <section style={section}>
          <h3 style={{ margin: "0 0 10px" }}>Header logo</h3>
          <div
            style={drop("logo")}
            onClick={() => logoInput.current?.click()}
            onDragOver={(e) => { e.preventDefault(); setDragging("logo"); }}
            onDragLeave={() => setDragging("")}
            onDrop={onDrop("logo")}
            role="button" tabIndex={0}
            onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") logoInput.current?.click(); }}
          >
            {busy === "logo" ? "Uploading…" : cfg.logo ? "Drop or click to replace the logo" : "Drop a logo here or click to browse"}
            <div className="muted" style={{ fontSize: 11, marginTop: 4 }}>PNG, JPG or SVG · up to 5 MB · automatically scaled to fit the header</div>
          </div>
          <input ref={logoInput} type="file" accept={ACCEPT} hidden onChange={(e) => { void upload("logo", e.target.files?.[0]); e.target.value = ""; }} />
          {cfg.logo && <Button variant="ghost" size="sm" disabled={!!busy} onClick={() => removeAsset("logo")} style={{ marginTop: 8 }}>Remove logo</Button>}

          <div style={{ marginTop: 14 }}>
            <div className="muted" style={{ fontSize: 12, marginBottom: 6 }}>Position</div>
            <div role="group" aria-label="Logo alignment" style={{ display: "flex", gap: 6 }}>
              {(["left", "center", "right"] as Alignment[]).map((a) => (
                <Button key={a} variant={alignment === a ? "primary" : "secondary"} size="sm" aria-pressed={alignment === a} onClick={() => setAlignment(a)}>
                  Top-{a[0].toUpperCase() + a.slice(1)}
                </Button>
              ))}
            </div>
            <div style={{ display: "flex", gap: 12, marginTop: 10 }}>
              <label style={{ flex: 1, fontSize: 12 }}>X offset (mm)
                <Input type="number" min={-30} max={30} step={0.5} value={offsetX} onChange={(e) => setOffsetX(e.target.value)} />
              </label>
              <label style={{ flex: 1, fontSize: 12 }}>Y offset (mm)
                <Input type="number" min={-30} max={30} step={0.5} value={offsetY} onChange={(e) => setOffsetY(e.target.value)} />
              </label>
            </div>
            <label style={{ display: "flex", gap: 8, alignItems: "center", marginTop: 10, fontSize: 13 }}>
              <input type="checkbox" checked={autoFit} onChange={(e) => setAutoFit(e.target.checked)} />
              Auto-fit scaling (resize into the header box, aspect ratio preserved)
            </label>
          </div>
        </section>

        <section style={section}>
          <h3 style={{ margin: "0 0 10px" }}>Footer</h3>
          <div
            style={drop("footer")}
            onClick={() => footerInput.current?.click()}
            onDragOver={(e) => { e.preventDefault(); setDragging("footer"); }}
            onDragLeave={() => setDragging("")}
            onDrop={onDrop("footer")}
            role="button" tabIndex={0}
            onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") footerInput.current?.click(); }}
          >
            {busy === "footer" ? "Uploading…" : cfg.footer ? "Drop or click to replace the footer image" : "Optional footer image (PNG, JPG or SVG)"}
          </div>
          <input ref={footerInput} type="file" accept={ACCEPT} hidden onChange={(e) => { void upload("footer", e.target.files?.[0]); e.target.value = ""; }} />
          {cfg.footer && <Button variant="ghost" size="sm" disabled={!!busy} onClick={() => removeAsset("footer")} style={{ marginTop: 8 }}>Remove footer image</Button>}
          <label htmlFor="branding-footer-text" className="muted" style={{ fontSize: 12, display: "block", marginTop: 12 }}>Footer / disclaimer text</label>
          <Textarea id="branding-footer-text" rows={3} maxLength={500} value={footerText} onChange={(e) => setFooterText(e.target.value)} placeholder="Leave blank for “Thank you for choosing …”" />
        </section>

        <section style={section}>
          <h3 style={{ margin: "0 0 4px" }}>Watermarks</h3>
          <p className="muted" style={{ fontSize: 12, margin: "0 0 12px" }}>
            Upload one or more watermark images, then choose the modules each one is used on. It is printed faintly behind the content on every page of those modules' PDFs and prints. A module has one watermark.
          </p>

          <div style={{ border: "1px dashed #94a3b8", borderRadius: 10, padding: 12, background: "#f8fafc" }}>
            <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
              <Button variant="primary" size="sm" disabled={!!busy} onClick={() => wmInput.current?.click()}>Upload watermark(s)</Button>
              <span className="muted" style={{ fontSize: 12 }}>PNG or JPG, up to 5 MB each. You can choose several at once.</span>
              <input ref={wmInput} type="file" multiple accept=".png,.jpg,.jpeg,image/png,image/jpeg" hidden onChange={(e) => { addDraftFiles(e.target.files); e.target.value = ""; }} />
            </div>

            {drafts.length > 0 && (
              <div style={{ display: "grid", gap: 12, marginTop: 12 }}>
                {drafts.map((d, idx) => (
                  <div key={d.key} style={{ border: "1px solid #cbd5e1", borderRadius: 10, padding: 12, background: "#fff" }}>
                    <div style={{ display: "flex", gap: 12, alignItems: "center", marginBottom: 10 }}>
                      <img src={d.url} alt="" onClick={() => setPreviewWm(`draft:${d.key}`)} style={{ width: 56, height: 56, objectFit: "contain", border: "1px solid #e2e8f0", borderRadius: 8, background: "#fff", cursor: "pointer", flexShrink: 0 }} />
                      <label style={{ flex: 1, fontSize: 12 }}>Watermark {idx + 1} name
                        <Input value={d.name} maxLength={100} onChange={(e) => patchDraft(d.key, { name: e.target.value })} />
                      </label>
                      <Button size="sm" variant="ghost" disabled={!!busy} onClick={() => removeDraft(d.key)}>Remove</Button>
                    </div>
                    <div style={{ fontSize: 12, fontWeight: 700, marginBottom: 4 }}>Which modules should use this watermark?</div>
                    <ModulePicker modules={wmModules} selected={d.modules} takenBy={(id) => draftTakenBy(id, d.key)} onToggle={(id) => patchDraft(d.key, { modules: d.modules.includes(id) ? d.modules.filter((m) => m !== id) : [...d.modules, id] })} />
                    <div style={{ display: "flex", gap: 16, flexWrap: "wrap", marginTop: 10 }}>
                      <label style={{ flex: 1, minWidth: 180, fontSize: 12 }}>Opacity: {d.opacity}%
                        <input type="range" min={3} max={60} value={d.opacity} onChange={(e) => patchDraft(d.key, { opacity: Number(e.target.value) })} style={{ width: "100%" }} />
                      </label>
                      <label style={{ flex: 1, minWidth: 180, fontSize: 12 }}>Size: {d.scale}% of page width
                        <input type="range" min={20} max={100} step={5} value={d.scale} onChange={(e) => patchDraft(d.key, { scale: Number(e.target.value) })} style={{ width: "100%" }} />
                      </label>
                    </div>
                  </div>
                ))}
                <div>
                  <Button variant="primary" disabled={!!busy} onClick={saveDrafts}>{busy === "wm-add" ? "Saving…" : drafts.length > 1 ? `Save ${drafts.length} watermarks` : "Save watermark"}</Button>
                </div>
              </div>
            )}
          </div>

          {wmList.length > 0 && (
            <div style={{ display: "grid", gap: 10, marginTop: 14 }}>
              <div style={{ fontWeight: 700 }}>Saved watermarks</div>
              {wmList.map((wm) => {
                const editing = wmEditing === wm.id;
                const rowBusy = busy === `wm-${wm.id}`;
                return (
                  <div key={wm.id} style={{ border: "1px solid #e2e8f0", borderRadius: 10, padding: 12, opacity: wm.active ? 1 : 0.6 }}>
                    <div style={{ display: "flex", gap: 12, alignItems: "center" }}>
                      <div onClick={() => setPreviewWm(String(wm.id))} title="Show in the live preview" style={{ width: 64, height: 64, flexShrink: 0, border: "1px solid #e2e8f0", borderRadius: 8, background: "#fff", display: "flex", alignItems: "center", justifyContent: "center", overflow: "hidden", cursor: "pointer" }}>
                        {wm.image_url && <img src={`${baseUrl}${wm.image_url}`} alt={wm.name} style={{ maxWidth: "100%", maxHeight: "100%", opacity: Math.max(wm.opacity, 0.35) }} />}
                      </div>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontWeight: 700, color: "#0f172a" }}>{wm.name}{!wm.active && <span className="muted" style={{ fontWeight: 400 }}> · turned off</span>}</div>
                        <div style={{ display: "flex", flexWrap: "wrap", gap: 4, marginTop: 4 }}>
                          {wm.modules.map((m) => (
                            <span key={m} style={{ fontSize: 11, padding: "2px 8px", borderRadius: 999, background: "#e0f2fe", color: "#075985", fontWeight: 600 }}>{moduleLabel(m)}</span>
                          ))}
                        </div>
                        <div className="muted" style={{ fontSize: 11, marginTop: 4 }}>Opacity {Math.round(wm.opacity * 100)}% · Size {wm.scale_pct}% of page width</div>
                      </div>
                      <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                        <Button size="sm" variant="secondary" disabled={rowBusy} onClick={() => setWmEditing(editing ? null : wm.id)}>{editing ? "Close" : "Edit modules"}</Button>
                        <Button size="sm" variant="ghost" disabled={rowBusy} onClick={() => deleteWatermark(wm)}>Delete</Button>
                      </div>
                    </div>
                    {editing && (
                      <WatermarkEditor
                        wm={wm} modules={wmModules} takenBy={(id) => takenBy(id, wm.id)} busy={rowBusy}
                        onSave={async (patch) => { if (await updateWatermark(wm, patch)) setWmEditing(null); }}
                        onReplaceImage={(f) => replaceWatermarkImage(wm, f)}
                      />
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </section>

        <div style={{ display: "flex", gap: 10 }}>
          <Button variant="primary" disabled={!!busy} onClick={save}>{busy === "save" ? "Saving…" : "Save branding"}</Button>
          <Button variant="ghost" disabled={!!busy} onClick={resetAll}>Reset to defaults</Button>
        </div>
      </div>

      <div style={{ position: "sticky", top: 12 }}>
        <section style={section}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8, flexWrap: "wrap", margin: "0 0 10px" }}>
            <h3 style={{ margin: 0 }}>Live preview</h3>
            <label style={{ fontSize: 12, display: "flex", alignItems: "center", gap: 6 }}>Watermark
              <select value={previewWm} onChange={(e) => setPreviewWm(e.target.value)} style={{ padding: "4px 6px", borderRadius: 6, border: "1px solid #cbd5e1", fontSize: 12, maxWidth: 190 }}>
                <option value="auto">Auto</option>
                <option value="none">None</option>
                {drafts.map((d) => <option key={d.key} value={`draft:${d.key}`}>{`New: ${d.name || d.file.name}`}</option>)}
                {wmList.map((w) => <option key={w.id} value={String(w.id)}>{w.name}</option>)}
              </select>
            </label>
          </div>
          {/* A full A4 page (210 x 297 mm at 3px/mm), shrunk to fit the column, so the watermark is seen where it will print. */}
          <div style={{ zoom: 0.6, display: "flex", justifyContent: "center" }}>
          <div style={{ position: "relative", width: 210 * PX_PER_MM, height: 297 * PX_PER_MM, flexShrink: 0, background: "#fff", border: "1px solid #cbd5e1", boxShadow: "0 1px 6px rgba(0,0,0,.12)", padding: 15 * PX_PER_MM, boxSizing: "border-box", overflow: "hidden", display: "flex", flexDirection: "column" }}>
            {shownWm && shownWm.src && (
              <img src={shownWm.src} alt="Watermark preview" style={{ position: "absolute", top: "50%", left: "50%", transform: "translate(-50%, -50%)", width: `${shownWm.scale}%`, maxHeight: "90%", objectFit: "contain", opacity: shownWm.opacity, pointerEvents: "none", zIndex: 0 }} />
            )}
            <div style={{ position: "relative", zIndex: 1, width: 180 * PX_PER_MM, maxWidth: "100%", margin: "0 auto", flex: 1, display: "flex", flexDirection: "column" }}>
              <div style={{
                minHeight: Math.max(28 * PX_PER_MM, (lh + 10) * PX_PER_MM),
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                borderBottom: "2px solid #000",
                paddingBottom: 8,
                paddingTop: 8,
                boxSizing: "border-box",
                width: "100%",
                overflow: "visible",
              }}>
                {logoEl ? (
                  !trimmedTitle ? (
                    <div style={{ width: "100%", display: "flex", justifyContent: alignment === "center" ? "center" : alignment === "right" ? "flex-end" : "flex-start" }}>
                      {logoEl}
                    </div>
                  ) : alignment === "center" ? (
                    <div style={{ width: "100%", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 6 }}>
                      <div>{logoEl}</div>
                      {titleEl}
                    </div>
                  ) : alignment === "right" ? (
                    <div style={{ width: "100%", display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
                      <div style={{ width: lw * PX_PER_MM, flexShrink: 0, visibility: "hidden" }} aria-hidden="true" />
                      {titleEl}
                      <div style={{ width: lw * PX_PER_MM, flexShrink: 0, display: "flex", justifyContent: "flex-end" }}>{logoEl}</div>
                    </div>
                  ) : (
                    <div style={{ width: "100%", display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
                      <div style={{ width: lw * PX_PER_MM, flexShrink: 0, display: "flex", justifyContent: "flex-start" }}>{logoEl}</div>
                      {titleEl}
                      <div style={{ width: lw * PX_PER_MM, flexShrink: 0, visibility: "hidden" }} aria-hidden="true" />
                    </div>
                  )
                ) : trimmedTitle ? (
                  titleEl
                ) : (
                  <div className="muted" style={{ fontSize: 12, textAlign: "center", width: "100%" }}>Default HospAI header (no custom logo or title)</div>
                )}
              </div>
              <div style={{ flex: 1, margin: "14px 0", color: "#94a3b8", fontSize: 11 }}>
                <div style={{ fontWeight: 800, fontSize: 15, color: "#334155", marginBottom: 6 }}>Document title</div>
                <div style={{ marginBottom: 10 }}>Patient details · UHID · date</div>
                <div style={{ border: "1px solid #e2e8f0" }}>
                  {[0, 1, 2, 3, 4, 5].map((r) => (
                    <div key={r} style={{ display: "flex", gap: 8, padding: "6px 8px", borderTop: r ? "1px solid #f1f5f9" : "none", background: r === 0 ? "#eff6ff" : "transparent" }}>
                      <div style={{ flex: 2, height: 7, background: r === 0 ? "#bfdbfe" : "#e2e8f0", borderRadius: 3 }} />
                      <div style={{ flex: 1, height: 7, background: r === 0 ? "#bfdbfe" : "#eef2f7", borderRadius: 3 }} />
                      <div style={{ flex: 1, height: 7, background: r === 0 ? "#bfdbfe" : "#eef2f7", borderRadius: 3 }} />
                    </div>
                  ))}
                </div>
              </div>
              <div style={{ position: "relative", marginTop: 14 }}>
                <div style={{ display: "flex", alignItems: "center", width: "100%", marginBottom: 6 }}>
                  <div style={{ flex: 1, borderTop: "1.5px solid #000" }} />
                  {(footerSrc || logoSrc) && (
                    <img
                      src={footerSrc || logoSrc}
                      alt="Footer badge preview"
                      style={{
                        height: 20,
                        width: 20,
                        objectFit: "contain",
                        margin: "0 6px",
                        borderRadius: "50%",
                        display: "block",
                      }}
                    />
                  )}
                  <div style={{ flex: 1, borderTop: "1.5px solid #000" }} />
                </div>
                <div style={{ display: "flex", justifyContent: "space-between", font: "italic 7.5pt Arial, sans-serif" }}>
                  <span>{footerText.trim() || `Thank you for choosing ${title.trim().replace(/[\r\n]+/g, ", ") || "HospAI"}.`}</span>
                  <span>Page 1 of 1</span>
                </div>
              </div>
            </div>
          </div>
          </div>
          <p className="muted" style={{ fontSize: 11, margin: "8px 0 0" }}>Applies to prescriptions, pharmacy bills, discharge summaries, OP/IP prints and exported PDFs. Documents fall back to the default HospAI layout wherever nothing is configured.</p>
        </section>
      </div>
    </div>
  );
}


function ModulePicker({ modules, selected, takenBy, onToggle }: {
  modules: { id: string; label: string }[]; selected: string[]; takenBy: (id: string) => { name: string } | undefined; onToggle: (id: string) => void;
}) {
  return (
    <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(210px, 1fr))", gap: 6 }}>
      {modules.map((m) => {
        const taken = takenBy(m.id);
        return (
          <label key={m.id} title={taken ? `Already uses "${taken.name}"` : ""} style={{ display: "flex", gap: 6, alignItems: "center", fontSize: 13, opacity: taken ? 0.5 : 1, cursor: taken ? "not-allowed" : "pointer" }}>
            <input type="checkbox" disabled={!!taken} checked={selected.includes(m.id)} onChange={() => onToggle(m.id)} />
            <span>{m.label}{taken && <span className="muted" style={{ fontSize: 11 }}> (used by {taken.name})</span>}</span>
          </label>
        );
      })}
    </div>
  );
}

function WatermarkEditor({ wm, modules, takenBy, busy, onSave, onReplaceImage }: {
  wm: Watermark; modules: { id: string; label: string }[]; takenBy: (id: string) => { name: string } | undefined; busy: boolean;
  onSave: (patch: Partial<Watermark>) => void | Promise<void>; onReplaceImage: (file: File | undefined | null) => void;
}) {
  const [name, setName] = useState(wm.name);
  const [selected, setSelected] = useState<string[]>(wm.modules);
  const [opacity, setOpacity] = useState(Math.round(wm.opacity * 100));
  const [scale, setScale] = useState(wm.scale_pct);
  const [active, setActive] = useState(wm.active);
  const fileRef = useRef<HTMLInputElement>(null);
  return (
    <div style={{ marginTop: 12, paddingTop: 12, borderTop: "1px solid #e2e8f0", display: "grid", gap: 10 }}>
      <label style={{ fontSize: 12 }}>Name
        <Input value={name} maxLength={100} onChange={(e) => setName(e.target.value)} />
      </label>
      <ModulePicker modules={modules} selected={selected} takenBy={takenBy} onToggle={(id) => setSelected((cur) => (cur.includes(id) ? cur.filter((m) => m !== id) : [...cur, id]))} />
      <div style={{ display: "flex", gap: 16, flexWrap: "wrap" }}>
        <label style={{ flex: 1, minWidth: 180, fontSize: 12 }}>Opacity: {opacity}%
          <input type="range" min={3} max={60} value={opacity} onChange={(e) => setOpacity(Number(e.target.value))} style={{ width: "100%" }} />
        </label>
        <label style={{ flex: 1, minWidth: 180, fontSize: 12 }}>Size: {scale}% of page width
          <input type="range" min={20} max={100} step={5} value={scale} onChange={(e) => setScale(Number(e.target.value))} style={{ width: "100%" }} />
        </label>
      </div>
      <label style={{ display: "flex", gap: 8, alignItems: "center", fontSize: 13 }}>
        <input type="checkbox" checked={active} onChange={(e) => setActive(e.target.checked)} /> Watermark is on
      </label>
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
        <Button size="sm" variant="primary" disabled={busy} onClick={() => onSave({ name, modules: selected, opacity: opacity / 100, scale_pct: scale, active })}>{busy ? "Saving…" : "Save changes"}</Button>
        <Button size="sm" variant="secondary" disabled={busy} onClick={() => fileRef.current?.click()}>Replace image</Button>
        <input ref={fileRef} type="file" accept=".png,.jpg,.jpeg,image/png,image/jpeg" hidden onChange={(e) => { onReplaceImage(e.target.files?.[0]); e.target.value = ""; }} />
      </div>
    </div>
  );
}
