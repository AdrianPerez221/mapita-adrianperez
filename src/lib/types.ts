export type SourceRef = { name: string; url: string };

export type AnalyzeResponse = {
  ok: boolean;
  error?: string;

  coords?: {
    lat: number;
    lon: number;
    display_name?: string | null;
  };

  urban?: any;
  flood?: any;

  report_markdown?: string;

  sources?: SourceRef[];
  limitations?: string[];

  debug?: any;
};
