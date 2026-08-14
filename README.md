# Azure VM Commitment Reality Check

A local, read-only dashboard that compares actual VM usage at PAYG rates with amortized Azure Savings Plan and Reserved Instance costs. It includes on-demand overflow and unused commitment in net realized savings.

## Prerequisites

- Node.js 20 or newer
- Azure CLI
- An EA or MCA scope with enhanced savings-plan cost details
- `Cost Management Reader` at the analyzed scope

Authenticate without placing credentials in this application:

```powershell
az login
az account set --subscription <subscription-id>
```

## Run

```powershell
npm install
npm start
```

Open `http://127.0.0.1:4173` and enter either:

- `/subscriptions/<subscription-id>`
- An EA/MCA Microsoft Billing scope copied from Azure Cost Management

Choose a completed date range of no more than 31 days. The application requests an `AmortizedCost` report, polls until it is ready, downloads every CSV partition, and calculates:

```text
PAYG equivalent      = SP-covered PAYG + RI-covered PAYG + PAYG overflow
Actual with benefits = SP amortized cost + RI amortized cost + PAYG overflow + unused SP + unused RI
Net realized savings = PAYG equivalent - actual with benefits
```

Use a billing scope to include unallocated `UnusedSavingsPlan` and `UnusedReservation` records. Their absence in a subscription report does not prove 100% utilization. The dashboard explicitly reports when no Savings Plan or Reserved Instance usage is detected.

## Security

The server binds only to `127.0.0.1`. Authentication uses `AzureCliCredential`, so the browser receives neither Azure credentials nor access tokens. The application is read-only and does not save downloaded cost details.

## Data limitations

- PAYG equivalent is a counterfactual calculated from actual consumed quantity and the `UnitPrice` in your cost details, not a second invoice.
- Savings plans are hourly commitments. Azure's amortized records already reflect hourly coverage, PAYG overflow, and waste; monthly totals must not be used to reallocate commitment between hours.
- Unused savings-plan cost is plan/scope-level and cannot be attributed solely to an individual VM.
- CSP customers may need partner reconciliation data because enhanced resource-level savings-plan data is primarily available for EA and MCA.

References:

- https://learn.microsoft.com/azure/cost-management-billing/manage/review-subscription-billing
- https://learn.microsoft.com/azure/cost-management-billing/savings-plan/utilization-cost-reports