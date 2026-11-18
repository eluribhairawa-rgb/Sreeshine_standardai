import html2canvas from "html2canvas";
import { jsPDF } from "jspdf";
import { buildPrintableHtml, capturePrintHtml } from "./printViaIframe";
import { downloadPDF, drawPdfFooter } from "./exportService";
import { splitStoredPhone, toWhatsAppNumber } from "./phone";

/**
 * WhatsApp links (wa.me / api.whatsapp.com) can only carry text. To send a document as a PDF file the
 * browser's share sheet (Web Share API with files) is used: the user picks WhatsApp there and the PDF is
 * attached. Where the browser cannot share files (e.g. plain http on a LAN IP) the PDF is downloaded and
 * the patient's WhatsApp chat is opened so the downloaded file can be attached.
 */

export type WhatsAppPdfShareOptions = {
  blob: Blob;
  filename: string;
  title: string;
  /** Short message sent along with the file. */
  text?: string;
  phone?: string | null;
  phoneCountryCode?: string | null;
};

export type WhatsAppPdfShareResult = "shared" | "cancelled" | "dialog" | "downloaded";

type Notify = (notice: { type: "success" | "error" | "info" | "warning"; message: string }) => void;

const pdfName = (name: string) => (/\.pdf$/i.test(name) ? name : `${name}.pdf`).replace(/[\\/:*?"<>|]+/g, "_");

function shareNavigator() {
  return navigator as Navigator & {
    canShare?: (data: ShareData & { files?: File[] }) => boolean;
    share?: (data: ShareData & { files?: File[] }) => Promise<void>;
  };
}

/** True when this browser can hand a PDF file to the system share sheet (WhatsApp appears there). */
export function canShareFiles(): boolean {
  const nav = shareNavigator();
  if (typeof nav.share !== "function" || typeof nav.canShare !== "function") return false;
  try {
    return nav.canShare({ files: [new File([new Blob(["%PDF-"])], "test.pdf", { type: "application/pdf" })] });
  } catch {
    return false;
  }
}

/** Opens the patient's WhatsApp chat (or the contact picker) with a text message. */
export function openWhatsAppText(text: string, phone?: string | null, phoneCountryCode?: string | null): void {
  const parts = splitStoredPhone(phone, phoneCountryCode);
  const waNumber = toWhatsAppNumber(parts.countryCode, parts.value);
  const url = waNumber
    ? `https://wa.me/${waNumber}?text=${encodeURIComponent(text)}`
    : `https://api.whatsapp.com/send?text=${encodeURIComponent(text)}`;
  window.open(url, "_blank", "noopener,noreferrer");
}

/** Download the PDF and open WhatsApp with a note to attach it (browsers without file sharing). */
export function downloadAndOpenWhatsApp(opts: WhatsAppPdfShareOptions): void {
  const filename = pdfName(opts.filename);
  downloadPDF(opts.blob, filename);
  const msg = [opts.text || opts.title, `📎 PDF attached: ${filename}`].filter(Boolean).join("\n\n");
  openWhatsAppText(msg, opts.phone, opts.phoneCountryCode);
}

/**
 * Must be called from a click (directly or within a few seconds of it). Shares the PDF file through the
 * system share sheet. Returns "dialog" when the browser refused because the click had expired (slow PDF
 * generation): the Share dialog is then opened, where one more click shares the file.
 */
export async function sharePdfFile(opts: WhatsAppPdfShareOptions, notify?: Notify): Promise<WhatsAppPdfShareResult> {
  const filename = pdfName(opts.filename);
  const file = new File([opts.blob], filename, { type: "application/pdf" });
  const nav = shareNavigator();
  let canShare = false;
  try {
    canShare = typeof nav.share === "function" && typeof nav.canShare === "function" && nav.canShare({ files: [file] });
  } catch {
    canShare = false;
  }

  if (canShare && nav.share) {
    try {
      await nav.share({ files: [file], title: opts.title, text: opts.text || opts.title });
      return "shared";
    } catch (err) {
      const name = err instanceof DOMException ? err.name : "";
      if (name === "AbortError") return "cancelled";
      // NotAllowedError = the click "expired" while the PDF was being made: ask for one more click.
      if (window.__hospai_export_share__) {
        window.__hospai_export_share__({ ...opts, filename, text: opts.text });
        return "dialog";
      }
    }
  }

  downloadAndOpenWhatsApp({ ...opts, filename });
  notify?.({
    type: "info",
    message: `${filename} was downloaded. This browser cannot attach files to WhatsApp directly — attach the downloaded PDF in the WhatsApp chat that just opened.`,
  });
  return "downloaded";
}

// One PDF page of content in capture pixels: A4 minus the 10 mm top and 22 mm footer margins, at a 794 px wide capture.
const PDF_PAGE_PX = Math.floor(((297 - 10 - 22) * 794) / 190);

/** Renders an HTML document (as printed by printViaIframe) into an A4 PDF. */
export async function htmlToPdfBlob(html: string): Promise<Blob> {
  const iframe = document.createElement("iframe");
  iframe.setAttribute("style", `position:fixed;left:-10000px;top:0;width:794px;height:${PDF_PAGE_PX}px;border:0;opacity:0;pointer-events:none;`);
  document.body.appendChild(iframe);
  try {
    const doc = iframe.contentDocument;
    if (!doc) throw new Error("Unable to prepare the PDF.");
    doc.open();
    doc.write(buildPrintableHtml(html));
    doc.close();
    // Let images (logo, watermark) and fonts load before capturing.
    await new Promise<void>((resolve) => {
      const imgs = Array.from(doc.images).filter((img) => !img.complete);
      if (!imgs.length) return resolve();
      let left = imgs.length;
      const done = () => { left -= 1; if (left <= 0) resolve(); };
      imgs.forEach((img) => { img.addEventListener("load", done, { once: true }); img.addEventListener("error", done, { once: true }); });
      setTimeout(resolve, 3000);
    });
    try { await (doc as Document & { fonts?: { ready: Promise<unknown> } }).fonts?.ready; } catch { /* ignore */ }
    doc.body.style.background = "#ffffff";
    return await elementToPdfBlob(doc.body, 794);
  } finally {
    iframe.remove();
  }
}

/** Captures a DOM element into a multi-page A4 PDF (10 mm margins). */
export async function elementToPdfBlob(element: HTMLElement, windowWidth?: number): Promise<Blob> {
  const canvas = await html2canvas(element, {
    scale: 2,
    useCORS: true,
    backgroundColor: "#ffffff",
    windowWidth: windowWidth || element.scrollWidth,
    width: element.scrollWidth,
    height: element.scrollHeight,
  });
  const pdf = new jsPDF({ unit: "mm", format: "a4", orientation: "portrait", compress: true });
  const margin = 10;
  const bottomMargin = 22; // room for the page footer (rule, logo, thank-you line, page number)
  const pageW = 210 - margin * 2;
  const pageH = 297 - margin - bottomMargin;
  const pxPerMm = canvas.width / pageW;
  const sliceH = Math.floor(pageH * pxPerMm);
  let y = 0;
  let first = true;
  while (y < canvas.height) {
    const h = Math.min(sliceH, canvas.height - y);
    if (!first && h < 12) break; // a sliver of padding must not become an extra, blank page
    const part = document.createElement("canvas");
    part.width = canvas.width;
    part.height = h;
    const ctx = part.getContext("2d");
    if (!ctx) break;
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, part.width, h);
    ctx.drawImage(canvas, 0, y, canvas.width, h, 0, 0, canvas.width, h);
    if (!first) pdf.addPage();
    pdf.addImage(part.toDataURL("image/jpeg", 0.92), "JPEG", margin, margin, pageW, h / pxPerMm, undefined, "FAST");
    first = false;
    y += h;
  }
  // The shared hospital footer on every page (the page's own watermark is already in the captured content).
  drawPdfFooter(pdf, { watermark: false });
  return pdf.output("blob");
}

/** Print HTML -> PDF -> WhatsApp (share sheet with the file, or download + chat). */
export async function shareHtmlAsPdfOnWhatsApp(
  html: string,
  opts: Omit<WhatsAppPdfShareOptions, "blob">,
  notify?: Notify,
): Promise<WhatsAppPdfShareResult> {
  try {
    const blob = await htmlToPdfBlob(html);
    return await sharePdfFile({ ...opts, blob }, notify);
  } catch (err) {
    notify?.({ type: "error", message: err instanceof Error ? err.message : "Unable to create the PDF for WhatsApp." });
    return "cancelled";
  }
}

/** An on-screen element (e.g. the live prescription sheet) -> PDF -> WhatsApp. */
export async function shareElementAsPdfOnWhatsApp(
  element: HTMLElement,
  opts: Omit<WhatsAppPdfShareOptions, "blob">,
  notify?: Notify,
): Promise<WhatsAppPdfShareResult> {
  try {
    const blob = await elementToPdfBlob(element);
    return await sharePdfFile({ ...opts, blob }, notify);
  } catch (err) {
    notify?.({ type: "error", message: err instanceof Error ? err.message : "Unable to create the PDF for WhatsApp." });
    return "cancelled";
  }
}

/**
 * Runs a page's print function in capture mode and sends that document to WhatsApp as a PDF.
 * Returns false (and does nothing) when the print function produced no document.
 */
export function sharePrintAsPdfOnWhatsApp(
  runPrint: () => void,
  opts: Omit<WhatsAppPdfShareOptions, "blob">,
  notify?: Notify,
): boolean {
  const html = capturePrintHtml(runPrint);
  if (!html) return false;
  void shareHtmlAsPdfOnWhatsApp(html, opts, notify);
  return true;
}
