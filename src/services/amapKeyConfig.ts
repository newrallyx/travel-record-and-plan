import { LOCAL_API_CLIENT_HEADERS } from './localApiClient.ts'

export type AmapKeySource = 'environment' | 'local-config' | null

export interface AmapKeyStatus {
  configured: boolean
  source: AmapKeySource
}

interface AmapKeyStatusResponse {
  ok?: boolean
  configured?: boolean
  source?: AmapKeySource
  message?: string
}

async function readJsonResponse(response: Response): Promise<AmapKeyStatusResponse> {
  try {
    return (await response.json()) as AmapKeyStatusResponse
  } catch {
    return {}
  }
}

export async function getAmapKeyStatus(): Promise<AmapKeyStatus> {
  const response = await fetch('/api/config/amap-key', {
    headers: LOCAL_API_CLIENT_HEADERS,
  })
  const payload = await readJsonResponse(response)
  if (!response.ok || !payload.ok) {
    throw new Error(payload.message || '无法读取地图服务配置。')
  }

  return {
    configured: Boolean(payload.configured),
    source: payload.source === 'environment' || payload.source === 'local-config' ? payload.source : null,
  }
}

export async function saveAmapKey(key: string): Promise<AmapKeyStatus> {
  const response = await fetch('/api/config/amap-key', {
    method: 'POST',
    headers: {
      ...LOCAL_API_CLIENT_HEADERS,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ key: key.trim() }),
  })
  const payload = await readJsonResponse(response)
  if (!response.ok || !payload.ok) {
    throw new Error(payload.message || '保存地图服务 Key 失败。')
  }

  return {
    configured: true,
    source: payload.source === 'environment' ? 'environment' : 'local-config',
  }
}
