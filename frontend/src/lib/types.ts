// Shapes returned by the backend (see backend/app/routers).

export type ChangeStatus = "ok" | "missing_current" | "missing_previous" | "zero_base";
export interface Change {
  value: number | null;
  status: ChangeStatus;
}

export interface Coverage {
  dataset: string;
  records: number;
  date_field: string;
  from: string | null;
  to: string | null;
  last_successful_import: string | null;
  sources: string[];
}

export interface SeriesKey {
  geography: string;
  metric: string;
  unit: string;
  source: string;
}

export interface CatalogEntry extends SeriesKey {
  records: number;
  origins: number;
  first_month: string;
  last_month: string;
  non_final_records: number;
}

export interface ComparisonRow {
  visitor_origin: string;
  origin_level: string;
  value: number;
  value_status: string;
  evidence_id: string;
  value_last_year: number | null;
  evidence_id_last_year: string | null;
  share_of_total_pct: number | null;
  yoy: Change;
}

export interface KeyTrend extends CatalogEntry {
  latest_month: string;
  comparison_month: string;
  total: number | null;
  total_evidence_id: string | null;
  total_yoy: Change;
  comparable_origins: number;
  country_rows: number;
  top_growth: ComparisonRow[];
  top_decline: ComparisonRow[];
  largest: ComparisonRow[];
}

export interface SeriesPoint {
  month: string;
  value: number | null;
  evidence_id: string | null;
  value_status: string | null;
  mom: Change;
  yoy: Change;
}

export interface Series {
  origin: string;
  origin_level: string;
  points: SeriesPoint[];
  months_present: number;
  months_missing: number;
}

export interface SeriesResponse extends SeriesKey {
  months: string[];
  series: Series[];
}

export interface Offer {
  evidence_id: string;
  business: string;
  tour_name: string;
  area: string | null;
  price: number | null;
  currency: string | null;
  duration_minutes: number | null;
  language: string;
  url: string | null;
  date_observed: string;
  notes: string | null;
  source: string;
}

export interface CompetitorSummary {
  observations?: number;
  offers: number;
  businesses: number;
  missing_price: number;
  missing_duration?: number;
  duration_median_minutes?: number | null;
  duration_n?: number;
  by_currency: { currency: string; n: number; min: number; median: number; max: number }[];
  by_language: { language: string; offers: number; share_pct: number | null }[];
  observed_from?: string;
  observed_to?: string;
}

export interface FeedbackItem {
  evidence_id: string;
  text: string;
  language: string;
  source: string;
  rating: number | null;
  publication_date: string | null;
  collection_date: string;
  sentiment?: string | null;
}

export interface Theme {
  theme: string;
  count: number;
  share_pct: number | null;
  negative: number | null;
  positive: number | null;
  mixed: number | null;
  examples?: FeedbackItem[];
}

export interface ThemeSummary {
  method: "keyword" | "llm";
  total_feedback: number;
  classified: number;
  unclassified: number;
  themes: Theme[];
  taxonomy: Record<string, string>;
  available_methods: string[];
}

export interface ImportBatch {
  id: number;
  dataset: string;
  importer: string;
  original_filename: string | null;
  status: "success" | "rejected" | "failed";
  rows_total: number;
  rows_inserted: number;
  rows_duplicate: number;
  rows_updated: number;
  started_at: string;
  completed_at: string | null;
  error_count: number;
  errors?: { row: number | null; column: string | null; message: string }[];
  warnings?: string[];
  raw_path?: string;
  file_sha256?: string;
}

export interface DatasetGuide {
  dataset: string;
  label: string;
  notes: string[];
  key_fields: string[];
  columns: { name: string; required: boolean; description: string; example: string }[];
}

export interface Fact {
  id: string;
  kind: string;
  statement: string;
  evidence_ids: string[];
  data: Record<string, unknown>;
}

export interface EvidencePack {
  generated_at: string;
  scope: string;
  business_profile: Record<string, string>;
  facts: Fact[];
  documents: ({ evidence_id: string; type: string } & Record<string, unknown>)[];
  data_gaps: string[];
  size: { chars: number; documents_dropped: number; limit_chars: number };
}

export interface Insight {
  finding: string;
  evidence_ids: string[];
  interpretation: string;
  customer_segment: string | null;
  segment_support: string | null;
  proposed_experiment: string;
  success_measure: string;
  limitations: string[];
  alternative_explanations: string[];
  confidence: "low" | "medium" | "high";
}

export interface ReportResult {
  summary: string;
  data_sufficiency: "sufficient" | "limited" | "insufficient";
  sufficiency_notes: string[];
  insights: Insight[];
  customer_needs_to_investigate: string[];
}

export interface Report {
  id: number;
  created_at: string;
  provider: string;
  model: string | null;
  is_example: boolean;
  status: "success" | "partial" | "failed";
  evidence: EvidencePack;
  result: ReportResult | null;
  validation: {
    schema_valid?: boolean;
    schema_errors?: { location: string; message: string }[];
    removed_insights?: { index: number; finding: string; invalid_ids: { id: string; reason: string }[] }[];
    checked_ids?: number;
    provider_error?: string;
  };
  error: string | null;
}

export interface ReportListItem {
  id: number;
  created_at: string;
  provider: string;
  model: string | null;
  is_example: number;
  status: string;
  error: string | null;
}

export interface BusinessProfile {
  business_name: string;
  offerings: string;
  operating_area: string;
  capacity: string;
  price_range: string;
  monthly_budget: string;
  goals: string;
  notes: string;
}

export interface EvidenceDetail {
  evidence_id: string;
  type: string;
  record: Record<string, unknown>;
  import_batch: { id: number; importer: string; original_filename: string; file_sha256: string; raw_path: string; completed_at: string } | null;
  source: { name: string; publisher: string; url: string; attribution: string; license_note: string } | null;
  revisions: { field: string; old_value: string; new_value: string; changed_at: string; batch_id: number }[];
  themes?: { theme: string; method: string; model: string | null; sentiment: string | null }[];
}
