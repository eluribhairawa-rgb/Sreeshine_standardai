import { apiFetch } from "./api";
import { printViaIframe } from "./printViaIframe";
import { buildPrintDocumentHtml } from "./printTemplates";

const inr = (n: unknown) => `\u20B9${(Number(n) || 0).toFixed(2)}`;

/**
 * Prints ONE customer's pharmacy bill. `sales` are the pharmacy_sales rows of a single invoice
 * (as returned by GET /api/pharmacy/sales); a customer with several medicines on one invoice
 * gets one bill listing all of them.
 */
export function printPharmacySaleInvoice(sales: any[]): void {
  if (!sales.length) throw new Error("Nothing to print for this customer.");
  const first = sales[0];
  const isExt = Boolean((first.patient_id && String(first.patient_id).startsWith("EXT-")) || (!first.patient_id && first.customer_name));
  const lineAmount = (s: any) => (s.amount != null ? Number(s.amount) : Number(s.unit_price || 0) * Number(s.quantity || 0));
  const subtotal = sales.reduce((sum, s) => sum + lineAmount(s), 0);
  const hasInvoice = Boolean(first.invoice_id);
  const discount = hasInvoice ? Number(first.invoice_discount || 0) : 0;
  const tax = hasInvoice ? Number(first.gst_amount || 0) : 0;
  const grand = Math.max(0, subtotal - discount + tax);
  const paid = hasInvoice && first.invoice_paid != null ? Number(first.invoice_paid) : grand;
  const due = hasInvoice && first.due_amount != null ? Number(first.due_amount) : Math.max(0, grand - paid);
  const status = (first.payment_status || (due > 0 ? "due" : "paid")).toString().toUpperCase();
  const soldAt = first.sold_at ? new Date(first.sold_at) : new Date();
  const invoiceNo = first.invoice_no || (first.invoice_id ? `INV-${first.invoice_id}` : `SALE-${first.id}`);
  const customer = first.customer_name || (isExt ? "External Customer" : first.patient_id || "-");
  const mode = first.invoice_payment_mode || first.payment_mode;

  printViaIframe(buildPrintDocumentHtml({
    title: "Pharmacy Dispense Invoice",
    subtitleLines: [`Invoice: ${invoiceNo}`, `Date: ${soldAt.toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" })}`],
    meta: [
      { label: isExt ? "Customer Name" : "Patient Name", value: String(customer) },
      { label: isExt ? "Sale Type" : "UHID / Patient ID", value: isExt ? "External sale (no UHID)" : String(first.patient_id || "-") },
      ...(first.customer_mobile ? [{ label: "Mobile", value: String(first.customer_mobile) }] : []),
      { label: "Invoice Number", value: String(invoiceNo) },
      ...(mode ? [{ label: "Payment Mode", value: String(mode).toUpperCase() }] : []),
      { label: "Date & Time", value: soldAt.toLocaleString("en-IN") },
    ],
    columns: ["#", "Medicine", "Qty", "Unit Price", "Amount"],
    alignCenter: [0, 2],
    alignRight: [3, 4],
    rows: sales.map((s, i) => [i + 1, s.medicine_name, s.quantity, inr(s.unit_price), inr(lineAmount(s))]),
    totals: [
      { label: "Subtotal", value: inr(subtotal) },
      ...(discount > 0 ? [{ label: "Discount", value: `-${inr(discount)}` }] : []),
      { label: "GST / Tax", value: inr(tax) },
      { label: "Grand Total", value: inr(grand), grand: true },
      { label: "Amount Paid", value: inr(paid) },
      { label: "Due Balance", value: inr(due) },
      { label: "Payment Status", value: status },
    ],
  }));
}

/** Rows of the same invoice as `sale` out of a list (falls back to just that row when it has no invoice). */
export function salesOfSameInvoice(all: any[], sale: any): any[] {
  if (!sale.invoice_id) return [sale];
  return all.filter((s) => s.invoice_id === sale.invoice_id);
}

/**
 * Loads every line of an invoice from the server (so a filtered list never prints a partial bill)
 * and prints that customer's bill. `fallback` rows are used for a sale that has no invoice.
 */
export async function printPharmacyInvoiceById(invoiceId: number | string | null | undefined, fallback: any[] = []): Promise<void> {
  if (invoiceId) {
    const res = await apiFetch<{ sales: any[] }>(`/api/pharmacy/sales?invoice_id=${encodeURIComponent(String(invoiceId))}`);
    // The server matches invoice numbers loosely, so keep only this invoice's own lines.
    const lines = (res?.sales || []).filter((s) => String(s.invoice_id) === String(invoiceId)).reverse();
    if (lines.length) return printPharmacySaleInvoice(lines);
  }
  printPharmacySaleInvoice(fallback);
}

/** Data printed on a pharmacy return / refund credit note. */
export type PharmacyCreditNote = {
  return_id: number | string;
  refund_amount: number;
  cash_refunded: number;
  due_cancelled: number;
  refund_mode?: string | null;
  invoice_no?: string | null;
  stock_status?: string | null;
  medicine_name: string;
  unit_price: number;
  quantity: number;
  reason?: string | null;
  patient_id?: string | null;
  patient_name?: string | null;
  batch_no?: string | null;
  date: string;
};

const stockOutcome = (s?: string | null) =>
  s === "released" ? "Restocked" : s === "rejected" ? "Written off (damaged)" : "Quarantined";

/** Prints the credit note (return / refund bill) of one pharmacy return. */
export function printPharmacyCreditNote(b: PharmacyCreditNote): void {
  const creditNo = `CN-${String(b.return_id).padStart(6, "0")}`;
  printViaIframe(buildPrintDocumentHtml({
    title: "Pharmacy Return / Refund Bill",
    subtitleLines: [`Credit Note: ${creditNo}`, b.invoice_no ? `Against Invoice: ${b.invoice_no}` : "", `Date: ${b.date}`],
    meta: [
      ...(b.patient_name ? [{ label: "Patient Name", value: String(b.patient_name) }] : []),
      { label: "Patient UHID", value: b.patient_id || "-" },
      { label: "Credit Note No.", value: creditNo },
      { label: "Original Invoice", value: b.invoice_no || "-" },
      { label: "Refund Mode", value: (b.refund_mode || "cash").toUpperCase() },
      { label: "Reason", value: b.reason || "-" },
      { label: "Stock Outcome", value: stockOutcome(b.stock_status) },
    ],
    columns: ["Medicine", "Batch", "Returned Qty", "Unit Price", "Refund Value"],
    rows: [[b.medicine_name, b.batch_no || "-", b.quantity, inr(b.unit_price), inr(b.refund_amount)]],
    totals: [
      ...(b.due_cancelled > 0 ? [{ label: "Unpaid balance cancelled", value: inr(b.due_cancelled) }] : []),
      { label: "Refunded to customer", value: inr(b.cash_refunded) },
      { label: "Total Return Value", value: inr(b.refund_amount), grand: true },
    ],
  }));
}

/**
 * Loads a saved return (GET /api/pharmacy/returns) plus its original invoice number and prints its
 * credit note. `fallback` (e.g. a row of the pharmacy overview) fills anything the server lacks.
 */
export async function printPharmacyCreditNoteById(
  returnId: number | string,
  fallback: Partial<PharmacyCreditNote> = {},
): Promise<void> {
  const pid = fallback.patient_id && !String(fallback.patient_id).startsWith("IP-") && fallback.patient_id !== "-" ? fallback.patient_id : "";
  const res = await apiFetch<{ returns?: any[] }>(`/api/pharmacy/returns${pid ? `?patient_id=${encodeURIComponent(String(pid))}` : ""}`);
  const r = (res?.returns || []).find((x) => String(x.id) === String(returnId));
  if (!r) throw new Error(`Return RET-${returnId} was not found.`);

  let invoiceNo: string | null = null;
  let mode: string | null = fallback.refund_mode || null;
  let name: string | null = fallback.patient_name || null;
  if (r.invoice_id) {
    try {
      const s = await apiFetch<{ sales?: any[] }>(`/api/pharmacy/sales?invoice_id=${encodeURIComponent(String(r.invoice_id))}`);
      const line = (s?.sales || []).find((x) => String(x.invoice_id) === String(r.invoice_id));
      if (line) {
        invoiceNo = line.invoice_no || null;
        mode = line.invoice_payment_mode || line.payment_mode || mode;
        name = name || line.customer_name || null;
      }
    } catch { /* print without the invoice number */ }
  }

  const qty = Number(r.quantity) || 0;
  const unit = Number(r.unit_price) || 0;
  const stored = Number(r.refund_amount) || 0;
  // Older returns stored no refund figures: their value is qty x unit price, refunded in full.
  const refund = Math.round((stored > 0 ? stored : qty * unit) * 100) / 100;
  const cash = stored > 0 ? Number(r.cash_refunded) || 0 : refund;
  const created = r.created_at ? new Date(r.created_at) : null;

  printPharmacyCreditNote({
    return_id: r.id,
    refund_amount: refund,
    cash_refunded: cash,
    due_cancelled: Math.max(0, Math.round((refund - cash) * 100) / 100),
    refund_mode: mode,
    invoice_no: invoiceNo || (r.invoice_id ? `INV-${r.invoice_id}` : null),
    stock_status: r.status,
    medicine_name: r.medicine_name || fallback.medicine_name || "-",
    unit_price: unit,
    quantity: qty,
    reason: r.reason,
    patient_id: r.patient_id || fallback.patient_id || null,
    patient_name: name,
    batch_no: r.batch_no,
    date: created && !isNaN(created.getTime()) ? created.toLocaleString("en-IN") : fallback.date || "",
  });
}
