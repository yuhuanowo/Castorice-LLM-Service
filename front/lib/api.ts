/**
 * API 請求工具函數
 */

const API_BASE_URL = '/api/backend'

// 從環境變量或 localStorage 獲取 API Key
export function getApiKey(): string {
  if (typeof window === 'undefined') {
    return process.env.NEXT_PUBLIC_API_KEY || ''
  }
  return localStorage.getItem('apiKey') || process.env.NEXT_PUBLIC_API_KEY || ''
}

// API 請求錯誤類型
export class ApiError extends Error {
  constructor(
    message: string,
    public status?: number,
    public data?: any
  ) {
    super(message)
    this.name = 'ApiError'
  }
}

// 通用 API 請求函數
export async function apiRequest<T>(
  endpoint: string,
  options: RequestInit = {}
): Promise<T> {
  const apiKey = getApiKey()
  
  const response = await fetch(`${API_BASE_URL}${endpoint}`, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      'Accept': 'application/json',
      ...(apiKey && { 'X-API-KEY': apiKey }),
      ...options.headers,
    },
  })

  if (!response.ok) {
    let errorData
    try {
      errorData = await response.json()
    } catch {
      errorData = { message: response.statusText }
    }
    throw new ApiError(
      errorData.detail || errorData.message || `HTTP ${response.status}`,
      response.status,
      errorData
    )
  }

  return response.json()
}

// POST 請求簡化
export async function postApi<T>(
  endpoint: string,
  body: any,
  options: RequestInit = {}
): Promise<T> {
  return apiRequest<T>(endpoint, {
    method: 'POST',
    body: JSON.stringify(body),
    ...options,
  })
}

// GET 請求簡化
export async function getApi<T>(
  endpoint: string,
  options: RequestInit = {}
): Promise<T> {
  return apiRequest<T>(endpoint, {
    method: 'GET',
    ...options,
  })
}

// DELETE 請求簡化
export async function deleteApi<T>(
  endpoint: string,
  options: RequestInit = {}
): Promise<T> {
  return apiRequest<T>(endpoint, {
    method: 'DELETE',
    ...options,
  })
}

// 健康檢查
export async function checkHealth(): Promise<boolean> {
  try {
    await getApi('/health')
    return true
  } catch {
    return false
  }
}

// 獲取模型列表
export interface Model {
  id: string
  name: string
  owned_by: string
}

export async function fetchModels(): Promise<Model[]> {
  const data = await getApi<{ data: Model[] }>('/models')
  return data.data || []
}
