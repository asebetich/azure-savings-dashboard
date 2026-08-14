import { describe, expect, it } from "vitest";
import { calculateSavings, type CostRecord } from "../src/calculation.js";

const record = (values: Partial<CostRecord>): CostRecord => ({
  date: "2026-07-01",
  resourceId: "/subscriptions/example/resourceGroups/compute/providers/Microsoft.Compute/virtualMachines/vm-1",
  resourceType: "Microsoft.Compute/virtualMachines",
  serviceName: "Virtual Machines",
  pricingModel: "SavingsPlan",
  chargeType: "Usage",
  quantity: 1,
  unitPrice: 1,
  cost: 1,
  currency: "USD",
  ...values,
});

describe("calculateSavings", () => {
  it("includes PAYG overflow while reporting zero waste at full utilization", () => {
    const summary = calculateSavings([
      record({ quantity: 100, unitPrice: 4, cost: 280 }),
      record({ pricingModel: "OnDemand", quantity: 10, unitPrice: 4, cost: 40 }),
    ]);

    expect(summary.paygEquivalent).toBe(440);
    expect(summary.actualWithBenefits).toBe(320);
    expect(summary.paygOverflow).toBe(40);
    expect(summary.totalUnusedCommitment).toBe(0);
    expect(summary.netSavings).toBe(120);
  });

  it("subtracts unused commitment from realized savings", () => {
    const summary = calculateSavings([
      record({ quantity: 100, unitPrice: 4, cost: 280 }),
      record({ pricingModel: "OnDemand", quantity: 10, unitPrice: 4, cost: 40 }),
      record({ chargeType: "UnusedSavingsPlan", quantity: 20, unitPrice: 1, cost: 20 }),
    ]);

    expect(summary.actualWithBenefits).toBe(340);
    expect(summary.netSavings).toBe(100);
    expect(summary.savingsRate).toBeCloseTo(100 / 440);
  });

  it("combines reservation and savings plan benefits without double-counting PAYG overflow", () => {
    const summary = calculateSavings([
      record({ quantity: 100, unitPrice: 4, cost: 280 }),
      record({ pricingModel: "Reservation", quantity: 50, unitPrice: 4, cost: 120 }),
      record({ pricingModel: "OnDemand", quantity: 10, unitPrice: 4, cost: 40 }),
      record({ pricingModel: "Reservation", chargeType: "UnusedReservation", cost: 10 }),
    ]);

    expect(summary.paygEquivalent).toBe(640);
    expect(summary.actualWithBenefits).toBe(450);
    expect(summary.savingsPlanNetSavings).toBe(120);
    expect(summary.reservationNetSavings).toBe(70);
    expect(summary.netSavings).toBe(190);
    expect(summary.hasSavingsPlan).toBe(true);
    expect(summary.hasReservations).toBe(true);
  });

  it("reports that no savings plan or reservation exists for on-demand-only usage", () => {
    const summary = calculateSavings([
      record({ pricingModel: "OnDemand", quantity: 10, unitPrice: 4, cost: 40 }),
    ]);

    expect(summary.paygEquivalent).toBe(40);
    expect(summary.actualWithBenefits).toBe(40);
    expect(summary.netSavings).toBe(0);
    expect(summary.hasSavingsPlan).toBe(false);
    expect(summary.hasReservations).toBe(false);
  });
});