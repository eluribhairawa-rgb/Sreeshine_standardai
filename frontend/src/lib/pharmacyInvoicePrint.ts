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
