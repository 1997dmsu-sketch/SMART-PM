"use strict";
const http = require("node:http");

// Top-level load-time violation: the guard must count it as load_violations
// and throw before any real request is created.
http.request("http://127.0.0.1:9/");
console.log("LOAD_NOT_BLOCKED");
