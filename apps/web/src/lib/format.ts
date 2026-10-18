import { formatMoney, formatRange, type CapturedItem, type ListingDraft, type ScanResult } from "@sourcerer/shared";

/** Turn a listing draft into the plain text a reseller actually pastes. */
export function listingToText(l: ListingDraft): string {
  const lines = [l.title, "", l.description, "", `Price: ${formatMoney(l.price)}`];
  if (l.keywords.length) lines.push("", `Tags: ${l.keywords.join(", ")}`);
  if (l.tips?.length) lines.push("", ...l.tips.map((t) => `• ${t}`));
  return lines.join("\n");
}

/** A tab-separated export a reseller can open straight in a spreadsheet. */
export function itemsToCsv(items: CapturedItem[]): string {
  const head = [
    "created",
    "title",
    "brand",
    "category",
    "condition",
    "status",
    "buyPrice",
    "askingExpected",
    "maxOffer",
    "verdict",
    "soldFor",
    "marketplace",
    "compsSource",
    "confidence",
    "note",
  ];
  const esc = (v: unknown) => {
    const s = v === undefined || v === null ? "" : String(v);
    return /[",\n\t]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const rows = items.map((i) =>
    [
      i.createdAt,
      i.identification.title,
      i.identification.brand,
      i.identification.category,
      i.identification.condition,
      i.status,
      i.buyPrice ?? "",
      i.price.expected,
      i.verdict.maxOffer,
      i.verdict.label,
      i.soldFor ?? "",
      i.cost.marketplace,
      i.comps.source,
      i.verdict.confidence,
      i.note ?? "",
    ]
      .map(esc)
      .join(","),
  );
  return [head.join(","), ...rows].join("\n");
}

export function downloadText(filename: string, text: string, type = "text/csv") {
  const blob = new Blob([text], { type });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/** The short share string for a scan — what you'd text a friend at the same sale. */
export function scanShareText(r: ScanResult): string {
  return [
    `${r.identification.title}`,
    `${r.verdict.label} · don't pay more than ${formatMoney(r.verdict.maxOffer)}`,
    `resale ${formatRange(r.price.low, r.price.high)} (${r.comps.basis})`,
  ].join("\n");
}
