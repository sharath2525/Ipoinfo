export type IpoStatus =
  | "upcoming"
  | "open"
  | "closed"
  | "listing_soon"
  | "listed";

export type IpoMarket = "Mainboard" | "SME";

export type AllotmentAvailability =
  | "available"
  | "expected_soon"
  | "pending"
  | "unavailable";

export type AllotmentStatus =
  | "allotted"
  | "not_allotted"
  | "not_applied"
  | "allotment_out"
  | "pending"
  | "captcha_required"
  | "unavailable"
  | "error";

export type Ipo = {
  id: string;
  name: string;
  symbol?: string;
  marketType?: IpoMarket;
  issuePriceMin?: number;
  issuePriceMax: number;
  lotSize: number;
  openDate: string;
  closeDate: string;
  allotmentDate: string;
  listingDate: string;
  registrar: string;
  allotmentUrl?: string;
  allotmentStatusText?: string;
  status: IpoStatus;
  allotmentAvailability: AllotmentAvailability;
  gmp?: number;
  gmpLastUpdated?: string;
  dataSource?: string;
};

export type AllotmentResult = {
  ipoId: string;
  ipoName: string;
  pan: string;
  status: AllotmentStatus;
  allottedQuantity?: number;
  appliedQuantity?: number;
  applicantName?: string;
  applicationNo?: string;
  amountAdjusted?: number;
  refundAmount?: number;
  registrar: string;
  actionUrl?: string;
  actionLabel?: string;
  liveStatus?: string;
  checkedAt: string;
  error?: string;
};

export type BatchCheckResponse = {
  results: AllotmentResult[];
  totalChecks: number;
  successfulChecks: number;
  failedChecks: number;
  unavailableChecks: number;
  checkedAt: string;
};

export type GmpRow = Ipo & {
  gmp: number;
  gmpPercent: number;
  estimatedListingPrice: number;
  estimatedListingGain: number;
  gmpLastUpdated: string;
};

export type ProviderMeta = {
  source: "multi-source" | "ipowatch" | "ipoguru" | "ipoalerts" | "mock";
  isLive: boolean;
  message: string;
  fetchedAt: string;
};
