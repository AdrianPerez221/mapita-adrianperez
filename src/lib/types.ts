export type SourceRef = { name: string; url: string };

export type AnalyzeResponse = {
  ok: boolean;
  error?: string;

  coords?: {
    lat: number;
    lon: number;
    display_name?: string | null;
    address?: Record<string, string> | null;
  };

  urban?: any;
  flood?: any;
  stats?: any;

  report_markdown?: string;

  sources?: SourceRef[];
  limitations?: string[];

  debug?: any;
};

export type CompareResponse = {
  ok: boolean;
  error?: string;
  report_markdown?: string;
  cityA?: any;
  cityB?: any;
  sources?: SourceRef[];
  limitations?: string[];
  debug?: any;
};
