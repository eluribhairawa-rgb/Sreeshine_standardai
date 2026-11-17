import { useState } from "react";
import { Modal, Button } from "./ui";
import { downloadPDF, printPDF } from "../lib/exportService";
import { canShareFiles, downloadAndOpenWhatsApp } from "../lib/whatsappPdfShare";

type ExportShareModalProps = {
  open: boolean;
  onClose: () => void;
  options: {
    blob: Blob;
    filename: string;
    title: string;
    text?: string;
    shareUrl?: string;
    phone?: string | null;
    phoneCountryCode?: string | null;
  } | null;
};

export default function ExportShareModal({ open, onClose, options }: ExportShareModalProps) {
  const [copied, setCopied] = useState(false);

  if (!options) return null;
  const { blob, filename, title, text, shareUrl, phone, phoneCountryCode } = options;

  const handleDownload = () => {
    downloadPDF(blob, filename);
    onClose();
  };

  const handlePrint = () => {
    printPDF(blob);
    onClose();
  };

  const handleCopy = async () => {
    if (!shareUrl) return;
    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(shareUrl);
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
      }
    } catch (err) {
      console.error("Failed to copy share link:", err);
    }
  };

  // WhatsApp links can only carry text, so the PDF itself goes through the system share sheet (pick WhatsApp
  // there). This click is a fresh user gesture, which the browser requires for sharing files.
  const handleWhatsApp = async () => {
    const pdfName = /\.pdf$/i.test(filename) ? filename : `${filename}.pdf`;
    const message = [title || "Report / Document", text || "", shareUrl ? `View Online: ${shareUrl}` : ""].filter(Boolean).join("\n\n");
    if (canShareFiles()) {
      try {
        const file = new File([blob], pdfName, { type: "application/pdf" });
        await navigator.share({ files: [file], title: title || pdfName, text: message } as ShareData);
        onClose();
        return;
      } catch (err) {
        if (err instanceof DOMException && err.name === "AbortError") return; // closed the share sheet
      }
    }
    // No file sharing in this browser: download the PDF and open the chat to attach it.
    downloadAndOpenWhatsApp({ blob, filename: pdfName, title: title || "Document", text: message, phone, phoneCountryCode });
    onClose();
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={title || "Share Report"}
      description="Choose an option to share or save the generated report."
      className="ui-modal-compact export-share-modal"
    >
      <div style={{ display: "flex", flexDirection: "column", gap: "12px", marginTop: "16px" }}>
        <Button
          type="button"
          variant="primary"
          onClick={handleDownload}
          style={{ width: "100%", justifyContent: "center" }}
        >
          Download PDF
        </Button>

        <Button
          type="button"
          onClick={() => void handleWhatsApp()}
          style={{
            width: "100%",
            justifyContent: "center",
            background: "#25D366",
            borderColor: "#25D366",
            color: "#ffffff",
            fontWeight: 600,
            display: "inline-flex",
            alignItems: "center",
            gap: "8px",
          }}
        >
          💬 Share PDF via WhatsApp
        </Button>

        <Button
          type="button"
          variant="secondary"
          disabled={!shareUrl}
          onClick={handleCopy}
          style={{ width: "100%", justifyContent: "center", opacity: shareUrl ? 1 : 0.6 }}
        >
          {shareUrl ? (copied ? "Copied Link!" : "Copy Link") : "Copy Link (Not Applicable)"}
        </Button>

        <Button
          type="button"
          variant="secondary"
          onClick={handlePrint}
          style={{ width: "100%", justifyContent: "center" }}
        >
          Print
        </Button>

        <Button
          type="button"
          variant="secondary"
          onClick={onClose}
          style={{ width: "100%", justifyContent: "center" }}
        >
          Cancel
        </Button>
      </div>
    </Modal>
  );
}
