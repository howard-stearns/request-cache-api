"use strict";
/*jslint node: true */
var assert = require('assert');
var request = require('request');
var cheerio = require('cheerio'); // A handy html parser.
var shell = require('child_process').spawnSync;

describe("request cache api", function () {
	var base = 'http://localhost:3000';
	var requestId;
	
	// It takes about 25 lines of code to create a suite pre-condition that ensures that the server is running,
	// starting it if necessary, and shutting it down again as a suite post-condition IFF we started it.
	// I'm not going to show that here because it ends up focusing attention on interactions of node, mocha, and the os,
	// instead of on the challenge problem itself. Ask me directly if you want to see that code. -HRS

	before(function () { // So instead, let's just ensure it's running.
		var status = shell('curl', [base]).status;
		if (status !== 0) {
			console.error("Server not running. Use: npm start");
			process.exit(status);
		}
	});
	it("rejects garbage", function (done) {
		request(base + "/invalid-path", function (error, response) {
			assert.ifError(error); // i.e., test fails if there was an error
			assert.equal(response.statusCode, 400); // Not 404, which would invite the client to try again
			// content is unspecified.
			done();
		});
	});
	it("answers root path", function (done) {
		request(base + '/', function (error, response) {
			assert.ifError(error);
			assert.equal(response.statusCode, 200);  // It's polite to answer _something_ for "/" request.
			// content is unspecified (we give some directions)
			done();
		});
	});
	it("queues google", function (done) {
		request(base + '/enqueue?uri=' + encodeURIComponent('http://www.google.com'), function (error, response, content)  {
			assert.ifError(error); 
			// It might be intersesting for the API to answer 201 if the entry is newly created, and 202 if already cached.
			assert.equal(response.statusCode, 200); // ... but we'll just keep it simple with a generic ok.
			assert.equal(response.headers['content-type'], 'application/json'); // add "; charset=utf-8"? No consensus in specs.
			requestId = JSON.parse(content).id;
			assert.ok(requestId);  // i.e., not empty
			done(); // Tells the test framework to go on to the next test.
		});
	});
	it("answers status for a request id", function (done) {
		request(base + '/status?id=' + requestId, function (error, response) {
			assert.ifError(error);
			// If data is not yet ready, 503 is used to indicate that the client should try again later.
			assert.ok((response.statusCode === 200) || (response.statusCode === 503));
			done();
		});
	});
	function pollUntilGood(id, cb) { // cb(error, response, content) when it is ready.
		request(base + '/status?id=' + id, function (error, response, content) {
			if (error) { console.log('poll internal error', error); }
			assert.ifError(error);
			// Test harness takes care of time limits, so we don't need an infinite-loop guard.
			if (response.statusCode === 503) { 
				return setTimeout(function () { pollUntilGood(id, cb); }, 1000);
			}
			cb(error, response, content);
		});
	}
	it("eventually answers the content", function (done) {
		pollUntilGood(requestId, function (error, response, content) {
			assert.ifError(error);
			assert.equal(response.statusCode, 200);
			// Problem spec says result is always html, so let's check here.
			// Regardless of the original site's charset, our server stores utf-8, and answers that here.
			assert.equal(response.headers['content-type'], 'text/html; charset=utf-8');
			var $ = cheerio.load(content);  // Quick test to see if it really is html from google.
			assert.equal($('title').text(), 'Google');
			done();
		});
	});
	it("handles a bogus id", function (done) {
		request(base + '/status?id=bogus', function (error, response) {
			assert.ifError(error);
			assert.equal(response.statusCode, 404);
			done();
		});
	});
	it("handles a bad request", function (done) {
		request(base + '/enqueue?uri=' + encodeURIComponent('http://www.google.notATLD'), function (error, response, content) {
			assert.ifError(error); // Queues up request as normal...
			assert.equal(response.statusCode, 200); 
			assert.equal(response.headers['content-type'], 'application/json');
			requestId = JSON.parse(content).id;
			assert.ok(requestId);
			pollUntilGood(requestId, function (error, response) { // ...but status eventually gives 404.
				assert.ifError(error);
				assert.equal(response.statusCode, 404);
				done();
			});
		});
	});
	it("fails gracefully for non-html sites", function (done) {
		request(base + '/enqueue?uri=' + encodeURIComponent('http://ip.jsontest.com'), function (error, response, content) {
			assert.ifError(error);
			assert.equal(response.statusCode, 200); 
			assert.equal(response.headers['content-type'], 'application/json');
			requestId = JSON.parse(content).id;
			pollUntilGood(requestId, function (error, response, content) {
				assert.ifError(error);
				assert.equal(response.statusCode, 200);
				assert.equal(response.headers['content-type'], 'text/html; charset=utf-8');
				assert.equal(content, '<html><body>Not HTML!</body></html>');
				done();
			});
		});
	});
	it("can handle lots of requests", function (done) {
		var i, resultCount = 0, target = 100; // Not a load test. This isn't a test-harness exercise!
		this.timeout(500 * target); // Tell the test harness we'll be a while.
		function requestHandler(error, response, content) { // Let's not make functions in a for loop!
			if (error) { console.log('enqueue error', i, error); }
			assert.ifError(error);
			assert.equal(response.statusCode, 200); 
			assert.equal(response.headers['content-type'], 'application/json');
			pollUntilGood(JSON.parse(content).id, function (error, response) {
				if (error) { console.log('poll error', error); }
				assert.ifError(error);
				assert.ok((response.statusCode === 200) || (response.statusCode === 404));
				assert.ok(content); // just checking for not empty in this test
				if (++resultCount === target) { done(); }
			});
		}
		for (i = 0; i < target; i++) {
			request(base + '/enqueue?uri=' + encodeURIComponent('http://comcast.net/bogus' + i), requestHandler);
		}
	});
});
