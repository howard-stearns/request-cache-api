"use strict";
/*jslint node: true */
// See README.md.

var url = require('url');
var path = require('path');     // Our document-oriented database is going to be the file system.
var crypto = require('crypto'); // To produce evenly distributed keys for our "database"
var fs = require('fs-extra');   // fs-extra is an extension of fs that handles creation of parent directories
var http = require('http');     // We could use a route/middleware framework such as express.js, but it's not needed here.
var request = require('request');  // For making our proxied request

process.title = 'stearns'; // so we can kill the server with shell (pkill stearns)

// This is a quick and dirty, but very functional document-oriented db.
// By construction, no locking is needed in the overall server api (e.g., to achieve concurrency isolation).
function dbPath(id) { // convert id to a pathname in file system.
	// 3 directory levels of 0xff files each should handle 16 million entries without blowing up (and then soft degredation).
	return path.join('db', id.slice(0, 2), id.slice(2, 4), id.slice(4));
}
function dbGet(id, cb) { fs.readFile(dbPath(id), cb); } // same semantics as fs.readFile
function dbPeek(id, cb) { fs.exists(dbPath(id), cb); }   // same as fs.exists
function dbPut(id, data, cb) { // same semantics as fs.writeFile, but creating our db directories as needed
	var pathname = dbPath(id), dir = path.dirname(pathname);
	fs.mkdirs(dir, function (error) {
		if (error) { return cb(error); }
		fs.writeFile(pathname, data, cb);
	});
}

var pendingRequests = {}; // Keeps track of ids.
http.createServer(function (incomming, response) {

	var uri = url.parse(incomming.url, true), requestedUri, hash;
	console.log(new Date().toISOString(), uri.path); // Or use morgan or some such to produce an apache log.
	// Simplicity: Our api operations are all GET. No need to check http method or content type, nor parse body.

	function answer(statusCode, contentType, data) { // Answer the reqest
		// (BTW, express.js would take care of some of this for us with even less code.)
		response.writeHead(statusCode, {'Content-Type': contentType});
		response.end(data);
	}

	switch (uri.pathname) {
	case '/':
		answer(200, 'text/plain', "get /enqueue?uri=encodedUri => {id: aString}\n" +
			   "get /status?id=anIdString => content at encodedUrl, OR 503 status\n" +
			   "Please see test/test.js for examples.");
		break;
	case '/enqueue':
		requestedUri = decodeURIComponent(uri.query.uri);
		// Use hex serialization rather than, e.g., base64, so that it works in case-insensitive file systems.
		hash = crypto.createHash('md5').update(requestedUri).digest('hex');
		answer(200, 'application/json', JSON.stringify({id: hash})); // Now, regardless of history.
		// Initiate the proxied request only if neither pending nor cached.
		if (pendingRequests[hash]) { return; }
		// Note now that the request is in-flight, before starting asynchronous db check.
		pendingRequests[hash] = requestedUri; // Any truthy value will do. Uri handy for debugging.
		// We can handle another user request as soon as the async peek is initiated. node is our "queue".
		dbPeek(hash, function (exists) {
			function done(internalSystemError) {
				if (internalSystemError) {
					console.error(new Date().toISOString(), uri.path, internalSystemError.message || internalSystemError); 
				}
				delete pendingRequests[hash];
			}
			if (exists) { return done(); }
			request({uri: requestedUri, timeout: 10 * 1000}, function (error, response, content) {
				// Design choice: We could cache the specific remote server error, either permanently
				// or as a one-shot, and answer the status message with that.
				// Instead, we do the simplest thing that could work: just log now, and status
				// request will later report a 404.
				if (error) { return done(error); }
				var type = response.headers['content-type'].split(';');
				function htmlize(message) { return '<html><body>' + message + '</body></html>'; }
				if (type[0] !== 'text/html') { content = htmlize('Not HTML!'); }
				// request package uses headers to make content be a proper javascript unicode string.
				dbPut(hash, content || htmlize(response.statusMessage), done);
			});
		});
		break;
	case '/status':
		hash = uri.query.id;
		if (pendingRequests[hash]) { return answer(503, 'text/plain', 'Not ready.'); }
		dbGet(hash, function (error, data) {
			if (error) { return answer(404, 'text/plain', 'No such id.'); }
			answer(200, 'text/html; charset=utf-8', data);
		});
		break;
	default:
		answer(400, 'text/plain', 'Bad request.');
	}
}).listen(3000, '127.0.0.1');


