import { useEffect, useState, useMemo } from "react";
import type { Dispatch, SetStateAction } from "react";
import { Button, Input, Modal } from "../../components/ui";
import { apiFetch, reportError } from "../../lib/api";
import type { Notice } from "../../types";

type Props = {
  setNotice: Dispatch<SetStateAction<Notice | null>>;
  onNavigate: (pageId: string) => void;
};

type Medicine = {
  id: number;
  name: string;
  generic_name?: string;
  category?: string;
  dosage_form?: string;
  strength?: string;
  unit?: string;
  hsn_code?: string;
  gst_rate?: number;
  manufacturer?: string;
  reorder_level?: number;
  active?: boolean;
};

type StoreLocation = { name: string; code: string; desc: string };
const EMPTY_LOCATION: StoreLocation = { name: "", code: "", desc: "" };

export default function PharmacySettings({ setNotice, onNavigate }: Props) {
  const [activeTab, setActiveTab] = useState<"medicines" | "categories" | "stores" | "print">("medicines");
  const [medicines, setMedicines] = useState<Medicine[]>([]);
  const [loading, setLoading] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");

  // Medicine Form Modal
  const [medModalOpen, setMedModalOpen] = useState(false);
  const [editingMed, setEditingMed] = useState<Medicine | null>(null);
  const [formName, setFormName] = useState("");
  const [formGeneric, setFormGeneric] = useState("");
  const [formCategory, setFormCategory] = useState("Tablet");
  const [formDosage, setFormDosage] = useState("Oral");
  const [formStrength, setFormStrength] = useState("");
  const [formUnit, setFormUnit] = useState("Strip");
  const [formHsn, setFormHsn] = useState("3004");
  const [formGst, setFormGst] = useState<number>(12);
  const [formMfr, setFormMfr] = useState("");
  const [formReorder, setFormReorder] = useState<number>(20);
  const [submittingMed, setSubmittingMed] = useState(false);

  // Print settings
  const [hospitalHeader, setHospitalHeader] = useState("HospAI & HEALTHCARE");
  const [hospitalAddress, setHospitalAddress] = useState("Main Road, Hospital Campus, Contact: +91 800-1234567");
  const [dlNumber, setDlNumber] = useState("DL-20B-102938 / DL-21B-102939");
  const [gstin, setGstin] = useState("36AAAAA0000A1Z5");

  // Load medicines
  const loadMedicines = async () => {
    setLoading(true);
    try {
      const res = await apiFetch<{ medicines: Medicine[] }>("/api/pharmacy/medicines");
      if (res?.medicines) {
        setMedicines(res.medicines);
      }
    } catch (err) {
      reportError(setNotice, err as any, "Failed to load medicines");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void loadMedicines();
    void loadSettings();
  }, []);

  // Dosage forms & categories and store / rack locations: kept on the server, shared by every desk.
  const [dosageForms, setDosageForms] = useState<string[]>([]);
  const [storeLocations, setStoreLocations] = useState<StoreLocation[]>([]);
  const [savingSettings, setSavingSettings] = useState(false);
  const [newForm, setNewForm] = useState("");
  const [editingFormIdx, setEditingFormIdx] = useState<number | null>(null);
  const [editingFormText, setEditingFormText] = useState("");
  const [locationDraft, setLocationDraft] = useState<StoreLocation>(EMPTY_LOCATION);
  const [editingLocIdx, setEditingLocIdx] = useState<number | null>(null);

  const loadSettings = async () => {
    try {
      const res = await apiFetch<{ dosage_forms: string[]; store_locations: StoreLocation[] }>("/api/pharmacy/settings");
      setDosageForms(res?.dosage_forms || []);
      setStoreLocations(res?.store_locations || []);
    } catch (err) {
      reportError(setNotice, err as any, "Failed to load pharmacy settings");
    }
  };

  const saveSettings = async (patch: { dosage_forms?: string[]; store_locations?: StoreLocation[] }, message: string) => {
    setSavingSettings(true);
    try {
      const res = await apiFetch<{ dosage_forms: string[]; store_locations: StoreLocation[] }>("/api/pharmacy/settings", {
        method: "PUT",
        body: JSON.stringify(patch),
      });
      setDosageForms(res.dosage_forms || []);
      setStoreLocations(res.store_locations || []);
      setNotice({ type: "success", message });
      return true;
    } catch (err) {
      reportError(setNotice, err as any, "Failed to save pharmacy settings");
      return false;
    } finally {
      setSavingSettings(false);
    }
  };

  const addDosageForm = async () => {
    const name = newForm.trim().replace(/\s+/g, " ");
    if (!name) return;
    if (dosageForms.some((f) => f.toLowerCase() === name.toLowerCase())) {
      setNotice({ type: "warning", message: `"${name}" is already in the list.` });
      return;
    }
    if (await saveSettings({ dosage_forms: [...dosageForms, name] }, `Added "${name}".`)) setNewForm("");
  };

  const renameDosageForm = async (idx: number) => {
    const name = editingFormText.trim().replace(/\s+/g, " ");
    if (!name) return;
    if (dosageForms.some((f, i) => i !== idx && f.toLowerCase() === name.toLowerCase())) {
      setNotice({ type: "warning", message: `"${name}" is already in the list.` });
      return;
    }
    const next = dosageForms.map((f, i) => (i === idx ? name : f));
    if (await saveSettings({ dosage_forms: next }, `Renamed to "${name}".`)) setEditingFormIdx(null);
  };

  const removeDosageForm = (idx: number) =>
    void saveSettings({ dosage_forms: dosageForms.filter((_, i) => i !== idx) }, `Removed "${dosageForms[idx]}".`);

  const saveLocation = async () => {
    const draft = {
      name: locationDraft.name.trim(),
      code: locationDraft.code.trim().toUpperCase().replace(/\s+/g, "-"),
      desc: locationDraft.desc.trim(),
    };
    if (!draft.name || !draft.code) {
      setNotice({ type: "warning", message: "Location name and code are required." });
      return;
    }
    if (storeLocations.some((l, i) => i !== editingLocIdx && l.code === draft.code)) {
      setNotice({ type: "warning", message: `Code ${draft.code} is already used by another location.` });
      return;
    }
    const next = editingLocIdx === null
      ? [...storeLocations, draft]
      : storeLocations.map((l, i) => (i === editingLocIdx ? draft : l));
    if (await saveSettings({ store_locations: next }, editingLocIdx === null ? `Added location ${draft.name}.` : `Updated ${draft.name}.`)) {
      setLocationDraft(EMPTY_LOCATION);
      setEditingLocIdx(null);
    }
  };

  const removeLocation = (idx: number) => {
    void saveSettings({ store_locations: storeLocations.filter((_, i) => i !== idx) }, `Removed ${storeLocations[idx].name}.`);
    if (editingLocIdx === idx) { setEditingLocIdx(null); setLocationDraft(EMPTY_LOCATION); }
  };

  // Filtered
  const filteredMeds = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    if (!q) return medicines;
    return medicines.filter((m) =>
      m.name.toLowerCase().includes(q) ||
      (m.generic_name || "").toLowerCase().includes(q) ||
      (m.category || "").toLowerCase().includes(q)
    );
  }, [medicines, searchQuery]);

  // Open Add
  const handleOpenAdd = () => {
    setEditingMed(null);
    setFormName("");
    setFormGeneric("");
    setFormCategory("Tablet");
    setFormDosage("Oral");
    setFormStrength("");
    setFormUnit("Strip");
    setFormHsn("3004");
    setFormGst(12);
    setFormMfr("");
    setFormReorder(20);
    setMedModalOpen(true);
  };

  // Open Edit
  const handleOpenEdit = (m: Medicine) => {
    setEditingMed(m);
    setFormName(m.name);
    setFormGeneric(m.generic_name || "");
    setFormCategory(m.category || "Tablet");
    setFormDosage(m.dosage_form || "Oral");
    setFormStrength(m.strength || "");
    setFormUnit(m.unit || "Strip");
    setFormHsn(m.hsn_code || "3004");
    setFormGst(m.gst_rate || 12);
    setFormMfr(m.manufacturer || "");
    setFormReorder(m.reorder_level || 20);
    setMedModalOpen(true);
  };

  // Save Medicine
  const handleSaveMedicine = async () => {
    if (!formName.trim()) {
      setNotice({ type: "warning", message: "Medicine name is required." });
      return;
    }

    setSubmittingMed(true);
    try {
      const payload = {
        name: formName,
        generic_name: formGeneric,
        category: formCategory,
        dosage_form: formDosage,
        strength: formStrength,
        unit: formUnit,
        hsn_code: formHsn,
        gst_rate: formGst,
        manufacturer: formMfr,
        reorder_level: formReorder,
        active: true,
      };

      if (editingMed) {
        await apiFetch(`/api/pharmacy/medicines/${editingMed.id}`, {
          method: "PUT",
          body: JSON.stringify(payload),
        });
        setNotice({ type: "success", message: `Medicine ${formName} updated.` });
      } else {
        await apiFetch("/api/pharmacy/medicines", {
          method: "POST",
          body: JSON.stringify(payload),
        });
        setNotice({ type: "success", message: `Medicine ${formName} registered in master catalog.` });
      }

      setMedModalOpen(false);
      void loadMedicines();
    } catch (err) {
      reportError(setNotice, err as any, "Failed to save medicine");
    } finally {
      setSubmittingMed(false);
    }
  };

  return (
    <div className="pharmacy-theme-page" style={{ padding: "1.5rem", maxWidth: "1400px", margin: "0 auto" }}>
      {/* Topbar / Breadcrumbs */}
      <div className="pharmacy-topbar" style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "1.25rem", flexWrap: "wrap", gap: "1rem" }}>
        <div className="pharmacy-breadcrumb" style={{ display: "flex", alignItems: "center", gap: "0.5rem", fontSize: "0.875rem", color: "#64748b" }}>
          <span style={{ cursor: "pointer", color: "#3b82f6", fontWeight: 600 }} onClick={() => window.history.back()}>HospAI</span>
          <span>/</span>
          <span style={{ cursor: "pointer", color: "#00828a", fontWeight: 600 }} onClick={() => onNavigate("pharmacy-overview")}>Pharmacy</span>
          <span>/</span>
          <span style={{ color: "#0f172a", fontWeight: 700 }}>Settings</span>
        </div>

        <div style={{ display: "flex", gap: "0.5rem" }}>
          <Button
            type="button"
            className="primary"
            style={{ background: "#00828a", borderColor: "#00828a" }}
            onClick={handleOpenAdd}
          >
            + Add Medicine to Master
          </Button>
          <Button type="button" variant="secondary" onClick={() => void loadMedicines()}>
            Refresh
          </Button>
        </div>
      </div>

      {/* Sub-tabs Navigation */}
      <div style={{ display: "flex", borderBottom: "2px solid #e2e8f0", gap: "1.5rem", marginBottom: "1.5rem", overflowX: "auto" }}>
        {[
          { id: "medicines", label: `Medicine Master (${medicines.length})` },
          { id: "categories", label: "Dosage Forms & Categories" },
          { id: "stores", label: "Store & Rack Locations" },
          { id: "print", label: "Print & Label Settings" },
        ].map((tab) => (
          <button
            key={tab.id}
            type="button"
            style={{
              padding: "0.6rem 0.2rem",
              background: "transparent",
              border: "none",
              borderBottom: activeTab === tab.id ? "3px solid #00828a" : "3px solid transparent",
              color: activeTab === tab.id ? "#00828a" : "#64748b",
              fontWeight: activeTab === tab.id ? 800 : 600,
              fontSize: "0.9rem",
              cursor: "pointer",
            }}
            onClick={() => setActiveTab(tab.id as any)}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* 1. MEDICINE MASTER */}
      {activeTab === "medicines" && (
        <div style={{ background: "#ffffff", borderRadius: "10px", padding: "1.25rem", border: "1px solid #e2e8f0", boxShadow: "0 1px 3px rgba(0,0,0,0.05)" }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "1rem", flexWrap: "wrap", gap: "0.75rem" }}>
            <div style={{ width: "320px" }}>
              <Input
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Search master catalog..."
              />
            </div>
            <div style={{ fontSize: "0.85rem", color: "#64748b" }}>
              Showing {filteredMeds.length} medicines
            </div>
          </div>

          <div style={{ overflowX: "auto" }}>
            <table className="pharmacy-data-table" style={{ width: "100%", borderCollapse: "collapse", fontSize: "0.85rem" }}>
              <thead>
                <tr style={{ borderBottom: "2px solid #e2e8f0", textAlign: "left", color: "#64748b" }}>
                  <th style={{ padding: "0.5rem" }}>Brand / Commercial Name</th>
                  <th style={{ padding: "0.5rem" }}>Generic Composition</th>
                  <th style={{ padding: "0.5rem" }}>Dosage Form</th>
                  <th style={{ padding: "0.5rem" }}>Strength</th>
                  <th style={{ padding: "0.5rem", textAlign: "center" }}>Reorder Level</th>
                  <th style={{ padding: "0.5rem", textAlign: "right" }}>GST %</th>
                  <th style={{ padding: "0.5rem", textAlign: "center" }}>Status</th>
                  <th style={{ padding: "0.5rem", textAlign: "right" }}>Action</th>
                </tr>
              </thead>
              <tbody>
                {filteredMeds.map((m) => (
                  <tr key={m.id} style={{ borderBottom: "1px solid #f1f5f9" }}>
                    <td style={{ padding: "0.5rem", fontWeight: 700, color: "#0f172a" }}>{m.name}</td>
                    <td style={{ padding: "0.5rem", color: "#475569" }}>{m.generic_name || "-"}</td>
                    <td style={{ padding: "0.5rem", color: "#64748b" }}>{m.category || m.dosage_form || "Tablet"}</td>
                    <td style={{ padding: "0.5rem", color: "#334155" }}>{m.strength || "-"}</td>
                    <td style={{ padding: "0.5rem", textAlign: "center", fontWeight: 600 }}>{m.reorder_level || 20}</td>
                    <td style={{ padding: "0.5rem", textAlign: "right", color: "#64748b" }}>{m.gst_rate || 12}%</td>
                    <td style={{ padding: "0.5rem", textAlign: "center" }}>
                      <span style={{ padding: "2px 8px", borderRadius: "10px", fontSize: "0.72rem", fontWeight: 700, background: "#dcfce7", color: "#166534" }}>
                        Active
                      </span>
                    </td>
                    <td style={{ padding: "0.5rem", textAlign: "right" }}>
                      <Button
                        type="button"
                        variant="secondary"
                        style={{ padding: "2px 10px", fontSize: "0.78rem" }}
                        onClick={() => handleOpenEdit(m)}
                      >
                        Edit
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* 2. CATEGORIES & FORMS */}
      {activeTab === "categories" && (
        <div style={{ background: "#ffffff", borderRadius: "10px", padding: "1.5rem", border: "1px solid #e2e8f0", boxShadow: "0 1px 3px rgba(0,0,0,0.05)" }}>
          <h3 style={{ margin: "0 0 1rem 0", fontSize: "1.1rem", fontWeight: 700, color: "#0f172a" }}>
            Configured Dosage Forms & Therapeutic Categories
          </h3>
          <div style={{ display: "flex", gap: "8px", marginBottom: "1rem", maxWidth: "560px" }}>
            <Input
              value={newForm}
              onChange={(e) => setNewForm(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); void addDosageForm(); } }}
              placeholder="New dosage form / category (e.g. Suppositories)"
              maxLength={80}
              style={{ flex: 1 }}
            />
            <Button type="button" variant="primary" onClick={() => void addDosageForm()} disabled={savingSettings || !newForm.trim()}>
              + Add
            </Button>
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: "1rem" }}>
            {dosageForms.map((cat, idx) => (
              <div key={`${cat}-${idx}`} style={{ background: "#f8fafc", padding: "0.85rem 1rem", borderRadius: "8px", border: "1px solid #e2e8f0", fontWeight: 600, color: "#334155" }}>
                {editingFormIdx === idx ? (
                  <div style={{ display: "flex", gap: "6px" }}>
                    <Input
                      autoFocus
                      value={editingFormText}
                      maxLength={80}
                      onChange={(e) => setEditingFormText(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") { e.preventDefault(); void renameDosageForm(idx); }
                        if (e.key === "Escape") setEditingFormIdx(null);
                      }}
                      style={{ flex: 1, height: "32px" }}
                    />
                    <Button type="button" variant="primary" style={{ padding: "2px 10px" }} onClick={() => void renameDosageForm(idx)} disabled={savingSettings}>Save</Button>
                  </div>
                ) : (
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: "8px" }}>
                    <span>✓ {cat}</span>
                    <span style={{ display: "flex", gap: "4px", flexShrink: 0 }}>
                      <button type="button" title="Rename" onClick={() => { setEditingFormIdx(idx); setEditingFormText(cat); }}
                        style={{ background: "none", border: "none", color: "#00828a", cursor: "pointer", fontSize: "12px", fontWeight: 700 }}>Edit</button>
                      <button type="button" title="Remove" onClick={() => removeDosageForm(idx)} disabled={savingSettings}
                        style={{ background: "none", border: "none", color: "#dc2626", cursor: "pointer", fontSize: "13px", fontWeight: 700 }}>✕</button>
                    </span>
                  </div>
                )}
              </div>
            ))}
            {dosageForms.length === 0 && (
              <div style={{ color: "#64748b", fontSize: "13px" }}>No dosage forms configured. Add one above.</div>
            )}
          </div>
        </div>
      )}

      {/* 3. STORE & RACK LOCATIONS */}
      {activeTab === "stores" && (
        <div style={{ background: "#ffffff", borderRadius: "10px", padding: "1.5rem", border: "1px solid #e2e8f0", boxShadow: "0 1px 3px rgba(0,0,0,0.05)" }}>
          <h3 style={{ margin: "0 0 1rem 0", fontSize: "1.1rem", fontWeight: 700, color: "#0f172a" }}>
            Physical Store & Rack Locations
          </h3>
          <div style={{ display: "grid", gridTemplateColumns: "1.4fr 1fr 2fr auto", gap: "8px", alignItems: "center", marginBottom: "1rem", background: editingLocIdx !== null ? "#f0fdfa" : "transparent", padding: editingLocIdx !== null ? "8px" : 0, borderRadius: "8px" }}>
            <Input value={locationDraft.name} maxLength={80} placeholder="Location name (e.g. OT Pharmacy)"
              onChange={(e) => setLocationDraft((p) => ({ ...p, name: e.target.value }))} />
            <Input value={locationDraft.code} maxLength={40} placeholder="Code (e.g. RACK-OT)"
              onChange={(e) => setLocationDraft((p) => ({ ...p, code: e.target.value.toUpperCase() }))} />
            <Input value={locationDraft.desc} maxLength={200} placeholder="Description (optional)"
              onChange={(e) => setLocationDraft((p) => ({ ...p, desc: e.target.value }))}
              onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); void saveLocation(); } }} />
            <div style={{ display: "flex", gap: "6px" }}>
              <Button type="button" variant="primary" onClick={() => void saveLocation()} disabled={savingSettings}>
                {editingLocIdx === null ? "+ Add" : "Save"}
              </Button>
              {editingLocIdx !== null && (
                <Button type="button" variant="secondary" onClick={() => { setEditingLocIdx(null); setLocationDraft(EMPTY_LOCATION); }}>Cancel</Button>
              )}
            </div>
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: "1rem" }}>
            {storeLocations.map((loc, idx) => (
              <div key={loc.code} style={{ background: editingLocIdx === idx ? "#f0fdfa" : "#f8fafc", padding: "1rem", borderRadius: "8px", border: `1px solid ${editingLocIdx === idx ? "#99f6e4" : "#e2e8f0"}` }}>
                <div style={{ display: "flex", justifyContent: "space-between", gap: "8px" }}>
                  <div style={{ fontWeight: 700, color: "#0f172a" }}>{loc.name}</div>
                  <span style={{ display: "flex", gap: "4px", flexShrink: 0 }}>
                    <button type="button" title="Edit" onClick={() => { setEditingLocIdx(idx); setLocationDraft(loc); }}
                      style={{ background: "none", border: "none", color: "#00828a", cursor: "pointer", fontSize: "12px", fontWeight: 700 }}>Edit</button>
                    <button type="button" title="Remove" onClick={() => removeLocation(idx)} disabled={savingSettings}
                      style={{ background: "none", border: "none", color: "#dc2626", cursor: "pointer", fontSize: "13px", fontWeight: 700 }}>✕</button>
                  </span>
                </div>
                <div style={{ fontSize: "0.75rem", color: "#00828a", fontWeight: 600, marginTop: "2px" }}>{loc.code}</div>
                {loc.desc && <div style={{ fontSize: "0.8rem", color: "#64748b", marginTop: "6px" }}>{loc.desc}</div>}
              </div>
            ))}
            {storeLocations.length === 0 && (
              <div style={{ color: "#64748b", fontSize: "13px" }}>No store locations configured. Add one above.</div>
            )}
          </div>
        </div>
      )}

      {/* 4. PRINT & LABEL SETTINGS */}
      {activeTab === "print" && (
        <div style={{ background: "#ffffff", borderRadius: "10px", padding: "1.5rem", border: "1px solid #e2e8f0", boxShadow: "0 1px 3px rgba(0,0,0,0.05)", maxWidth: "700px" }}>
          <h3 style={{ margin: "0 0 1rem 0", fontSize: "1.1rem", fontWeight: 700, color: "#0f172a" }}>
            Invoice Header & Label Printing Configuration
          </h3>

          <div style={{ display: "flex", flexDirection: "column", gap: "1rem", marginBottom: "1.5rem" }}>
            <div>
              <label style={{ display: "block", fontSize: "0.8rem", fontWeight: 600, color: "#475569", marginBottom: "4px" }}>
                Hospital / Pharmacy Name on Invoices:
              </label>
              <Input
                value={hospitalHeader}
                onChange={(e) => setHospitalHeader(e.target.value)}
              />
            </div>
            <div>
              <label style={{ display: "block", fontSize: "0.8rem", fontWeight: 600, color: "#475569", marginBottom: "4px" }}>
                Campus Address & Contact Line:
              </label>
              <Input
                value={hospitalAddress}
                onChange={(e) => setHospitalAddress(e.target.value)}
              />
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "1rem" }}>
              <div>
                <label style={{ display: "block", fontSize: "0.8rem", fontWeight: 600, color: "#475569", marginBottom: "4px" }}>
                  Drug License Numbers:
                </label>
                <Input
                  value={dlNumber}
                  onChange={(e) => setDlNumber(e.target.value)}
                />
              </div>
              <div>
                <label style={{ display: "block", fontSize: "0.8rem", fontWeight: 600, color: "#475569", marginBottom: "4px" }}>
                  GSTIN Number:
                </label>
                <Input
                  value={gstin}
                  onChange={(e) => setGstin(e.target.value)}
                />
              </div>
            </div>
          </div>

          <Button
            type="button"
            className="primary"
            style={{ background: "#00828a", borderColor: "#00828a", fontWeight: 700 }}
            onClick={() => setNotice({ type: "success", message: "Print header settings saved." })}
          >
            Save Print Settings
          </Button>
        </div>
      )}

      {/* Add / Edit Medicine Modal */}
      {medModalOpen && (
        <Modal open={medModalOpen} onClose={() => setMedModalOpen(false)}>
          <div style={{ padding: "1.5rem", maxWidth: "600px" }}>
            <h3 style={{ margin: "0 0 0.5rem 0", color: "#0f172a" }}>
              {editingMed ? `Edit Medicine: ${editingMed.name}` : "Register Medicine in Master Catalog"}
            </h3>
            <p style={{ margin: "0 0 1rem 0", fontSize: "0.85rem", color: "#64748b" }}>
              Configured master record used across OP Dispensing, IPD Medication Orders, and GRN verification.
            </p>

            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "1rem", marginBottom: "1rem" }}>
              <div style={{ gridColumn: "span 2" }}>
                <label style={{ display: "block", fontSize: "0.8rem", fontWeight: 600, color: "#475569", marginBottom: "4px" }}>
                  Commercial / Brand Name *:
                </label>
                <Input
                  value={formName}
                  onChange={(e) => setFormName(e.target.value)}
                  placeholder="e.g. Dolo 650mg Tablet"
                />
              </div>

              <div>
                <label style={{ display: "block", fontSize: "0.8rem", fontWeight: 600, color: "#475569", marginBottom: "4px" }}>
                  Generic Salt / Composition:
                </label>
                <Input
                  value={formGeneric}
                  onChange={(e) => setFormGeneric(e.target.value)}
                  placeholder="e.g. Paracetamol"
                />
              </div>

              <div>
                <label style={{ display: "block", fontSize: "0.8rem", fontWeight: 600, color: "#475569", marginBottom: "4px" }}>
                  Strength:
                </label>
                <Input
                  value={formStrength}
                  onChange={(e) => setFormStrength(e.target.value)}
                  placeholder="e.g. 650mg"
                />
              </div>

              <div>
                <label style={{ display: "block", fontSize: "0.8rem", fontWeight: 600, color: "#475569", marginBottom: "4px" }}>
                  Dosage Form:
                </label>
                <select
                  className="ui-input"
                  style={{ width: "100%", padding: "0.45rem", borderRadius: "6px", border: "1px solid #cbd5e1" }}
                  value={formCategory}
                  onChange={(e) => setFormCategory(e.target.value)}
                >
                  <option value="Tablet">Tablet</option>
                  <option value="Capsule">Capsule</option>
                  <option value="Syrup">Syrup / Suspension</option>
                  <option value="Injection">Injection / IV</option>
                  <option value="Ointment">Ointment / Gel</option>
                  <option value="Drops">Drops</option>
                </select>
              </div>

              <div>
                <label style={{ display: "block", fontSize: "0.8rem", fontWeight: 600, color: "#475569", marginBottom: "4px" }}>
                  Unit / Packaging:
                </label>
                <select
                  className="ui-input"
                  style={{ width: "100%", padding: "0.45rem", borderRadius: "6px", border: "1px solid #cbd5e1" }}
                  value={formUnit}
                  onChange={(e) => setFormUnit(e.target.value)}
                >
                  <option value="Strip">Strip</option>
                  <option value="Bottle">Bottle</option>
                  <option value="Vial">Vial / Ampoule</option>
                  <option value="Tube">Tube</option>
                  <option value="Box">Box</option>
                </select>
              </div>

              <div>
                <label style={{ display: "block", fontSize: "0.8rem", fontWeight: 600, color: "#475569", marginBottom: "4px" }}>
                  HSN / SAC Code:
                </label>
                <Input
                  value={formHsn}
                  onChange={(e) => setFormHsn(e.target.value)}
                  placeholder="3004"
                />
              </div>

              <div>
                <label style={{ display: "block", fontSize: "0.8rem", fontWeight: 600, color: "#475569", marginBottom: "4px" }}>
                  GST Tax Rate (%):
                </label>
                <Input
                  type="number"
                  value={formGst}
                  onChange={(e) => setFormGst(parseInt(e.target.value) || 0)}
                />
              </div>

              <div>
                <label style={{ display: "block", fontSize: "0.8rem", fontWeight: 600, color: "#475569", marginBottom: "4px" }}>
                  Manufacturer / Brand:
                </label>
                <Input
                  value={formMfr}
                  onChange={(e) => setFormMfr(e.target.value)}
                  placeholder="e.g. Micro Labs Ltd"
                />
              </div>

              <div>
                <label style={{ display: "block", fontSize: "0.8rem", fontWeight: 600, color: "#475569", marginBottom: "4px" }}>
                  Reorder Alert Threshold:
                </label>
                <Input
                  type="number"
                  min={1}
                  value={formReorder}
                  onChange={(e) => setFormReorder(parseInt(e.target.value) || 20)}
                />
              </div>
            </div>

            <div style={{ display: "flex", gap: "0.75rem", justifyContent: "flex-end" }}>
              <Button type="button" variant="secondary" onClick={() => setMedModalOpen(false)}>
                Cancel
              </Button>
              <Button
                type="button"
                className="primary"
                style={{ background: "#00828a", borderColor: "#00828a", fontWeight: 700 }}
                disabled={submittingMed}
                onClick={handleSaveMedicine}
              >
                {submittingMed ? "Saving..." : "Save Medicine"}
              </Button>
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
}
