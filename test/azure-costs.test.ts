import { describe, expect, it } from "vitest";
import { blobLinks, isNoDataReport, isVmSavingsRecord, monthlyDateRanges, parseCostCsv, parseCostCsvStream } from "../src/azure-costs.js";

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

  it("recognizes Azure's successful no-data operation result", () => {
    expect(isNoDataReport({ status: "NoDataFound" })).toBe(true);
    expect(isNoDataReport({ status: "Completed" })).toBe(false);
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

  it("streams rows while retaining only VM-related records", async () => {
    const lines = [
      "Date,ResourceId,ResourceType,ServiceName,PricingModel,ChargeType,Quantity,UnitPrice,CostInBillingCurrency,BillingCurrencyCode\n",
      "07/01/2026,/subscriptions/1/providers/Microsoft.Compute/virtualMachines/vm1,Microsoft.Compute/virtualMachines,Virtual Machines,OnDemand,Usage,1,4,4,USD\n",
      "07/01/2026,/subscriptions/1/providers/Microsoft.Storage/storageAccounts/store1,Microsoft.Storage/storageAccounts,Storage,OnDemand,Usage,1,2,2,USD\n",
      "07/01/2026,/subscriptions/1/providers/Microsoft.Sql/servers/sql1,Microsoft.Sql/servers,SQL Database,Reservation,Usage,1,8,5,USD\n",
      "07/01/2026,,,,SavingsPlan,UnusedSavingsPlan,1,3,3,USD\n",
    ];
    const encoder = new TextEncoder();
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        for (const line of lines) controller.enqueue(encoder.encode(line));
        controller.close();
      },
    });

    const report = await parseCostCsvStream(body);
    expect(report.sourceRecordCount).toBe(4);
    expect(report.records).toHaveLength(3);
    expect(report.records.map((record) => record.pricingModel)).toEqual(["OnDemand", "Reservation", "SavingsPlan"]);
  });
});