import saveAs from "file-saver";

export function transformToCSVRow(dataRow: any[]) {
  return dataRow
    .map(String) // convert every value to String
    .map((v) => v.replaceAll('"', '""')) // escape double quotes
    .map((v) => (/[,"\r\n=+-@]/.test(v) ? `"${v}"` : v)) // quote commas, quotes, and newlines
    .join(","); // comma-separated
}

export function saveAsCSV(csvHeader: string[], csvLines: string[], fileName: string) {
  const csv = [csvHeader.join(","), ...csvLines].join("\n");
  const blob = new Blob([csv], {
    type: "text/plain;charset=utf-8",
  });
  saveAs(blob, fileName);
}
