var fs = require("fs"),
	http = require("http");

http
	.createServer(function(req, res) {
		console.log(req.url)
		if (req.url === "/version") {
			res.writeHead(200);
			res.end(JSON.stringify("5"));
		} else {
			fs.readFile(__dirname + req.url, function(err, data) {
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
