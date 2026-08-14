const elements = Object.fromEntries([...document.querySelectorAll("[id]")].map((element) => [element.id, element]));

const end = new Date();
end.setDate(0);
const start = new Date(end.getFullYear(), end.getMonth(), 1);
const localDate = (date) => [
  date.getFullYear(),
  String(date.getMonth() + 1).padStart(2, "0"),
  String(date.getDate()).padStart(2, "0"),
].join("-");
const today = localDate(new Date());
elements.start.max = today;
elements.end.max = today;
elements.start.value = localDate(start);
elements.end.value = localDate(end);

const money = (value, currency = "USD") => new Intl.NumberFormat(undefined, {
  style: "currency",
  currency,
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
}).format(value);

const elapsedTime = (seconds) => {
  if (seconds < 60) return `${seconds}s`;
  return `${Math.floor(seconds / 60)}m ${seconds % 60}s`;
};

async function requestJson(url, options) {
  const response = await fetch(url, options);
  const body = await response.json();
  if (!response.ok) throw new Error(body.error || `Request failed with ${response.status}.`);
  return body;
}

function render(data) {
  const { summary } = data;
  const currency = summary.currency || "USD";
  const maximum = Math.max(summary.paygEquivalent, summary.actualWithBenefits, 1);

  elements.vmCount.textContent = data.vmCount.toLocaleString();
  elements.paygEquivalent.textContent = money(summary.paygEquivalent, currency);
  elements.actualWithBenefits.textContent = money(summary.actualWithBenefits, currency);
  elements.netSavings.textContent = money(summary.netSavings, currency);
  elements.savingsRate.textContent = `${(summary.savingsRate * 100).toFixed(1)}% savings rate`;
  elements.deltaLabel.textContent = `${money(summary.netSavings, currency)} saved`;
  elements.paygBarValue.textContent = money(summary.paygEquivalent, currency);
  elements.benefitsBarValue.textContent = money(summary.actualWithBenefits, currency);
  elements.paygBar.style.width = `${summary.paygEquivalent / maximum * 100}%`;
  elements.benefitsBar.style.width = `${summary.actualWithBenefits / maximum * 100}%`;
  elements.savingsPlanCost.textContent = money(summary.savingsPlanCost, currency);
  elements.reservationCost.textContent = money(summary.reservationCost, currency);
  elements.overflowCost.textContent = money(summary.paygOverflow, currency);
  elements.unusedSavingsPlan.textContent = money(summary.unusedSavingsPlan, currency);
  elements.unusedReservation.textContent = money(summary.unusedReservation, currency);
  elements.savingsPlanStatus.textContent = summary.hasSavingsPlan ? "Detected" : "None detected";
  elements.savingsPlanStatus.classList.toggle("detected", summary.hasSavingsPlan);
  elements.savingsPlanSavings.textContent = summary.hasSavingsPlan ? `${money(summary.savingsPlanNetSavings, currency)} saved` : "No Savings Plan";
  elements.savingsPlanDetail.textContent = summary.hasSavingsPlan
    ? `${money(summary.savingsPlanCost, currency)} used · ${money(summary.unusedSavingsPlan, currency)} unused`
    : "No Savings Plan usage or charges in this period";
  elements.reservationStatus.textContent = summary.hasReservations ? "Detected" : "None detected";
  elements.reservationStatus.classList.toggle("detected", summary.hasReservations);
  elements.reservationSavings.textContent = summary.hasReservations ? `${money(summary.reservationNetSavings, currency)} saved` : "No Reserved Instances";
  elements.reservationDetail.textContent = summary.hasReservations
    ? `${money(summary.reservationCost, currency)} used · ${money(summary.unusedReservation, currency)} unused`
    : "No Reserved Instance usage or charges in this period";
  elements.recordCount.textContent = `${data.vmRecordCount.toLocaleString()} VM records from ${data.sourceRecordCount.toLocaleString()} source records`;

  const dailyMaximum = Math.max(...data.daily.flatMap((day) => [day.paygEquivalent, day.actualWithBenefits]), 1);
  elements.trend.replaceChildren(...data.daily.map((day) => {
    const column = document.createElement("div");
    column.className = "day";
    column.title = `${day.date}: ${money(day.paygEquivalent, currency)} PAYG / ${money(day.actualWithBenefits, currency)} actual`;
    const bars = document.createElement("div");
    bars.className = "day-bars";
    for (const [kind, value] of [["payg", day.paygEquivalent], ["actual", day.actualWithBenefits]]) {
      const bar = document.createElement("span");
      bar.className = `day-bar ${kind}`;
      bar.style.height = `${value / dailyMaximum * 100}%`;
      bars.append(bar);
    }
    const label = document.createElement("span");
    label.className = "day-label";
    label.textContent = new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric", timeZone: "UTC" })
      .format(new Date(`${day.date}T00:00:00Z`));
    column.append(bars, label);
    return column;
  }));

  elements.warningList.replaceChildren(...data.warnings.map((warning) => {
    const item = document.createElement("li");
    item.textContent = warning;
    return item;
  }));
  elements.warnings.hidden = data.warnings.length === 0;
  elements.dashboard.hidden = false;
}

async function loadStatus() {
  try {
    const status = await requestJson("/api/status");
    elements.authStatus.classList.toggle("connected", status.authenticated);
    elements.authStatus.lastChild.textContent = status.authenticated ? "Azure CLI connected" : "Run az login to connect";
  } catch {
    elements.authStatus.lastChild.textContent = "Azure status unavailable";
  }
}

elements.analysisForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  elements.runButton.disabled = true;
  elements.runButton.textContent = "Generating report...";
  elements.message.classList.add("loading");
  const startedAt = Date.now();
  const updateProgress = () => {
    const elapsedSeconds = Math.floor((Date.now() - startedAt) / 1_000);
    elements.message.textContent = `Azure is preparing the amortized cost report (${elapsedTime(elapsedSeconds)} elapsed, 5 minute limit).`;
  };
  updateProgress();
  const progressTimer = setInterval(updateProgress, 1_000);
  try {
    const data = await requestJson("/api/analyze", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ scope: elements.scope.value, start: elements.start.value, end: elements.end.value }),
    });
    render(data);
    elements.message.textContent = "";
  } catch (error) {
    elements.message.textContent = error.message;
  } finally {
    clearInterval(progressTimer);
    elements.message.classList.remove("loading");
    elements.runButton.disabled = false;
    elements.runButton.textContent = "Run analysis";
  }
});

elements.demoButton.addEventListener("click", async () => {
  elements.message.textContent = "";
  render(await requestJson("/api/demo"));
});

loadStatus();