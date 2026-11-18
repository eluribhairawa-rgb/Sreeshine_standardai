import { useEffect, useMemo, useRef, useState } from "react";
import { Button, Modal } from "./ui";
import { apiFetch } from "../lib/api";
import { printViaIframe } from "../lib/printViaIframe";
import { sharePrintAsPdfOnWhatsApp } from "../lib/whatsappPdfShare";
import { splitStoredPhone } from "../lib/phone";

type Notify = (notice: { type: "success" | "error" | "info" | "warning"; message: string }) => void;

type Props = {
  open: boolean;
  onClose: () => void;
  /** Response of GET /api/billing/ip-discharge/{id}: { patient, admission, charges_summary, ... }. Optional when admissionKey is given. */
  dischargeData?: any;
  /** Admission id or patient id (latest admission): the discharge record is then loaded here. */
  admissionKey?: string | number | null;
  setNotice: Notify;
};

const ONES = ["", "One", "Two", "Three", "Four", "Five", "Six", "Seven", "Eight", "Nine", "Ten", "Eleven", "Twelve", "Thirteen", "Fourteen", "Fifteen", "Sixteen", "Seventeen", "Eighteen", "Nineteen"];
const TENS = ["", "", "Twenty", "Thirty", "Forty", "Fifty", "Sixty", "Seventy", "Eighty", "Ninety"];

function below1000(n: number): string {
  const parts: string[] = [];
  if (n >= 100) { parts.push(`${ONES[Math.floor(n / 100)]} Hundred`); n %= 100; }
  if (n >= 20) { parts.push(TENS[Math.floor(n / 10)] + (n % 10 ? ` ${ONES[n % 10]}` : "")); }
  else if (n > 0) parts.push(ONES[n]);
  return parts.join(" ");
}

/** Whole rupees in Indian words: 169800 -> "One Lakh Sixty Nine Thousand Eight Hundred". */
export function rupeesInWords(amount: number): string {
  let n = Math.round(Math.abs(Number(amount) || 0));
  if (n === 0) return "Zero";
  const units: [number, string][] = [[10000000, "Crore"], [100000, "Lakh"], [1000, "Thousand"]];
  const out: string[] = [];
  for (const [size, label] of units) {
    if (n >= size) { out.push(`${below1000(Math.floor(n / size))} ${label}`); n %= size; }
  }
  if (n > 0) out.push(below1000(n));
  return out.join(" ");
}

const money = (n: number) => Number(n || 0).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const DATA_MARK = "[[cert-data:";
/** The saved certificate carries its form values after the readable text, so it can be reopened exactly as issued. */
const withData = (text: string, data: unknown) => `${text}\n\n${DATA_MARK}${JSON.stringify(data)}]]`;
export const certificateReadableText = (body: string) => String(body || "").split(DATA_MARK)[0].trim();
const readData = (body: string) => {
  const i = String(body || "").indexOf(DATA_MARK);
  if (i < 0) return null;
  try { return JSON.parse(String(body).slice(i + DATA_MARK.length).replace(/\]\]\s*$/, "")); } catch { return null; }
};

const esc = (v: unknown) => String(v ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

const dmy = (value?: string | null) => {
  if (!value) return "";
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return String(value).slice(0, 10);
  return `${String(d.getDate()).padStart(2, "0")}-${String(d.getMonth() + 1).padStart(2, "0")}-${d.getFullYear()}`;
};
const hm = (value?: string | null) => {
  if (!value) return "";
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit", hour12: true }).toUpperCase();
};

const fieldStyle: React.CSSProperties = { width: "100%", padding: "9px 11px", border: "1px solid #94a3b8", borderRadius: 8, fontSize: 14, color: "#0f172a", background: "#ffffff", boxSizing: "border-box" };
const labelStyle: React.CSSProperties = { display: "block", fontSize: 12, fontWeight: 700, color: "#334155", marginBottom: 4 };
const sectionStyle: React.CSSProperties = { border: "1px solid #e2e8f0", borderRadius: 10, padding: "12px 14px", marginBottom: 12, background: "#f8fafc" };
const sectionTitle: React.CSSProperties = { margin: "0 0 10px", fontSize: 13, fontWeight: 800, color: "#0f766e", textTransform: "uppercase", letterSpacing: "0.04em" };

/** Emergency + Essentiality certificate generated after an inpatient is discharged: print it or share the PDF on WhatsApp. */
export default function EmergencyCertificateModal({ open, onClose, dischargeData: givenData, admissionKey, setNotice }: Props) {
  const [loadedData, setLoadedData] = useState<any>(null);
  const [loadingData, setLoadingData] = useState(false);
  const dischargeData = givenData || loadedData;
  const p = dischargeData?.patient || {};
  const a = dischargeData?.admission || {};
  const charges = dischargeData?.charges_summary || {};

  // Opened from a list (e.g. discharged patients) with just an id: load that admission's discharge record.
  useEffect(() => {
    if (!open || givenData || admissionKey == null || admissionKey === "") return;
    let cancelled = false;
    setLoadedData(null);
    setLoadingData(true);
    apiFetch(`/api/billing/ip-discharge/${encodeURIComponent(String(admissionKey))}`)
      .then((res) => { if (!cancelled) setLoadedData(res); })
      .catch(() => { if (!cancelled) setNotice({ type: "error", message: "Could not load the discharge record for the certificate." }); })
      .finally(() => { if (!cancelled) setLoadingData(false); });
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, admissionKey, givenData]);
  const savedRef = useRef(false);
  const savedBodyRef = useRef("");

  const patientName = [p.name, p.middle_name, p.last_name].filter(Boolean).join(" ").trim();
  const isFemale = String(p.gender || "").toLowerCase().startsWith("f");
  const paidBills = dischargeData?.paid_bills || {};
  const net = Number(charges.settled ? charges.net_bill : (charges.net_bill ?? charges.gross_charges)) || 0;
  // Lab / medicine: what was charged on the stay's bill, else what the lab / pharmacy charged in it separately
  // (invoiced, or ordered / sold but not invoiced yet).
  const lab = Number(charges.laboratory) || Number(paidBills.laboratory_billed) || Number(paidBills.laboratory) || 0;
  const pharmacy = Number(charges.pharmacy) || Number(paidBills.pharmacy_billed) || Number(paidBills.pharmacy) || 0;
  // The inpatient invoice already contains the lab / pharmacy charges billed on the stay: take them out.
  const inpatientPaid = Number(paidBills.inpatient) || net;
  const hospitalization = Math.max(0, inpatientPaid - (Number(charges.laboratory) || 0) - (Number(charges.pharmacy) || 0));
  const blankIfZero = (n: number) => (n > 0 ? String(Math.round(n)) : "");

  const [form, setForm] = useState({
    name: "", relation: "S/O", guardian: "", age: "", gender: "",
    admittedDate: "", admittedTime: "", dischargedDate: "", department: "", diagnosis: "",
    hospitalization: "", lab: "", medicine: "",
  });

  // Prefill when opened: everything comes from the discharge record; diagnosis / department are best-effort lookups.
  useEffect(() => {
    if (!open) return;
    savedRef.current = false;
    savedBodyRef.current = "";
    setForm({
      name: patientName, relation: isFemale ? "D/O" : "S/O", guardian: "", age: p.age != null ? String(p.age) : "",
      gender: isFemale ? "female" : String(p.gender || "").toLowerCase().startsWith("m") ? "male" : "",
      admittedDate: dmy(a.admission_date), admittedTime: hm(a.admission_date),
      dischargedDate: dmy(a.discharge_date) || dmy(new Date().toISOString()),
      department: "", diagnosis: "",
      hospitalization: blankIfZero(hospitalization), lab: blankIfZero(lab), medicine: blankIfZero(pharmacy),
    });
    let cancelled = false;
    (async () => {
      const pid = encodeURIComponent(p.patient_id || "");
      if (!pid) return;
      try {
        const list = await apiFetch<{ summaries?: { id: number }[] }>(`/api/patients/${pid}/discharge-summaries`);
        const id = list?.summaries?.[0]?.id;
        if (id) {
          const res = await apiFetch<{ summary?: { content?: { diagnosis?: string } } }>(`/api/discharge-summaries/${id}`);
          const dx = res?.summary?.content?.diagnosis;
          if (dx && !cancelled) setForm((f) => (f.diagnosis ? f : { ...f, diagnosis: dx }));
        }
      } catch { /* optional */ }
      try {
        // A certificate already issued for this stay is reopened exactly as it was issued.
        const certs = await apiFetch<{ certificates?: { id: number; admission_id?: number | null; certificate_type?: string; body?: string }[] }>(`/api/patients/${pid}/certificates`);
        const saved = (certs?.certificates || []).find((c) => c.certificate_type === "emergency_essentiality" && (!a.id || Number(c.admission_id) === Number(a.id)));
        const data = saved ? readData(saved.body || "") : null;
        if (data && !cancelled) { setForm((f) => ({ ...f, ...data })); savedBodyRef.current = saved?.body || ""; }
      } catch { /* optional */ }
      try {
        const appts = await apiFetch<{ appointments?: { department?: string }[] }>(`/api/appointments?patient_id=${pid}`);
        const dept = (appts?.appointments || []).map((x) => x.department).filter(Boolean).pop();
        if (dept && !cancelled) setForm((f) => (f.department ? f : { ...f, department: String(dept) }));
      } catch { /* optional */ }
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, p.patient_id, a.id, dischargeData]);

  const set = (key: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) =>
    setForm((f) => ({ ...f, [key]: e.target.value }));

  const total = useMemo(() => (Number(form.hospitalization) || 0) + (Number(form.lab) || 0) + (Number(form.medicine) || 0), [form.hospitalization, form.lab, form.medicine]);

  const honorific = form.gender === "female" ? "Ms." : form.gender === "male" ? "Mr." : "";
  const personText = `${honorific} <b>${esc(form.name.toUpperCase())}</b>${form.guardian.trim() ? ` ${esc(form.relation)} <b>${esc(form.guardian.toUpperCase())}</b>` : ""} aged about ${esc(form.age || "-")} years`;

  const buildHtml = () => {
    // Only charge lines that have an amount are listed, numbered in order.
    const lines = [
      ["Hospitalization charges", Number(form.hospitalization) || 0],
      ["Lab investigation charges", Number(form.lab) || 0],
      ["Medicine charges", Number(form.medicine) || 0],
    ].filter(([, amt]) => (amt as number) > 0) as [string, number][];
    const chargeRows = lines.length
      ? lines.map(([label, amt], i) => `<tr><td>${i + 1}.</td><td>${label}</td><td class="amt">Rs. ${money(amt)}</td></tr>`).join("")
      : `<tr><td colspan="3">-</td></tr>`;
    return `<!doctype html><html><head><meta charset="utf-8"><title>Emergency and Essentiality Certificate</title>
  <style>
    body { font-family: "Times New Roman", Georgia, serif; color: #111; font-size: 12.5pt; line-height: 1.55; }
    h2.cert { text-align: center; font-size: 14pt; text-decoration: underline; margin: 6mm 0 6mm; text-transform: uppercase; }
    p { margin: 0 0 4mm; text-align: justify; }
    table.ch { width: 100%; border-collapse: collapse; margin: 4mm 0; }
    table.ch th { text-align: left; border-bottom: 1px solid #111; padding: 2mm 1mm; font-weight: 700; }
    table.ch td { padding: 2mm 1mm; }
    table.ch .amt { text-align: right; white-space: nowrap; }
    .total { text-align: right; font-weight: 700; margin: 2mm 0; }
    .words { margin: 2mm 0 0; }
    .sign { text-align: right; margin-top: 14mm; font-weight: 600; }
    .cert-block { page-break-inside: avoid; }
    .gap { height: 18mm; }
  </style></head><body>
  <div class="cert-block">
    <h2 class="cert">Essentiality Certificate</h2>
    <p>This is to certify that ${personText} from <b>${esc(form.admittedDate)}</b> to <b>${esc(form.dischargedDate)}</b> for that diagnosis of <b>${esc(form.diagnosis || "-")}</b>.</p>
    <p>In this connection the below mentioned procedures &amp; medicines prescribed by me were essential for the recovery.</p>
    <table class="ch">
      <thead><tr><th style="width:12mm">S.No</th><th>Type of charges</th><th class="amt">In Rs.</th></tr></thead>
      <tbody>
        ${chargeRows}
      </tbody>
    </table>
    <div class="total">Total Rs &nbsp; ${money(total)}</div>
    <p class="words">(In words: ${esc(rupeesInWords(total))} rupees only/-)</p>
    <div class="sign">Authorized Signature</div>
  </div>
  <div class="gap"></div>
  <div class="cert-block">
    <h2 class="cert">Emergency Certificate</h2>
    <p>This is to certify that ${personText}${form.gender ? `/ ${esc(form.gender)}` : ""} admitted in our hospital in <b>${esc((form.department || "-").toUpperCase())}</b> Department under emergency on <b>${esc(form.admittedDate)}</b>${form.admittedTime ? ` at <b>${esc(form.admittedTime)}</b>` : ""}.</p>
    <p>The provisional diagnosis is <b>${esc(form.diagnosis || "-")}</b>.</p>
    <div class="sign">Authorized Signature</div>
  </div>
  </body></html>`;
  };

  const plainText = () =>
    `Emergency & Essentiality Certificate\n${honorific} ${form.name} ${form.guardian ? `${form.relation} ${form.guardian} ` : ""}aged about ${form.age} years\n` +
    `Admitted: ${form.admittedDate} ${form.admittedTime} (${form.department || "-"}), discharged: ${form.dischargedDate}\nDiagnosis: ${form.diagnosis || "-"}\n` +
    [Number(form.hospitalization) > 0 ? `Hospitalization Rs. ${money(Number(form.hospitalization))}` : "", Number(form.lab) > 0 ? `Lab Rs. ${money(Number(form.lab))}` : "", Number(form.medicine) > 0 ? `Medicine Rs. ${money(Number(form.medicine))}` : ""].filter(Boolean).join("; ") + `; Total Rs. ${money(total)} (${rupeesInWords(total)} rupees only)`;

  // The generated certificate is kept on the patient's record (once per opening), then printed / shared.
  const keepRecord = async () => {
    if (savedRef.current || !p.patient_id) return;
    if (savedBodyRef.current && savedBodyRef.current === withData(plainText(), form)) return; // already on record, unchanged
    savedRef.current = true;
    try {
      await apiFetch(`/api/patients/${encodeURIComponent(p.patient_id)}/certificates`, {
        method: "POST",
        body: JSON.stringify({
          certificate_type: "emergency_essentiality", title: "Emergency & Essentiality Certificate",
          body: withData(plainText(), form), admission_id: a.id || undefined,
        }),
      });
    } catch {
      savedRef.current = false; // printing still works; try saving again next time
    }
  };

  const validate = () => {
    if (!form.name.trim()) { setNotice({ type: "warning", message: "Enter the patient name." }); return false; }
    if (!form.diagnosis.trim()) { setNotice({ type: "warning", message: "Enter the diagnosis." }); return false; }
    if (!form.department.trim()) { setNotice({ type: "warning", message: "Enter the department the patient was admitted under." }); return false; }
    return true;
  };

  const handlePrint = async () => {
    if (!validate()) return;
    await keepRecord();
    printViaIframe(buildHtml());
  };

  const handleShare = async () => {
    if (!validate()) return;
    await keepRecord();
    const parts = splitStoredPhone(p.phone || p.mobile || "", p.phone_country_code || "+91");
    const ok = sharePrintAsPdfOnWhatsApp(() => printViaIframe(buildHtml()), {
      filename: `Emergency_Certificate_${p.patient_id || ""}`, title: "Emergency & Essentiality Certificate",
      text: `Emergency & Essentiality Certificate for ${form.name}`, phone: parts.value, phoneCountryCode: parts.countryCode,
    }, setNotice);
    if (!ok) setNotice({ type: "error", message: "Could not prepare the PDF to share." });
  };

  return (
    <Modal open={open} title="Emergency & Essentiality Certificate" onClose={onClose} className="ui-modal-wide">
      <div style={{ padding: "0.25rem 0", color: "#0f172a" }}>
        {loadingData && <p style={{ margin: "0 0 8px", color: "#475569" }}>Loading discharge record…</p>}
        <p style={{ margin: "0 0 14px", color: "#475569", fontSize: 13.5 }}>
          Filled from the discharge record. Check the details below, then print the certificate or share it as a PDF on WhatsApp.
        </p>

        <section style={sectionStyle}>
          <h4 style={sectionTitle}>Patient</h4>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(12, 1fr)", gap: 12 }}>
            <div style={{ gridColumn: "span 6" }}><label style={labelStyle}>Patient name *</label><input style={fieldStyle} value={form.name} onChange={set("name")} /></div>
            <div style={{ gridColumn: "span 3" }}><label style={labelStyle}>Age (years)</label><input style={fieldStyle} value={form.age} onChange={set("age")} /></div>
            <div style={{ gridColumn: "span 3" }}>
              <label style={labelStyle}>Gender</label>
              <select style={fieldStyle} value={form.gender} onChange={set("gender")}>
                <option value="">Select</option><option value="male">Male</option><option value="female">Female</option>
              </select>
            </div>
            <div style={{ gridColumn: "span 3" }}>
              <label style={labelStyle}>Relation</label>
              <select style={fieldStyle} value={form.relation} onChange={set("relation")}>
                <option value="S/O">S/O (son of)</option><option value="D/O">D/O (daughter of)</option>
                <option value="W/O">W/O (wife of)</option><option value="C/O">C/O (care of)</option>
              </select>
            </div>
            <div style={{ gridColumn: "span 9" }}><label style={labelStyle}>Father / husband / guardian name</label><input style={fieldStyle} value={form.guardian} onChange={set("guardian")} placeholder="Name to print after the relation" /></div>
          </div>
        </section>

        <section style={sectionStyle}>
          <h4 style={sectionTitle}>Admission</h4>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(12, 1fr)", gap: 12 }}>
            <div style={{ gridColumn: "span 4" }}><label style={labelStyle}>Admitted on</label><input style={fieldStyle} value={form.admittedDate} onChange={set("admittedDate")} placeholder="DD-MM-YYYY" /></div>
            <div style={{ gridColumn: "span 4" }}><label style={labelStyle}>Admitted at</label><input style={fieldStyle} value={form.admittedTime} onChange={set("admittedTime")} placeholder="11:30 PM" /></div>
            <div style={{ gridColumn: "span 4" }}><label style={labelStyle}>Discharged on</label><input style={fieldStyle} value={form.dischargedDate} onChange={set("dischargedDate")} placeholder="DD-MM-YYYY" /></div>
            <div style={{ gridColumn: "span 12" }}><label style={labelStyle}>Department *</label><input style={fieldStyle} value={form.department} onChange={set("department")} placeholder="e.g. General Surgery" /></div>
            <div style={{ gridColumn: "span 12" }}>
              <label style={labelStyle}>Diagnosis *</label>
              <textarea style={{ ...fieldStyle, minHeight: 64, resize: "vertical" }} value={form.diagnosis} onChange={set("diagnosis")} placeholder="e.g. Right upper ureteric calculus" />
            </div>
          </div>
        </section>

        <section style={sectionStyle}>
          <h4 style={sectionTitle}>Charges (Rs.)</h4>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(12, 1fr)", gap: 12 }}>
            <div style={{ gridColumn: "span 4" }}><label style={labelStyle}>Hospitalization</label><input style={fieldStyle} inputMode="decimal" value={form.hospitalization} onChange={set("hospitalization")} placeholder="Amount" /></div>
            <div style={{ gridColumn: "span 4" }}><label style={labelStyle}>Lab investigation</label><input style={fieldStyle} inputMode="decimal" value={form.lab} onChange={set("lab")} placeholder="Amount" /></div>
            <div style={{ gridColumn: "span 4" }}><label style={labelStyle}>Medicine</label><input style={fieldStyle} inputMode="decimal" value={form.medicine} onChange={set("medicine")} placeholder="Amount" /></div>
          </div>
          <div style={{ marginTop: 12, padding: "10px 12px", background: "#f0fdfa", border: "1px solid #99f6e4", borderRadius: 8 }}>
            <div style={{ fontWeight: 800, fontSize: 16 }}>Total Rs. {money(total)}</div>
            <div style={{ color: "#334155", fontSize: 13 }}>{rupeesInWords(total)} rupees only</div>
          </div>
        </section>

        <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, marginTop: 6, flexWrap: "wrap" }}>
          <Button variant="secondary" onClick={onClose}>Close</Button>
          <Button variant="secondary" onClick={() => void handlePrint()}>🖨️ Print</Button>
          <Button onClick={() => void handleShare()} style={{ background: "#16a34a", borderColor: "#16a34a", color: "#fff" }}>💬 Share PDF on WhatsApp</Button>
        </div>
      </div>
    </Modal>
  );
}
