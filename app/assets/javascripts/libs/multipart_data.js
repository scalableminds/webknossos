
class MultipartData {

  randomBoundary() {
    return "--multipart-boundary--xxxxxxxxxxxxxxxxxxxxxxxx--".replace(/[x]/g,
      () => ((Math.random() * 16) | 0).toString(16));
  }


  constructor(boundary) {
    this.boundary = boundary;
    this.boundary = this.boundary || this.randomBoundary();
    this.data = [`--${this.boundary}\r\n`];
  }


  addPart(headers, body) {
    for (const name of Object.keys(headers)) {
      const value = headers[name];
      this.data.push(`${name}: ${value}\r\n`);
    }

    this.data.push("\r\n");
    if (body != null) { this.data.push(body); }
    return this.data.push(`\r\n--${this.boundary}\r\n`);
  }


  dataPromise() {
    return new Promise((resolve) => {
      const reader = new FileReader();
      reader.onload = e => resolve(e.target.result);
      return reader.readAsArrayBuffer(new Blob(this.data));
    },
    );
  }
}


export default MultipartData;
