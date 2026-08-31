// The edge runtime exposes configured environment variables on `process.env`
// without pulling in the full Node type surface, which this project does not use.
declare const process: { env: Record<string, string | undefined> }
