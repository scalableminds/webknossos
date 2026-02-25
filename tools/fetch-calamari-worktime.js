const EMPLOYEE_EMAILS = [
  "robert.oleynik@scalableminds.com",
  "hannes.spitz@scalableminds.com",
  "charlie.meister@scalableminds.com",
  "matthis.clausen@scalableminds.com",
  "georg.auge@scalableminds.com",
  "aleyna.elmasli@scalableminds.com",
];

const DEFAULT_API_BASE_URL = "https://scm.calamari.io";
const APPROVED_ABSENCE_STATUSES = ["ACCEPTED", "APPROVED"];
const SECONDS_PER_HOUR = 3600;
const MINUTES_PER_HOUR = 60;
const MS_PER_SECOND = 1000;
const MS_PER_DAY = 24 * 60 * 60 * 1000;
const DAY_NAME_BY_INDEX = [
  "SUNDAY",
  "MONDAY",
  "TUESDAY",
  "WEDNESDAY",
  "THURSDAY",
  "FRIDAY",
  "SATURDAY",
];

function getPreviousMonthRange() {
  const now = new Date();
  const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1));
  const end = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 0));
  return {
    from: toIsoDate(start),
    to: toIsoDate(end),
  };
}

function toIsoDate(date) {
  return date.toISOString().slice(0, 10);
}

function isIsoDate(value) {
  return typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value);
}

function asNumber(value) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : 0;
}

function toRoundedHours(valueInHours) {
  return Math.round(valueInHours * 100) / 100;
}

function secondsToHours(seconds) {
  return toRoundedHours(asNumber(seconds) / SECONDS_PER_HOUR);
}

function isIsoDateTime(value) {
  return typeof value === "string" && !Number.isNaN(Date.parse(value));
}

function getDateStartMs(dateStr) {
  if (!isIsoDate(dateStr)) {
    return NaN;
  }
  const [year, month, day] = dateStr.split("-").map((part) => Number(part));
  return Date.UTC(year, month - 1, day, 0, 0, 0, 0);
}

function getDateEndExclusiveMs(dateStr) {
  const startMs = getDateStartMs(dateStr);
  return Number.isFinite(startMs) ? startMs + MS_PER_DAY : NaN;
}

function overlapSeconds(startA, endA, startB, endB) {
  const overlapStart = Math.max(startA, startB);
  const overlapEnd = Math.min(endA, endB);
  return overlapEnd > overlapStart ? (overlapEnd - overlapStart) / MS_PER_SECOND : 0;
}

function nextIsoDate(dateStr) {
  const startMs = getDateStartMs(dateStr);
  return toIsoDate(new Date(startMs + MS_PER_DAY));
}

function getDateOverlap(fromA, toA, fromB, toB) {
  const from = fromA > fromB ? fromA : fromB;
  const to = toA < toB ? toA : toB;
  if (from > to) {
    return null;
  }
  return { from, to };
}

function getDayNameForIsoDate(dateStr) {
  const startMs = getDateStartMs(dateStr);
  if (!Number.isFinite(startMs)) {
    return null;
  }
  return DAY_NAME_BY_INDEX[new Date(startMs).getUTCDay()] || null;
}

function getWorkingHoursForDate(workingSchedule, dateStr) {
  const dayName = getDayNameForIsoDate(dateStr);
  if (!dayName) {
    return 0;
  }

  const workingHoursSeconds = asNumber(workingSchedule[dayName]);
  return secondsToHours(workingHoursSeconds);
}

function getDatesInRange(from, to) {
  const dates = [];
  let current = from;
  while (current <= to) {
    dates.push(current);
    current = nextIsoDate(current);
  }
  return dates;
}

async function fetchWorkingSchedules() {
  const response = await fetchCalamari("/api/working-week/v1/all");
  return Object.fromEntries(response.map((item) => [item.id, item.workingDays]));
}

async function fetchEmployeeDetails() {
  const response = await fetchCalamari("/api/people/v2", { archived: false }, "GET");

  const workScheduleIdsByEmail = Object.fromEntries(
    response.data.map((item) => [item.email, item.workSchedule.id]),
  );

  return workScheduleIdsByEmail;
}

function getProjectName(project) {
  if (project && project.project && project.project.name) {
    return project.project.name;
  }
  return (project && project.name) || "Unassigned";
}

function getRangeStart(value) {
  if (isIsoDateTime(value && value.from)) {
    return Date.parse(value.from);
  }
  if (isIsoDateTime(value && value.started)) {
    return Date.parse(value.started);
  }
  return NaN;
}

function getRangeEnd(value) {
  if (isIsoDateTime(value && value.to)) {
    return Date.parse(value.to);
  }
  if (isIsoDateTime(value && value.finished)) {
    return Date.parse(value.finished);
  }
  return NaN;
}

function getMonthName(fromDate) {
  const parsed = new Date(`${fromDate}T00:00:00.000Z`);
  return parsed.toLocaleString("en-US", {
    month: "long",
    timeZone: "UTC",
  });
}

function resolveDateRange(from, to) {
  const fallback = getPreviousMonthRange();
  const resolvedFrom = from || fallback.from;
  const resolvedTo = to || fallback.to;

  if (!isIsoDate(resolvedFrom) || !isIsoDate(resolvedTo)) {
    throw new Error("from/to must use YYYY-MM-DD format");
  }
  if (resolvedFrom > resolvedTo) {
    throw new Error("from must be <= to");
  }

  return { from: resolvedFrom, to: resolvedTo };
}

async function fetchCalamari(path, payload, method = "POST") {
  const apiToken =
    "YW2zKs7SWGcKpHv4Q27ycJpIxKAuSFLwkQFGyQPVVWu6Hhp/VgfHwhvf+IgGEQfJ2QcjpJMluJ2OtGOMktZVdg==" ||
    process.env.CALAMARI_API_TOKEN;

  if (!apiToken) {
    throw new Error("Missing API token. Sset CALAMARI_API_TOKEN.");
  }

  const apiBaseUrl = (process.env.CALAMARI_API_BASE_URL || DEFAULT_API_BASE_URL).replace(/\/$/, "");
  const headers = {
    Authorization: `Basic ${Buffer.from(`calamari:${apiToken}`).toString("base64")}`,
    "Content-Type": "application/json",
  };

  const fetchOptions = { headers };
  if (method === "POST") {
    fetchOptions.method = "POST";
    fetchOptions.body = JSON.stringify(payload);
  } else if (method === "GET") {
    fetchOptions.method = "GET";
    path += `?${new URLSearchParams(payload)}`;
  } else {
    throw new Error(`Unsupported method: ${method}`);
  }
  const response = await fetch(`${apiBaseUrl}${path}`, fetchOptions);

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`Calamari ${path} failed (${response.status}): ${body}`);
  }

  return response.json();
}

function getEntryNetSecondsInRange(entry, rangeStartMs, rangeEndExclusiveMs) {
  const entryStartMs = getRangeStart(entry);
  const entryEndMs = getRangeEnd(entry);
  let grossSeconds = 0;

  if (Number.isFinite(entryStartMs) && Number.isFinite(entryEndMs)) {
    grossSeconds = overlapSeconds(entryStartMs, entryEndMs, rangeStartMs, rangeEndExclusiveMs);
  } else {
    grossSeconds = asNumber(entry.duration);
  }

  if (grossSeconds <= 0) {
    return 0;
  }

  const breaks = Array.isArray(entry.breaks) ? entry.breaks : [];
  let breakSeconds = 0;
  for (const breakEntry of breaks) {
    const breakStartMs = getRangeStart(breakEntry);
    const breakEndMs = getRangeEnd(breakEntry);
    if (Number.isFinite(breakStartMs) && Number.isFinite(breakEndMs)) {
      breakSeconds += overlapSeconds(breakStartMs, breakEndMs, rangeStartMs, rangeEndExclusiveMs);
    } else {
      breakSeconds += asNumber(breakEntry.duration);
    }
  }

  return Math.max(0, grossSeconds - breakSeconds);
}

function aggregateTimesheet(entries, from, to) {
  const projectTotalsSeconds = {};
  let totalWorkingSeconds = 0;
  const rangeStartMs = getDateStartMs(from);
  const rangeEndExclusiveMs = getDateEndExclusiveMs(to);

  for (const entry of entries || []) {
    const netEntrySeconds = getEntryNetSecondsInRange(entry, rangeStartMs, rangeEndExclusiveMs);
    if (netEntrySeconds <= 0) {
      continue;
    }
    totalWorkingSeconds += netEntrySeconds;

    const projects = Array.isArray(entry.projects) ? entry.projects : [];
    let totalProjectSeconds = 0;
    const projectSecondsList = [];

    for (const project of projects) {
      const projectStartMs = getRangeStart(project);
      const projectEndMs = getRangeEnd(project);
      let projectSeconds = 0;
      if (Number.isFinite(projectStartMs) && Number.isFinite(projectEndMs)) {
        projectSeconds = overlapSeconds(
          projectStartMs,
          projectEndMs,
          rangeStartMs,
          rangeEndExclusiveMs,
        );
      } else {
        projectSeconds = asNumber(project.duration);
      }
      projectSecondsList.push(projectSeconds);
      totalProjectSeconds += projectSeconds;
    }

    if (projects.length === 0 || totalProjectSeconds <= 0) {
      const fallbackProjectName = "Unassigned";
      projectTotalsSeconds[fallbackProjectName] =
        (projectTotalsSeconds[fallbackProjectName] || 0) + netEntrySeconds;
      continue;
    }

    const scale = netEntrySeconds / totalProjectSeconds;
    for (let index = 0; index < projects.length; index += 1) {
      const project = projects[index];
      const projectName = getProjectName(project);
      const adjustedSeconds = Math.max(0, projectSecondsList[index] * scale);
      projectTotalsSeconds[projectName] =
        (projectTotalsSeconds[projectName] || 0) + adjustedSeconds;
    }
  }

  const projectTotalsHours = {};
  for (const [projectName, seconds] of Object.entries(projectTotalsSeconds)) {
    projectTotalsHours[projectName] = secondsToHours(seconds);
  }

  return {
    totalWorkingHours: secondsToHours(totalWorkingSeconds),
    projectTotalsHours,
  };
}

function absenceAmountToHours(amount, unit) {
  const normalizedUnit = String(unit || "HOURS").toUpperCase();
  if (normalizedUnit === "HOURS") {
    return asNumber(amount);
  }
  if (normalizedUnit === "DAYS") {
    return asNumber(amount) * hoursPerDay;
  }
  if (normalizedUnit === "MINUTES") {
    return asNumber(amount) / MINUTES_PER_HOUR;
  }
  return asNumber(amount);
}

function getAbsenceDateFrom(absence) {
  return absence.from || absence.startDate || absence.dateFrom;
}

function getAbsenceDateTo(absence) {
  return absence.to || absence.endDate || absence.dateTo;
}

function getAbsenceHoursInRange(absence, from, to, workingSchedule, holidays) {
  const absenceFrom = getAbsenceDateFrom(absence);
  const absenceTo = getAbsenceDateTo(absence);
  if (!isIsoDate(absenceFrom) || !isIsoDate(absenceTo)) {
    return absenceAmountToHours(absence.entitlementAmount, absence.entitlementAmountUnit);
  }

  const overlap = getDateOverlap(absenceFrom, absenceTo, from, to);
  if (!overlap) {
    return 0;
  }

  let totalHours = 0;
  for (const date of getDatesInRange(overlap.from, overlap.to)) {
    if (holidays.some((holiday) => holiday.start === date)) {
      continue;
    }

    const dailyWorkingHours = getWorkingHoursForDate(workingSchedule, date);
    totalHours += dailyWorkingHours;
  }

  return totalHours;
}

function aggregateAbsence(absenceRequests, from, to, workingSchedule, holidays) {
  const absenceTypeTotals = {};

  for (const absence of absenceRequests || []) {
    const typeName = absence.absenceTypeName || absence.absencePolicyName || "Unknown absence type";
    const amountInHours = getAbsenceHoursInRange(absence, from, to, workingSchedule, holidays);
    absenceTypeTotals[typeName] = toRoundedHours(
      (absenceTypeTotals[typeName] || 0) + amountInHours,
    );
  }

  return absenceTypeTotals;
}

async function fetchEmployeeData(employeeEmail, from, to, workingSchedule, holidays) {
  const timesheetEntries = await fetchCalamari("/api/clockin/timesheetentries/v1/find", {
    from,
    to,
    employees: [employeeEmail],
  });

  const absenceRequests = await fetchCalamari("/api/leave/request/v1/find-advanced", {
    from,
    to,
    employees: [employeeEmail],
    absenceStatuses: APPROVED_ABSENCE_STATUSES,
  });

  const timesheet = aggregateTimesheet(timesheetEntries, from, to);

  const absence = aggregateAbsence(absenceRequests, from, to, workingSchedule, holidays);
  const totalAbsenceHours = Object.values(absence).reduce((acc, hours) => acc + hours, 0);

  const totalHolidayHours = holidays.reduce(
    (acc, holiday) => acc + getWorkingHoursForDate(workingSchedule, holiday.start),
    0,
  );

  return {
    totalWorkingHours: timesheet.totalWorkingHours + totalHolidayHours + totalAbsenceHours,
    details: {
      byProjectHours: timesheet.projectTotalsHours,
      byAbsenceTypeHours: absence,
      byHolidayHours: totalHolidayHours,
    },
  };
}

async function fetchHolidays(employeeEmail, from, to) {
  const holidays = await fetchCalamari("/api/holiday/v1/find", {
    from,
    to,
    employee: employeeEmail,
  });
  return holidays;
}

async function fetchCalamariWorkTimeSummary(options) {
  const config = options || {};
  const { from, to } = resolveDateRange(config.from, config.to);
  const employeeTotalWorkingTime = {};
  const employeeDetails = {};

  const holidays = await fetchHolidays(EMPLOYEE_EMAILS[0], from, to);
  const workingSchedulesById = await fetchWorkingSchedules();
  const workingScheduleIdsByEmail = await fetchEmployeeDetails();

  for (const employeeEmail of EMPLOYEE_EMAILS) {
    const workingScheduleId = workingScheduleIdsByEmail[employeeEmail];
    const workingSchedule = Object.fromEntries(
      workingSchedulesById[workingScheduleId].map((item) => [item.dayName, item.duration || 0]),
    );

    const employeeData = await fetchEmployeeData(
      employeeEmail,
      from,
      to,
      workingSchedule,
      holidays,
    );

    employeeTotalWorkingTime[employeeEmail] = employeeData.totalWorkingHours;
    employeeDetails[employeeEmail] = employeeData.details;
  }

  return [
    {
      json: {
        queriedMonth: getMonthName(from),
        from,
        to,
        employeeTotalWorkingTime,
        employeeDetails,
      },
    },
  ];
}

const results = await fetchCalamariWorkTimeSummary({
  from: "2026-01-01",
  to: "2026-01-31",
});
console.log(JSON.stringify(results, null, 4));
