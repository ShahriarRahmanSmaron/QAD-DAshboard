type ExportImageType = "png" | "jpeg" | "svg";

const IMAGE_MIME: Record<ExportImageType, string> = {
  png: "image/png",
  jpeg: "image/jpeg",
  svg: "image/svg+xml;charset=utf-8",
};

export function triggerDownload(blob: Blob, filename: string) {
  const url = window.URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  document.body.removeChild(anchor);
  window.setTimeout(() => window.URL.revokeObjectURL(url), 1000);
}

export function queryString(params: Record<string, unknown>) {
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === null || value === "") continue;
    if (Array.isArray(value)) {
      value.forEach((item) => {
        if (item !== undefined && item !== null && item !== "") {
          query.append(key, String(item));
        }
      });
      continue;
    }
    query.set(key, String(value));
  }
  return query.toString();
}

export async function downloadBinary(path: string, filename: string) {
  const response = await fetch(path, { cache: "no-store" });
  if (!response.ok) {
    throw new Error(`Export failed with status ${response.status}.`);
  }
  const blob = await response.blob();
  const disposition = response.headers.get("Content-Disposition");
  const match = /filename\*?=(?:UTF-8'')?"?([^";]+)"?/i.exec(disposition ?? "");
  triggerDownload(blob, match?.[1] ? decodeURIComponent(match[1]) : filename);
}

export async function auditClientExport(
  action: string,
  format: string,
  reportType: string | null = null,
  filters: Record<string, unknown> = {},
) {
  try {
    await fetch("/api/reports/exports/audit", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        action,
        format,
        report_type: reportType,
        filters,
      }),
    });
  } catch (error) {
    console.error("Failed to record export audit log:", error);
  }
}

function cloneSvg(svg: SVGSVGElement) {
  const clone = svg.cloneNode(true) as SVGSVGElement;
  const width = svg.clientWidth || Number(svg.getAttribute("width")) || 900;
  const height = svg.clientHeight || Number(svg.getAttribute("height")) || 420;
  clone.setAttribute("xmlns", "http://www.w3.org/2000/svg");
  clone.setAttribute("width", String(width));
  clone.setAttribute("height", String(height));
  clone.setAttribute("viewBox", clone.getAttribute("viewBox") ?? `0 0 ${width} ${height}`);
  return { clone, width, height };
}

export async function exportChartElement(
  container: HTMLElement | null,
  type: ExportImageType,
  filename: string,
  reportType: string | null = null,
  filters: Record<string, unknown> = {},
) {
  const source = container?.querySelector("svg");
  if (!(source instanceof SVGSVGElement)) {
    throw new Error("No rendered chart SVG is available to export.");
  }

  const { clone, width, height } = cloneSvg(source);
  const serialized = new XMLSerializer().serializeToString(clone);

  // Trigger audit log entry asynchronously
  void auditClientExport("chart.export", type, reportType, filters);

  if (type === "svg") {
    triggerDownload(new Blob([serialized], { type: IMAGE_MIME.svg }), filename);
    return;
  }

  const image = new Image();
  const svgBlob = new Blob([serialized], { type: IMAGE_MIME.svg });
  const url = window.URL.createObjectURL(svgBlob);
  try {
    await new Promise<void>((resolve, reject) => {
      image.onload = () => resolve();
      image.onerror = () => reject(new Error("Unable to render chart image."));
      image.src = url;
    });
    const canvas = document.createElement("canvas");
    canvas.width = Math.ceil(width * window.devicePixelRatio);
    canvas.height = Math.ceil(height * window.devicePixelRatio);
    canvas.style.width = `${width}px`;
    canvas.style.height = `${height}px`;
    const context = canvas.getContext("2d");
    if (!context) {
      throw new Error("Canvas export is not available in this browser.");
    }
    context.scale(window.devicePixelRatio, window.devicePixelRatio);
    context.fillStyle = "#ffffff";
    context.fillRect(0, 0, width, height);
    context.drawImage(image, 0, 0, width, height);
    const blob = await new Promise<Blob>((resolve, reject) => {
      canvas.toBlob(
        (result) => (result ? resolve(result) : reject(new Error("Image export failed."))),
        IMAGE_MIME[type],
        type === "jpeg" ? 0.92 : undefined,
      );
    });
    triggerDownload(blob, filename);
  } finally {
    window.URL.revokeObjectURL(url);
  }
}
