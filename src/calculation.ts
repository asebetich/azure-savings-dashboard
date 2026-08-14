export interface CostRecord {
  date: string;
  resourceId: string;
  resourceType: string;
  serviceName: string;
  pricingModel: string;
  chargeType: string;
  quantity: number;
  unitPrice: number;
  cost: number;
  currency: string;
}

export interface SavingsSummary {
  paygEquivalent: number;
  actualWithBenefits: number;
  savingsPlanCost: number;
  reservationCost: number;
  paygOverflow: number;
  unusedSavingsPlan: number;
  unusedReservation: number;
  totalUnusedCommitment: number;
  netSavings: number;
  savingsRate: number;
  savingsPlanPaygEquivalent: number;
  reservationPaygEquivalent: number;
  savingsPlanNetSavings: number;
  reservationNetSavings: number;
  savingsPlanRecordCount: number;
  reservationRecordCount: number;
  overflowRecordCount: number;
  unusedSavingsPlanRecordCount: number;
  unusedReservationRecordCount: number;
  hasSavingsPlan: boolean;
  hasReservations: boolean;
  currency: string;
}

const normalized = (value: string) => value.trim().toLowerCase();

export function calculateSavings(records: CostRecord[]): SavingsSummary {
  const savingsPlanUsage = records.filter(
    (record) => normalized(record.chargeType) === "usage" && normalized(record.pricingModel) === "savingsplan",
  );
  const reservationUsage = records.filter(
    (record) => normalized(record.chargeType) === "usage" && normalized(record.pricingModel) === "reservation",
  );
  const overflow = records.filter(
    (record) => normalized(record.chargeType) === "usage" && normalized(record.pricingModel) === "ondemand",
  );
  const unusedSavingsPlanRecords = records.filter(
    (record) => ["unusedsavingsplan", "unusedsavingplan"].includes(normalized(record.chargeType))
      && normalized(record.pricingModel) === "savingsplan",
  );
  const unusedReservationRecords = records.filter(
    (record) => normalized(record.chargeType) === "unusedreservation"
      && normalized(record.pricingModel) === "reservation",
  );

  const savingsPlanPaygEquivalent = savingsPlanUsage.reduce(
    (total, record) => total + record.unitPrice * record.quantity,
    0,
  );
  const reservationPaygEquivalent = reservationUsage.reduce(
    (total, record) => total + record.unitPrice * record.quantity,
    0,
  );
  const savingsPlanCost = savingsPlanUsage.reduce((total, record) => total + record.cost, 0);
  const reservationCost = reservationUsage.reduce((total, record) => total + record.cost, 0);
  const paygOverflow = overflow.reduce((total, record) => total + record.cost, 0);
  const unusedSavingsPlan = unusedSavingsPlanRecords.reduce((total, record) => total + record.cost, 0);
  const unusedReservation = unusedReservationRecords.reduce((total, record) => total + record.cost, 0);
  const totalUnusedCommitment = unusedSavingsPlan + unusedReservation;
  const paygEquivalent = savingsPlanPaygEquivalent + reservationPaygEquivalent + paygOverflow;
  const actualWithBenefits = savingsPlanCost + reservationCost + paygOverflow + totalUnusedCommitment;
  const netSavings = paygEquivalent - actualWithBenefits;

  return {
    paygEquivalent,
    actualWithBenefits,
    savingsPlanCost,
    reservationCost,
    paygOverflow,
    unusedSavingsPlan,
    unusedReservation,
    totalUnusedCommitment,
    netSavings,
    savingsRate: paygEquivalent === 0 ? 0 : netSavings / paygEquivalent,
    savingsPlanPaygEquivalent,
    reservationPaygEquivalent,
    savingsPlanNetSavings: savingsPlanPaygEquivalent - savingsPlanCost - unusedSavingsPlan,
    reservationNetSavings: reservationPaygEquivalent - reservationCost - unusedReservation,
    savingsPlanRecordCount: savingsPlanUsage.length,
    reservationRecordCount: reservationUsage.length,
    overflowRecordCount: overflow.length,
    unusedSavingsPlanRecordCount: unusedSavingsPlanRecords.length,
    unusedReservationRecordCount: unusedReservationRecords.length,
    hasSavingsPlan: savingsPlanUsage.length > 0 || unusedSavingsPlanRecords.length > 0,
    hasReservations: reservationUsage.length > 0 || unusedReservationRecords.length > 0,
    currency: records.find((record) => record.currency)?.currency ?? "USD",
  };
}