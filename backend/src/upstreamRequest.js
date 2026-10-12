export function readOptionalParam(url, key) {
  const value = url.searchParams.get(key)
  return value?.trim() || null
}

/** One deadline covers headers and asynchronous response body consumption. */
export async function requestUpstreamJson(url, { fetchImpl = fetch, timeoutMs = 5000 } = {}) {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  try {
    const response = await fetchImpl(url, { signal: controller.signal })
    const data = await response.json()
    return { response, data }
  } finally { clearTimeout(timer) }
}
