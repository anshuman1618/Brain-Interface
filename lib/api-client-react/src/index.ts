export * from "./generated/api";
export * from "./generated/api.schemas";
export { setBaseUrl, setAuthTokenGetter, setRequestHeadersGetter } from "./custom-fetch";
// Exported for the two places the generated hooks cannot serve: binary file
// upload and download. Using it keeps those requests on the same auth and
// workspace headers as every generated call, rather than a second code path
// that could drift out of step.
export { customFetch, ApiError } from "./custom-fetch";
export type { CustomFetchOptions } from "./custom-fetch";
export type { AuthTokenGetter, RequestHeadersGetter } from "./custom-fetch";
