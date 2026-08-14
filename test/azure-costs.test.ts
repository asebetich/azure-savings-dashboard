import { describe, expect, it } from "vitest";
import { blobLinks, isVmSavingsRecord, monthlyDateRanges, parseCostCsv } from "../src/azure-costs.js";

describe("Azure cost CSV ingestion", () => {
  it("splits longer periods into calendar-month requests", () => {
    expect(monthlyDateRanges("2026-05-15", "2026-08-14")).toEqual([
      { start: "2026-05-15", end: "2026-05-31" },
      { start: "2026-06-01", end: "2026-06-30" },
      { start: "2026-07-01", end: "2026-07-31" },
      { start: "2026-08-01", end: "2026-08-14" },
    ]);
  });

  it("reads CSV links from an asynchronous operation result", () => {
    expect(blobLinks({ properties: { manifest: { blobs: [{ blobLink: "https://example.test/cost.csv" }] } } })).toEqual([
      "https://example.test/cost.csv",
    ]);
  });

  it("maps current amortized cost columns and recognizes VM and unused records", () => {
    const csv = [
      "Date,ResourceId,ResourceType,ServiceName,PricingModel,ChargeType,Quantity,UnitPrice,CostInBillingCurrency,BillingCurrencyCode",
      "07/01/2026,/subscriptions/1/providers/Microsoft.Compute/virtualMachines/vm1,Microsoft.Compute/virtualMachines,Virtual Machines,SavingsPlan,Usage,10,4,28,USD",
      "2026-07-01,,,,SavingsPlan,UnusedSavingsPlan,2,1,2,USD",
    ].join("\n");

    const records = parseCostCsv(csv);
    expect(records).toHaveLength(2);
    expect(records[0]).toMatchObject({ date: "2026-07-01", quantity: 10, unitPrice: 4, cost: 28 });
    expect(records.every(isVmSavingsRecord)).toBe(true);
  });
});