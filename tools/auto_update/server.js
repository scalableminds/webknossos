// @flow
const fs = require("fs");
// eslint-disable-next-line import/no-extraneous-dependencies
const http = require("http");
// eslint-disable-next-line import/no-extraneous-dependencies
const path = require("path");

http
  .createServer((req, res) => {
    if (req.url === "/version") {
      res.writeHead(200);
      res.end(JSON.stringify("5"));
    } else {
      fs.readFile(path.join(__dirname, req.url), (err, data) => {
        if (err) {
          res.writeHead(404);
          res.end(JSON.stringify(err));
          return;
        }
        res.writeHead(200);
        res.end(data);
      });
    }
  })
  .listen(9090);
