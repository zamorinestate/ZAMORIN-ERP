// Bulk actions with a preview of the exact records and a per-record result (plan Z007 / Z038).
// One failing record never makes the others look successful, and nothing is reported as done
// until the server has answered for that record.
import { openModal } from "../components.js";

const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));

/**
 * @param {object} o
 * @param {string} o.title            Dialog title.
 * @param {string} [o.intro]          One sentence saying what will happen.
 * @param {Array<{id:string,label:string,detail?:string}>} o.items  The exact records.
 * @param {(item:object)=>Promise<any>} o.run  Called once per record; throw to mark it failed.
 * @param {string} [o.confirmLabel]
 * @param {()=>void|Promise<void>} [o.onDone] Called after the run (refresh the list).
 */
export function openBulkPreview({ title, intro = "", items = [], run, confirmLabel = "Run for all", onDone }) {
  if (!items.length) return;
  const rows = items.map((it, i) => `<li data-bp-row="${i}" style="display:flex;gap:10px;align-items:center;justify-content:space-between;padding:8px 10px;border:1px solid var(--line);border-radius:8px;font-size:12px">
      <span><b>${esc(it.label)}</b>${it.detail ? `<span style="display:block;color:var(--mute)">${esc(it.detail)}</span>` : ""}</span>
      <span data-bp-state class="badge">Waiting</span></li>`).join("");
  openModal({
    title: esc(title),
    saveLabel: confirmLabel,
    cancelLabel: "Close",
    maxWidth: "560px",
    body: `<p style="margin:0 0 10px;font-size:13px">${esc(intro)} <b>${items.length}</b> record${items.length === 1 ? "" : "s"} will be processed one by one. Each gets its own result.</p>
      <ul id="bp-list" style="list-style:none;margin:0;padding:0;display:flex;flex-direction:column;gap:6px;max-height:48vh;overflow:auto">${rows}</ul>
      <div id="bp-summary" role="status" aria-live="polite" style="margin-top:10px;font-size:12px;min-height:16px"></div>`,
    onSave: () => {
      const btn = document.querySelector("[data-modal-save]");
      if (!btn || btn.dataset.bpRan) return false;
      btn.dataset.bpRan = "1";
      btn.disabled = true;
      btn.textContent = "Working…";
      (async () => {
        let ok = 0; let bad = 0;
        for (let i = 0; i < items.length; i++) {
          const row = document.querySelector(`[data-bp-row="${i}"] [data-bp-state]`);
          if (row) { row.textContent = "Sending"; }
          try {
            await run(items[i]);
            ok++;
            if (row) { row.textContent = "Done"; row.className = "badge badge-ok"; }
          } catch (err) {
            bad++;
            if (row) {
              row.textContent = "Failed";
              row.className = "badge badge-err";
              row.title = String(err?.message || "Failed");
              const msg = document.createElement("span");
              msg.style.cssText = "display:block;color:var(--err);font-size:11px;margin-top:2px";
              msg.textContent = String(err?.message || "The server rejected this record.");
              row.previousElementSibling?.appendChild(msg);
            }
          }
        }
        const sum = document.querySelector("#bp-summary");
        if (sum) sum.innerHTML = `<b>${ok}</b> succeeded, <b style="color:${bad ? "var(--err)" : "inherit"}">${bad}</b> failed.${bad ? " Failed records were not changed; fix them and run again." : ""}`;
        btn.textContent = "Finished";
        try { await onDone?.(); } catch { /* list refresh is best effort */ }
      })();
      return false; // keep the dialog open to show the results
    },
    onCancel: () => { try { onDone?.(); } catch { /* ignore */ } },
  });
}
