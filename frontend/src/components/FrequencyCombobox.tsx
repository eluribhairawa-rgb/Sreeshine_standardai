import React, { useEffect, useRef, useState } from "react";

/** Frequency dropdown for medicine rows (Doctor Prescription, Doctor Clinicals): pick from the list, type a new one,
 * and manage the list (save the typed value, remove entries, restore defaults). The list is shared between screens. */
export const DEFAULT_FREQUENCIES: string[] = [
  "1-0-1",
  "1-0-0",
  "0-0-1",
  "1-1-1",
  "0-1-0",
  "1-0-1-0",
  "1-1-1-1",
  "SOS",
  "Stat",
  "OD",
  "BD",
  "TDS",
  "QID",
  "Alternate Days",
  "Weekly Once",
];

export const FREQUENCIES_STORAGE_KEY = "hospai_prescription_frequencies";

export function getStoredFrequencies(): string[] {
  try {
    const raw = localStorage.getItem(FREQUENCIES_STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed) && parsed.length > 0) {
        return parsed;
      }
    }
  } catch {
    // fallback
  }
  return DEFAULT_FREQUENCIES;
}

interface FrequencyComboboxProps {
  value: string;
  onChange: (val: string) => void;
  options: string[];
  onAddOption: (opt: string) => void;
  onDeleteOption: (opt: string) => void;
  onResetDefaults?: () => void;
  placeholder?: string;
}

export const FrequencyCombobox: React.FC<FrequencyComboboxProps> = ({
  value,
  onChange,
  options,
  onAddOption,
  onDeleteOption,
  onResetDefaults,
  placeholder = "e.g. 1-0-1 / SOS",
}) => {
  const [isOpen, setIsOpen] = useState(false);
  const [newOption, setNewOption] = useState("");
  const containerRef = useRef<HTMLDivElement>(null);

  // Close on outside click
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setIsOpen(false);
      }
    };
    if (isOpen) {
      document.addEventListener("mousedown", handleClickOutside);
    }
    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
    };
  }, [isOpen]);

  const handleAddNew = (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    const trimmed = newOption.trim();
    if (!trimmed) return;
    onAddOption(trimmed);
    onChange(trimmed);
    setNewOption("");
  };

  const hasCustomTypedValue = value && value.trim() && !options.includes(value.trim());

  return (
    <div ref={containerRef} style={{ position: "relative", width: "100%" }}>
      <div style={{ display: "flex", alignItems: "center", position: "relative" }}>
        <input
          type="text"
          className="table-input"
          placeholder={placeholder}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          onFocus={() => setIsOpen(true)}
          style={{
            paddingRight: "26px",
            fontWeight: 600,
            fontSize: "12.5px",
            height: "32px",
            borderRadius: "4px",
          }}
          autoComplete="off"
          spellCheck={false}
        />
        <button
          type="button"
          onClick={() => setIsOpen((prev) => !prev)}
          title="Toggle frequency dropdown menu"
          aria-label="Toggle frequency dropdown menu"
          style={{
            position: "absolute",
            right: "4px",
            top: "50%",
            transform: "translateY(-50%)",
            background: "transparent",
            border: "none",
            color: "#64748b",
            cursor: "pointer",
            padding: "4px 6px",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            borderRadius: "3px",
            fontSize: "10px",
          }}
        >
          {isOpen ? "▲" : "▼"}
        </button>
      </div>

      {isOpen && (
        <div
          style={{
            position: "absolute",
            top: "calc(100% + 4px)",
            left: 0,
            width: "235px",
            background: "#ffffff",
            border: "1.5px solid #cbd5e1",
            borderRadius: "8px",
            boxShadow: "0 10px 25px -5px rgba(15, 23, 42, 0.2), 0 8px 10px -6px rgba(15, 23, 42, 0.1)",
            zIndex: 1000,
            padding: "6px",
          }}
        >
          {/* Header */}
          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
              padding: "4px 6px 6px",
              borderBottom: "1px solid #f1f5f9",
              fontSize: "11px",
              fontWeight: 700,
              color: "#334155",
            }}
          >
            <span>Frequencies ({options.length})</span>
            {onResetDefaults && (
              <button
                type="button"
                onClick={onResetDefaults}
                style={{
                  background: "none",
                  border: "none",
                  color: "#0284c7",
                  fontSize: "10.5px",
                  fontWeight: 600,
                  cursor: "pointer",
                  padding: 0,
                  textDecoration: "underline",
                }}
                title="Restore default frequencies"
              >
                Reset Defaults
              </button>
            )}
          </div>

          {/* Quick-add current typed text if not yet in options */}
          {hasCustomTypedValue && (
            <div style={{ padding: "4px 2px", borderBottom: "1px solid #f1f5f9" }}>
              <button
                type="button"
                onClick={() => {
                  onAddOption(value.trim());
                }}
                style={{
                  width: "100%",
                  textAlign: "left",
                  background: "#f0fdf4",
                  border: "1px dashed #86efac",
                  borderRadius: "5px",
                  padding: "4px 8px",
                  fontSize: "11px",
                  fontWeight: 600,
                  color: "#166534",
                  cursor: "pointer",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                }}
                title={`Add "${value.trim()}" to saved frequency list`}
              >
                <span>+ Save &quot;{value.trim()}&quot; to list</span>
                <span style={{ fontSize: "12px" }}>↵</span>
              </button>
            </div>
          )}

          {/* Scrollable list of options with delete icon */}
          <div
            style={{
              maxHeight: "160px",
              overflowY: "auto",
              margin: "4px 0",
              display: "flex",
              flexDirection: "column",
              gap: "2px",
            }}
          >
            {options.length === 0 ? (
              <div style={{ padding: "10px", fontSize: "11px", color: "#94a3b8", textAlign: "center" }}>
                No options in list. Add below!
              </div>
            ) : (
              options.map((opt) => {
                const isSelected = opt === value;
                return (
                  <div
                    key={opt}
                    onClick={() => {
                      onChange(opt);
                      setIsOpen(false);
                    }}
                    style={{
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "space-between",
                      padding: "5px 8px",
                      borderRadius: "5px",
                      cursor: "pointer",
                      fontSize: "12px",
                      fontWeight: isSelected ? 700 : 500,
                      background: isSelected ? "#e0f2fe" : "#ffffff",
                      color: isSelected ? "#0369a1" : "#1e293b",
                    }}
                    onMouseEnter={(e) => {
                      if (!isSelected) (e.currentTarget as HTMLDivElement).style.background = "#f8fafc";
                    }}
                    onMouseLeave={(e) => {
                      if (!isSelected) (e.currentTarget as HTMLDivElement).style.background = "#ffffff";
                    }}
                  >
                    <span>{opt}</span>
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        onDeleteOption(opt);
                      }}
                      title={`Remove "${opt}" from dropdown list`}
                      style={{
                        background: "transparent",
                        border: "none",
                        color: "#94a3b8",
                        cursor: "pointer",
                        fontSize: "13px",
                        lineHeight: 1,
                        padding: "2px 5px",
                        borderRadius: "3px",
                        fontWeight: 700,
                      }}
                      onMouseEnter={(e) => {
                        (e.currentTarget as HTMLButtonElement).style.color = "#ef4444";
                        (e.currentTarget as HTMLButtonElement).style.background = "#fee2e2";
                      }}
                      onMouseLeave={(e) => {
                        (e.currentTarget as HTMLButtonElement).style.color = "#94a3b8";
                        (e.currentTarget as HTMLButtonElement).style.background = "transparent";
                      }}
                    >
                      ✕
                    </button>
                  </div>
                );
              })
            )}
          </div>

          {/* Manage: Add new option input form */}
          <div
            style={{
              paddingTop: "6px",
              borderTop: "1px solid #f1f5f9",
            }}
          >
            <form
              onSubmit={handleAddNew}
              style={{
                display: "flex",
                gap: "4px",
                alignItems: "center",
              }}
            >
              <input
                type="text"
                placeholder="New option (e.g. 2-0-2)..."
                value={newOption}
                onChange={(e) => setNewOption(e.target.value)}
                style={{
                  flex: 1,
                  padding: "4px 6px",
                  fontSize: "11px",
                  border: "1px solid #cbd5e1",
                  borderRadius: "4px",
                  outline: "none",
                }}
              />
              <button
                type="button"
                onClick={() => handleAddNew()}
                disabled={!newOption.trim()}
                style={{
                  background: newOption.trim() ? "#0284c7" : "#e2e8f0",
                  color: newOption.trim() ? "#ffffff" : "#94a3b8",
                  border: "none",
                  borderRadius: "4px",
                  padding: "4px 8px",
                  fontSize: "11px",
                  fontWeight: 700,
                  cursor: newOption.trim() ? "pointer" : "default",
                  whiteSpace: "nowrap",
                }}
              >
                + Add
              </button>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};


/** The shared, saved frequency list with the add / remove / reset handlers the combobox needs. */
export function usePrescriptionFrequencies() {
  const [options, setOptions] = useState<string[]>(getStoredFrequencies);
  const persist = (updated: string[]) => {
    setOptions(updated);
    try {
      localStorage.setItem(FREQUENCIES_STORAGE_KEY, JSON.stringify(updated));
    } catch {
      // ignore
    }
  };
  const add = (value: string) => {
    const trimmed = value.trim();
    if (!trimmed || options.includes(trimmed)) return;
    persist([...options, trimmed]);
  };
  const remove = (value: string) => persist(options.filter((opt) => opt !== value));
  const reset = () => persist(DEFAULT_FREQUENCIES);
  return { options, add, remove, reset };
}
