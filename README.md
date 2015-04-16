# Request Cache API

This is job-application coding exercise, specified as follows:

"Create a job queue whose workers fetch data from a URL and store the
results in a database.  The job queue should expose a REST API for
adding jobs and checking their status / results."

"Example: User submits www.google.com to your endpoint.  The user gets back a
job id. Your system fetches www.google.com (the result of which would
be HTML) and stores the result.  The user asks for the status of the
job id and if the job is complete, he gets a response that includes
the HTML for www.google.com"

## API

Please see test/test.js for a spec of how the API is defined.

## Operation
'''
npm start
npm test # in another terminal
npm stop
'''
