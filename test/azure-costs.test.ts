import { describe, expect, it } from "vitest";
import { isVmSavingsRecord, parseCostCsv } from "../src/azure-costs.js";

describe("Azure cost CSV ingestion", () => {
  it("maps current amortized cost columns and recognizes VM and unused records", () => {
    const csv = [
      "Date,ResourceId,ResourceType,ServiceName,PricingModel,ChargeType,Quantity,UnitPrice,CostInBillingCurrency,BillingCurrencyCode",
      "2026-07-01,/subscriptions/1/providers/Microsoft.Compute/virtualMachines/vm1,Microsoft.Compute/virtualMachines,Virtual Machines,SavingsPlan,Usage,10,4,28,USD",
      "2026-07-01,,,,SavingsPlan,UnusedSavingsPlan,2,1,2,USD",
    ].join("\n");

    const records = parseCostCsv(csv);
    expect(records).toHaveLength(2);
    expect(records[0]).toMatchObject({ quantity: 10, unitPrice: 4, cost: 28 });
    expect(records.every(isVmSavingsRecord)).toBe(true);
  });
});