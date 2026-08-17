import express from "express";
import { z } from "zod";
import { calculateSavings, type CostRecord } from "./calculation.js";
import { downloadAmortizedCostRecords, hasAzureSession, isVmSavingsRecord, type CostReport } from "./azure-costs.js";

const app = express();
const port = Number(process.env.PORT ?? 4173);
const activeAnalyses = new Map<string, Promise<CostReport>>();

function localDate(date = new Date()): string {
  return [
    date.getFullYear(),
    String(date.getMonth() + 1).padStart(2, "0"),
    String(date.getDate()).padStart(2, "0"),
  ].join("-");
}

app.disable("x-powered-by");
app.use((_request, response, next) => {
  response.setHeader("Content-Security-Policy", "default-src 'self'; style-src 'self' 'unsafe-inline'; script-src 'self' 'unsafe-inline'; connect-src 'self'");
  response.setHeader("Referrer-Policy", "no-referrer");
  response.setHeader("X-Content-Type-Options", "nosniff");
  response.setHeader("X-Frame-Options", "DENY");
  next();
});
app.use(express.json({ limit: "16kb" }));
app.use(express.static("public"));

const analysisRequest = z
  .object({
    scope: z
      .string()
      .trim()
      .regex(/^\/(subscriptions|providers\/Microsoft\.Billing)\/[A-Za-z0-9._()/:-]+$/i, "Enter a subscription or Microsoft Billing scope."),
    start: z.iso.date(),
    end: z.iso.date(),
  })
  .refine(({ start, end }) => start <= end, { message: "Start date must be on or before end date." })
  .refine(({ end }) => end <= localDate(), { message: "End date cannot be after today." })
  .refine(({ start, end }) => {
    const maximumEnd = new Date(`${start}T00:00:00Z`);
    maximumEnd.setUTCMonth(maximumEnd.getUTCMonth() + 13);
    return Date.parse(end) <= maximumEnd.getTime();
  }, {
    message: "Choose a range of 13 months or less.",
  });

function vmCount(records: CostRecord[]): number {
  return new Set(
    records
      .filter((record) => record.chargeType.toLowerCase() === "usage" && record.resourceId)
      .map((record) => record.resourceId.toLowerCase()),
  ).size;
}

function result(records: CostRecord[], scope: string, sourceRecordCount = records.length) {
  const vmRecords = records.filter(isVmSavingsRecord);
  const summary = calculateSavings(vmRecords);
  const daily = [...new Set(vmRecords.map((record) => record.date).filter(Boolean))]
    .sort()
    .map((date) => ({ date, ...calculateSavings(vmRecords.filter((record) => record.date === date)) }));
  const warnings: string[] = [];

  if (!summary.hasSavingsPlan) warnings.push("No Savings Plan usage or charges were detected for these VMs in this period.");
  if (!summary.hasReservations) warnings.push("No Reserved Instance usage or charges were detected for these VMs in this period.");
  if (scope.toLowerCase().startsWith("/subscriptions/") && summary.hasSavingsPlan && summary.unusedSavingsPlanRecordCount === 0) {
    warnings.push("Subscription reports may omit unallocated Savings Plan waste. Use the EA/MCA billing scope to prove it is zero.");
  }
  if (scope.toLowerCase().startsWith("/subscriptions/") && summary.hasReservations && summary.unusedReservationRecordCount === 0) {
    warnings.push("Subscription reports may omit unallocated reservation waste. Use the EA/MCA billing scope to prove it is zero.");
  }
  if (summary.totalUnusedCommitment > 0) {
    warnings.push("Unused benefit charges are scope-level waste; Azure does not attribute them to an individual VM.");
  }

  return { summary, daily, vmCount: vmCount(vmRecords), vmRecordCount: vmRecords.length, sourceRecordCount, warnings };
}

function analysisRecords(scope: string, start: string, end: string): Promise<CostReport> {
  const key = `${scope.toLowerCase()}|${start}|${end}`;
  const active = activeAnalyses.get(key);
  if (active) return active;

  const analysis = downloadAmortizedCostRecords(scope, start, end);
  activeAnalyses.set(key, analysis);
  void analysis.finally(() => {
    if (activeAnalyses.get(key) === analysis) activeAnalyses.delete(key);
  }).catch(() => undefined);
  return analysis;
}

app.get("/api/status", async (_request, response) => {
  response.json({ authenticated: await hasAzureSession(), authentication: "Azure CLI" });
});

app.get("/api/demo", (_request, response) => {
  const records: CostRecord[] = Array.from({ length: 100 }, (_, index) => ({
    date: `2026-07-${String((index % 28) + 1).padStart(2, "0")}`,
    resourceId: `/subscriptions/demo/resourceGroups/compute/providers/Microsoft.Compute/virtualMachines/vm-${index + 1}`,
    resourceType: "Microsoft.Compute/virtualMachines",
    serviceName: "Virtual Machines",
    pricingModel: index < 60 ? "SavingsPlan" : index < 90 ? "Reservation" : "OnDemand",
    chargeType: "Usage",
    quantity: 1,
    unitPrice: 500,
    cost: index < 60 ? 350 : index < 90 ? 300 : 500,
    currency: "USD",
  }));
  records.push({ ...records[0]!, resourceId: "", chargeType: "UnusedSavingsPlan", quantity: 1, unitPrice: 1_000, cost: 1_000 });
  records.push({ ...records[0]!, resourceId: "", pricingModel: "Reservation", chargeType: "UnusedReservation", quantity: 1, unitPrice: 500, cost: 500 });
  response.json(result(records, "/providers/Microsoft.Billing/billingAccounts/demo"));
});

app.post("/api/analyze", async (request, response) => {
  const parsed = analysisRequest.safeParse(request.body);
  if (!parsed.success) {
    response.status(400).json({ error: parsed.error.issues[0]?.message ?? "Invalid request." });
    return;
  }

  try {
    const report = await analysisRecords(parsed.data.scope, parsed.data.start, parsed.data.end);
    response.json(result(report.records, parsed.data.scope, report.sourceRecordCount));
  } catch (error) {
    const message = error instanceof Error ? error.message : "The Azure report failed.";
    console.error(message);
    response.status(502).json({ error: message });
  }
});

app.listen(port, "127.0.0.1", () => {
  console.log(`Azure Savings Dashboard: http://127.0.0.1:${port}`);
});