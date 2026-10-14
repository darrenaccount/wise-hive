// Result texts that mean a Claude run didn't do its work even though the CLI said is_error:false. One copy, shared so
// the app agrees with itself: autopilot.js (a round or planner that hit a usage limit), server.js simplify() ("not
// logged in" is an error in chats, the council and askClaude) and jobs.js (done or failed in the activity panel).
// Limit messages arrive as errors or, from some CLI versions, as a plain short answer. A real answer can mention
// rate limits, so plain text only counts when it is short and says so outright (LIMIT_PLAIN).
"use strict";
const LIMIT_PLAIN = /usage limit reached|hit your (\w+[ -])?limit|(hour|daily|weekly|session|opus|sonnet) limit reached|limit reached\W+resets?\b|API Error:? *(429|529)|rate_limit_error|overloaded_error/i;
const NOT_LOGGED_IN = /not logged in/i;
const plainLimit = (t) => { t = String(t || "").trim(); return t.length < 400 && LIMIT_PLAIN.test(t); };
// true when a result the CLI called fine is really a failure: Claude isn't signed in, or a plain usage-limit answer.
const softFail = (t) => NOT_LOGGED_IN.test(String(t || "")) || plainLimit(t);
module.exports = { LIMIT_PLAIN, NOT_LOGGED_IN, plainLimit, softFail };
