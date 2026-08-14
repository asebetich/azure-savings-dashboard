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

async function azureRequest(url: string, token: string, init?: RequestInit): Promise<Response> {
  const response = await fetch(url, {
    ...init,
    signal: AbortSignal.timeout(30_000),
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      ...init?.headers,
    },
  });

  if (response.ok || response.status === 202) {
    return response;
  }

  const detail = (await response.text()).slice(0, 1_000);
  throw new Error(`Azure Cost Management returned ${response.status}: ${detail || response.statusText}`);
}

function blobLinks(report: ReportResponse): string[] {
  const manifest = report.manifest ?? report;
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

export async function downloadAmortizedCostRecords(
  scope: string,
  start: string,
  end: string,
): Promise<CostRecord[]> {
  const token = await accessToken();
  const createUrl = `${managementEndpoint}${scope}/providers/Microsoft.CostManagement/generateCostDetailsReport?api-version=${apiVersion}`;
  const createResponse = await azureRequest(createUrl, token, {
    method: "POST",
    body: JSON.stringify({ metric: "AmortizedCost", timePeriod: { start, end } }),
  });

  let report: ReportResponse;
  if (createResponse.status === 200) {
    report = (await createResponse.json()) as ReportResponse;
  } else {
    const location = createResponse.headers.get("location");
    if (!location) throw new Error("Azure accepted the report request but returned no polling location.");

    const deadline = Date.now() + 5 * 60_000;
    let pollUrl = new URL(location, managementEndpoint).toString();
    while (true) {
      if (Date.now() >= deadline) throw new Error("The Azure cost report did not finish within five minutes.");
      const retryAfter = Number(createResponse.headers.get("retry-after") ?? 3);
      await wait(Math.min(Math.max(retryAfter, 1), 15) * 1_000);
      const pollResponse = await azureRequest(pollUrl, token);
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
      const response = await fetch(link, { signal: AbortSignal.timeout(60_000) });
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

export function parseCostCsv(csv: string): CostRecord[] {
  const rows = parse(csv, { bom: true, columns: true, skip_empty_lines: true, relax_column_count: true }) as CsvRow[];
  return rows.map((row) => ({
    date: field(row, "Date", "UsageDate", "date"),
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