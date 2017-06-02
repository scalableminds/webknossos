/*
 * multipart_data.js
 * @flow
 */

class MultipartData {

  boundary: string;
  data: Array<any>;

  randomBoundary() {
    return "--multipart-boundary--xxxxxxxxxxxxxxxxxxxxxxxx--".replace(/[x]/g,
      () => ((Math.random() * 16) | 0).toString(16));
  }

  constructor(boundary: ?string = null) {
    if (boundary == null) {
      this.boundary = this.randomBoundary();
    } else {
      this.boundary = boundary;
    }
    this.data = [`--${this.boundary}\r\n`];
  }

  addPart(headers: { [name: string]: string | number }, body: ?any = null): void {
    for (const name of Object.keys(headers)) {
      const value = headers[name].toString();
      this.data.push(`${name}: ${value}\r\n`);
    }

    this.data.push("\r\n");
    if (body != null) { this.data.push(body); }
    this.data.push(`\r\n--${this.boundary}\r\n`);
  }

  dataPromise(): Promise<ArrayBuffer> {
    return new Promise((resolve) => {
      const reader = new FileReader();
      reader.onload = e => resolve(e.target.result);
      return reader.readAsArrayBuffer(new Blob(this.data));
    });
  }
}


export default MultipartData;
