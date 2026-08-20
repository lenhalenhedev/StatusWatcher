# Website Monitor Research Findings

## Official Node.js documentation

The Node.js globals documentation confirms the modern global Fetch API and `AbortSignal.timeout(delay)`. The timeout signal aborts asynchronous operations after the configured delay and is available in the Node.js 24 runtime used by this project. The implementation should use a bounded timeout and classify aborts separately from ordinary network failures.

Source: https://nodejs.org/api/globals.html

## Official Discord documentation

Discord embed limits are inclusive: title 256 characters, description 4096, up to 25 fields, field name 256, field value 1024, footer text 2048, author name 256, and a combined 6000-character limit across title/description/field names/values/footer/author for all embeds in one message.

Source: https://docs.discord.com/developers/resources/message#embed-limits

## Design implications

The website status section must be bounded and rendered before the database section. Website checks should use `Response.status` as the primary HTTP result, preserve the response status code for safe status display, avoid response-body reads, and use a timeout signal. User-controlled URLs must be validated before network access, redirects must be disabled or strictly controlled, and all network errors must map to generic safe categories without logging raw URLs or exception text.
