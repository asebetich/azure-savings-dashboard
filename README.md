# Azure VM Commitment Reality Check

A local, read-only dashboard that compares PAYG-equivalent usage with amortized Azure Savings Plan and Reserved Instance costs across three views: VM usage, all covered compute, and commitment overview.

## Prerequisites

- Node.js 20 or newer
- Azure CLI
- `Cost Management Reader` at the analyzed scope
- A subscription or supported EA/MCA billing scope

Enhanced resource-level Savings Plan details depend on the billing agreement. EA and MCA billing scopes provide the most complete commitment view.

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

Choose a completed date range of no more than 13 months. The application splits longer ranges into monthly Azure requests, polls until each report is ready, and downloads every CSV partition. The views separate costs that Azure can and cannot attribute:

```text
VM usage            = VM SP/RI usage + VM PAYG overflow; excludes shared waste
All covered compute = SP/RI-covered usage across services; excludes shared waste
Commitment overview = All covered usage + unused SP/RI visible at the scope
```

### Analysis views

- **VM usage** compares VM usage at PAYG-equivalent rates with VM charges after applied Savings Plan and Reserved Instance benefits. Shared unused commitment is excluded.
- **All covered compute** includes Savings Plan and reservation-covered usage across services, including covered non-VM resources. Shared unused commitment is excluded.
- **Commitment overview** combines covered usage with `UnusedSavingsPlan` and `UnusedReservation` charges visible at the selected scope.

The daily chart always shows VM usage. Azure reports unused commitment at the scope level, so the dashboard does not allocate that waste to individual VMs or days.

### Calculation model

```text
PAYG equivalent = covered quantity x contract unit price + on-demand overflow
Usage savings   = PAYG equivalent - amortized covered usage - on-demand overflow
Commitment savings = covered PAYG equivalent - covered cost - visible unused commitment
```

The server streams CSV partitions and retains only analysis-relevant rows, avoiding whole-file buffering for large billing scopes. Identical in-flight analyses are coalesced, transient Azure `429` and `503` responses are retried, and the overall operation has a five-minute deadline.

If Azure returns `NoDataFound` or HTTP 204 for a month, that month contributes zero records instead of failing the complete date range. The dashboard displays a data note when the entire selected period has no amortized cost data.

## Validate

```powershell
npm test
npm run build
```

`npm test` runs the calculation and streamed-ingestion tests. `npm run build` performs the strict TypeScript check without emitting files.

## Stop

If the server is attached to the current terminal, press `Ctrl+C`.

If the prompt has returned but the dashboard is still available, another process is serving port 4173. Stop it from PowerShell:

```powershell
$connection = Get-NetTCPConnection -LocalPort 4173 -State Listen -ErrorAction SilentlyContinue
if ($connection) { Stop-Process -Id $connection.OwningProcess }
```

This project does not define an `npm stop` script.

Use a billing scope to include unallocated `UnusedSavingsPlan` and `UnusedReservation` records. Their absence in a subscription report does not prove 100% utilization. The dashboard labels subscription commitment results as subscription-visible rather than organization-wide and reports when no Savings Plan or Reserved Instance usage is detected.

## Security

The server binds only to `127.0.0.1`. Authentication uses `AzureCliCredential`, so the browser receives neither Azure credentials nor access tokens. The application is read-only and does not save downloaded cost details.

## Data limitations

- PAYG equivalent is a counterfactual calculated from actual consumed quantity and the `UnitPrice` in your cost details, not a second invoice.
- Savings plans are hourly commitments. Azure's amortized records already reflect hourly coverage, PAYG overflow, and waste; monthly totals must not be used to reallocate commitment between hours.
- Unused Savings Plan and reservation cost is scope-level and cannot be attributed solely to an individual VM.
- Subscription reports can omit commitments purchased or shared at a broader billing scope, including unallocated waste.
- CSP customers may need partner reconciliation data because enhanced resource-level savings-plan data is primarily available for EA and MCA.

References:

- https://learn.microsoft.com/azure/cost-management-billing/manage/review-subscription-billing
- https://learn.microsoft.com/azure/cost-management-billing/savings-plan/utilization-cost-reports