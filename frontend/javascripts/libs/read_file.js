// @flow

export function readFileAsText(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = reject;
    reader.onload = () => resolve(reader.result != null ? reader.result.toString() : "");
    reader.readAsText(file);
  });
}

export function readFileAsArrayBuffer(file: File): Promise<ArrayBuffer> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = reject;
    reader.onload = () => {
      if (typeof reader.result === "string" || reader.result === null) {
        // Satisfy flow
        throw new Error("Couldn't read buffer");
      }
      resolve(reader.result);
    };
    reader.readAsArrayBuffer(file);
  });
}
