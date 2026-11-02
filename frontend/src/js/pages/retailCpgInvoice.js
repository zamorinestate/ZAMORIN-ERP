/**
 * RETAIL & WHOLESALE CPG INVOICING (F309–F316, A003)
 *
 * There is no backend contract for a separate retail/wholesale invoice (no tier price
 * lists, no HSN-wise GST engine, no IRN / E-Invoice or E-Way Bill service). The earlier
 * screen produced invoices, IRN QR codes and credit notes locally with invented stock and
 * prices, which is not acceptable for a billing screen. It now says so plainly and points
 * to the real billing flow instead of simulating one.
 */

export function renderRetailCpg() {
  return `
    <div id="retail-cpg-container" class="page-enter" style="max-width:720px; margin:48px auto; padding:0 16px;">
      <div class="card card-pad" style="padding:28px;">
        <h1 style="font-size:20px; font-weight:800; margin:0 0 8px; color:var(--ink);">Retail &amp; wholesale invoicing is not connected</h1>
        <p style="color:var(--mute); font-size:14px; line-height:1.6; margin:0 0 14px;">
          This screen does not create invoices. The server has no retail/wholesale tier pricing, E-Invoice (IRN)
          or credit-note service behind it, so nothing here can be billed or saved.
        </p>
        <ul style="color:var(--mute); font-size:13.5px; line-height:1.7; margin:0 0 18px 18px; padding:0;">
          <li>Sell packaged items from the <strong>POS till</strong> — bills there are real and tax-calculated by the server.</li>
          <li>Refund or reverse a bill from the till's bill history (<em>Refund</em> on the original bill).</li>
        </ul>
        <button class="btn btn-primary" id="btn-cpg-open-pos" type="button">Open POS till</button>
      </div>
    </div>`;
}

export function wireRetailCpg(container) {
  const root = container || document.getElementById("page-content") || document.body;
  root.querySelector("#btn-cpg-open-pos")?.addEventListener("click", () => {
    location.hash = "#pos";
  });
}
