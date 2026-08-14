import { AzureCliCredential } from "@azure/identity";
import { parse } from "csv-parse/sync";
import type { CostRecord } from "./calculation.js";

const managementEndpoint = "https://management.azure.com";
const apiVersion = "2025-03-01";
const credential = new AzureCliCredential();

interface ReportManifest {
  blobs?: Array<{ blobLink?: string }>;
  blobLink?: string;
}

interface ReportResponse {
  manifest?: ReportManifest;
  properties?: { manifest?: ReportManifest };
  blobs?: Array<{ blobLink?: string }>;
  blobLink?: string;
}

const wait = (milliseconds: number) => new Promise((resolve) => setTimeout(resolve, milliseconds));

async function accessToken(): Promise<string> {
  const token = await credential.getToken("https://management.azure.com/.default");
  if (!token) {
    throw new Error("Azure CLI did not return an Azure Resource Manager access token.");
  }
  return token.token;
}

async function azureRequest(url: string, token: string, deadline: number, init?: RequestInit): Promise<Response> {
  for (let attempt = 0; attempt < 5; attempt++) {
    const remaining = deadline - Date.now();
    if (remaining <= 0) throw new Error("The Azure cost report did not finish within five minutes.");
    const response = await fetch(url, {
      ...init,
      signal: AbortSignal.timeout(Math.min(30_000, remaining)),
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
        ...init?.headers,
      },
    });

    if (response.ok) return response;
    if ([429, 503].includes(response.status) && attempt < 4) {
      const retryAfter = Number(response.headers.get("retry-after"));
      const delaySeconds = Number.isFinite(retryAfter) ? retryAfter : Math.min(2 ** attempt, 30);
      await wait(Math.min(Math.max(delaySeconds, 1) * 1_000, Math.max(deadline - Date.now(), 0)));
      continue;
    }

    const detail = (await response.text()).slice(0, 1_000);
    throw new Error(`Azure Cost Management returned ${response.status}: ${detail || response.statusText}`);
  }

  throw new Error("Azure Cost Management did not respond after five attempts.");
}

export function blobLinks(report: ReportResponse): string[] {
  const manifest = report.properties?.manifest ?? report.manifest ?? report;
  const links = (manifest.blobs ?? []).flatMap((blob) => (blob.blobLink ? [blob.blobLink] : []));
  if (manifest.blobLink) links.push(manifest.blobLink);
  return links;
}

export async function hasAzureSession(): Promise<boolean> {
  try {
    await accessToken();
    return true;
  } catch {
    return false;
  }
}

export interface CostDateRange {
  start: string;
  end: string;
}

export function monthlyDateRanges(start: string, end: string): CostDateRange[] {
  const ranges: CostDateRange[] = [];
  const finalDate = new Date(`${end}T00:00:00Z`);
  let currentDate = new Date(`${start}T00:00:00Z`);

  while (currentDate <= finalDate) {
    const monthEnd = new Date(Date.UTC(currentDate.getUTCFullYear(), currentDate.getUTCMonth() + 1, 0));
    const rangeEnd = monthEnd < finalDate ? monthEnd : finalDate;
    ranges.push({
      start: currentDate.toISOString().slice(0, 10),
      end: rangeEnd.toISOString().slice(0, 10),
    });
    currentDate = new Date(rangeEnd);
    currentDate.setUTCDate(currentDate.getUTCDate() + 1);
  }

  return ranges;
}

export async function downloadAmortizedCostRecords(
  scope: string,
  start: string,
  end: string,
): Promise<CostRecord[]> {
  const token = await accessToken();
  const deadline = Date.now() + 5 * 60_000;
  const records: CostRecord[] = [];
  for (const range of monthlyDateRanges(start, end)) {
    records.push(...await downloadAmortizedCostRange(scope, range.start, range.end, token, deadline));
  }
  return records;
}

async function downloadAmortizedCostRange(
  scope: string,
  start: string,
  end: string,
  token: string,
  deadline: number,
): Promise<CostRecord[]> {
  const createUrl = `${managementEndpoint}${scope}/providers/Microsoft.CostManagement/generateCostDetailsReport?api-version=${apiVersion}`;
  const createResponse = await azureRequest(createUrl, token, deadline, {
    method: "POST",
    body: JSON.stringify({ metric: "AmortizedCost", timePeriod: { start, end } }),
  });

  let report: ReportResponse;
  if (createResponse.status === 200) {
    report = (await createResponse.json()) as ReportResponse;
  } else {
    const location = createResponse.headers.get("location");
    if (!location) throw new Error("Azure accepted the report request but returned no polling location.");

    let pollUrl = new URL(location, managementEndpoint).toString();
    while (true) {
      if (Date.now() >= deadline) throw new Error("The Azure cost report did not finish within five minutes.");
      const retryAfter = Number(createResponse.headers.get("retry-after") ?? 3);
      await wait(Math.min(Math.max(retryAfter, 1), 15) * 1_000);
      const pollResponse = await azureRequest(pollUrl, token, deadline);
      if (pollResponse.status === 200) {
        report = (await pollResponse.json()) as ReportResponse;
        break;
      }
      pollUrl = new URL(pollResponse.headers.get("location") ?? pollUrl, managementEndpoint).toString();
    }
  }

  const links = blobLinks(report);
  if (links.length === 0) throw new Error("Azure completed the report without any downloadable CSV partitions.");

  const partitions = await Promise.all(
    links.map(async (link) => {
      const remaining = deadline - Date.now();
      if (remaining <= 0) throw new Error("The Azure cost report did not finish within five minutes.");
      const response = await fetch(link, { signal: AbortSignal.timeout(Math.min(60_000, remaining)) });
      if (!response.ok) throw new Error(`Cost report download failed with ${response.status}.`);
      return response.text();
    }),
  );

  return partitions.flatMap(parseCostCsv);
}

type CsvRow = Record<string, string>;

function field(row: CsvRow, ...names: string[]): string {
  const normalized = new Map(
    Object.entries(row).map(([key, value]) => [key.replace(/[\s_]/g, "").toLowerCase(), value]),
  );
  for (const name of names) {
    const value = normalized.get(name.replace(/[\s_]/g, "").toLowerCase());
    if (value !== undefined) return value;
  }
  return "";
}

function numberField(row: CsvRow, ...names: string[]): number {
  const value = Number(field(row, ...names));
  return Number.isFinite(value) ? value : 0;
}

function dateField(row: CsvRow): string {
  const value = field(row, "Date", "UsageDate", "date");
  const match = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(value);
  if (!match) return value;
  return `${match[3]}-${match[1]!.padStart(2, "0")}-${match[2]!.padStart(2, "0")}`;
}

export function parseCostCsv(csv: string): CostRecord[] {
  const rows = parse(csv, { bom: true, columns: true, skip_empty_lines: true, relax_column_count: true }) as CsvRow[];
  return rows.map((row) => ({
    date: dateField(row),
    resourceId: field(row, "ResourceId", "InstanceId"),
    resourceType: field(row, "ResourceType"),
    serviceName: field(row, "ServiceName", "MeterCategory"),
    pricingModel: field(row, "PricingModel"),
    chargeType: field(row, "ChargeType"),
    quantity: numberField(row, "Quantity"),
    unitPrice: numberField(row, "UnitPrice"),
    cost: numberField(row, "CostInBillingCurrency", "Cost"),
    currency: field(row, "BillingCurrencyCode", "BillingCurrency", "Currency") || "USD",
  }));
}

export function isVmSavingsRecord(record: CostRecord): boolean {
  if (["unusedsavingsplan", "unusedsavingplan", "unusedreservation"].includes(record.chargeType.trim().toLowerCase())) {
    return true;
  }
  const resourceType = record.resourceType.trim().toLowerCase();
  const serviceName = record.serviceName.trim().toLowerCase();
  return resourceType.includes("microsoft.compute/virtualmachines") || serviceName === "virtual machines";
}