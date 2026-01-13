export type ReportExportOptions = {
  title: string;
  subtitle?: string | null;
  dateLabel: string;
  reportHtml?: string | null;
  reportMarkdown?: string | null;
};

function escapeHtml(value: string) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function sanitizeTitle(value: string) {
  return value.replace(/[\\/:*?"<>|]+/g, "-").trim();
}

function resolveReportHtml(reportHtml?: string | null, reportMarkdown?: string | null) {
  if (reportHtml && reportHtml.trim()) return reportHtml;
  if (reportMarkdown && reportMarkdown.trim()) {
    return `<pre class="markdown-fallback">${escapeHtml(reportMarkdown)}</pre>`;
  }
  return "<p>No hay informe disponible.</p>";
}

export function formatReportDate(date: Date) {
  return new Intl.DateTimeFormat("es-ES", { dateStyle: "long", timeStyle: "short" }).format(date);
}

export function openReportPdf(options: ReportExportOptions) {
  const reportHtml = resolveReportHtml(options.reportHtml, options.reportMarkdown);
  const safeTitle = escapeHtml(options.title);
  const safeSubtitle = options.subtitle ? escapeHtml(options.subtitle) : "";
  const safeDate = escapeHtml(options.dateLabel);
  const documentTitle = escapeHtml(sanitizeTitle(options.title));

  const printWindow = window.open("", "_blank", "width=1040,height=800");
  if (!printWindow) return;
  printWindow.opener = null;

  const html = `
<!doctype html>
<html lang="es">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>${documentTitle}</title>
    <style>
      :root {
        color-scheme: light;
      }
      * {
        box-sizing: border-box;
      }
      body {
        margin: 0;
        background: #f1f5f9;
        color: #0f172a;
        font-family: "Palatino Linotype", "Book Antiqua", Palatino, serif;
      }
      .page {
        max-width: 900px;
        margin: 32px auto 48px;
        background: #ffffff;
        border-radius: 18px;
        box-shadow: 0 24px 50px rgba(15, 23, 42, 0.12);
        padding: 36px 44px 48px;
      }
      header {
        border-bottom: 1px solid #e2e8f0;
        padding-bottom: 16px;
        margin-bottom: 24px;
      }
      .brand {
        text-transform: uppercase;
        letter-spacing: 0.2em;
        font-size: 11px;
        color: #64748b;
      }
      .title {
        margin: 8px 0 6px;
        font-size: 22px;
        letter-spacing: 0.02em;
      }
      .subtitle {
        margin: 0;
        font-size: 14px;
        color: #334155;
      }
      .meta {
        margin-top: 10px;
        display: flex;
        flex-wrap: wrap;
        gap: 12px;
        font-size: 12px;
        color: #64748b;
      }
      .meta span {
        padding: 4px 8px;
        border-radius: 999px;
        background: #f8fafc;
        border: 1px solid #e2e8f0;
      }
      .report h2 {
        margin-top: 26px;
        margin-bottom: 8px;
        font-size: 18px;
        padding-left: 10px;
        border-left: 3px solid #0f766e;
        color: #0f172a;
      }
      .report h3 {
        margin-top: 18px;
        font-size: 15px;
        color: #1f2937;
      }
      .report p {
        margin: 8px 0 12px;
        line-height: 1.6;
        color: #0f172a;
      }
      .report ul,
      .report ol {
        margin: 6px 0 14px 20px;
        line-height: 1.55;
      }
      .report li {
        margin-bottom: 6px;
      }
      .report table {
        width: 100%;
        border-collapse: collapse;
        margin: 12px 0 18px;
        font-size: 12px;
        line-height: 1.35;
      }
      .report th,
      .report td {
        border: 1px solid #e2e8f0;
        padding: 6px 8px;
        text-align: left;
        vertical-align: top;
        word-break: break-word;
      }
      .report th {
        background: #f1f5f9;
        color: #0f172a;
        font-weight: 600;
      }
      .report a {
        color: #0f766e;
        text-decoration: underline;
      }
      .report .markdown-fallback {
        white-space: pre-wrap;
        font-family: "SFMono-Regular", Consolas, "Liberation Mono", Menlo, monospace;
        font-size: 12px;
        background: #f8fafc;
        border: 1px dashed #cbd5f5;
        padding: 12px;
        border-radius: 10px;
      }
      @media print {
        body {
          background: #ffffff;
        }
        .page {
          margin: 0;
          box-shadow: none;
          border-radius: 0;
          padding: 0;
        }
      }
      @page {
        margin: 18mm;
      }
    </style>
  </head>
  <body>
    <div class="page">
      <header>
        <div class="brand">GeoAI Assistant</div>
        <h1 class="title">${safeTitle}</h1>
        ${safeSubtitle ? `<p class="subtitle">${safeSubtitle}</p>` : ""}
        <div class="meta">
          <span>Fecha: ${safeDate}</span>
          <span>Formato PDF</span>
        </div>
      </header>
      <section class="report">
        ${reportHtml}
      </section>
    </div>
  </body>
</html>
  `.trim();

  const triggerPrint = () => {
    printWindow.focus();
    printWindow.print();
  };

  const handleLoad = () => {
    setTimeout(triggerPrint, 120);
  };

  if (typeof printWindow.addEventListener === "function") {
    printWindow.addEventListener("load", handleLoad, { once: true });
  } else {
    printWindow.onload = handleLoad;
  }

  try {
    printWindow.document.open();
    printWindow.document.write(html);
    printWindow.document.close();
  } catch {
    const encoded = encodeURIComponent(html);
    printWindow.location.href = `data:text/html;charset=utf-8,${encoded}`;
  }

  if (printWindow.document.readyState === "complete") {
    handleLoad();
  }

  printWindow.onafterprint = () => {
    printWindow.close();
  };
}
