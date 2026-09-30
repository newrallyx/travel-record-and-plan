export type AppMode = 'normal' | 'readonly-demo'

const rawMode = import.meta.env.VITE_APP_MODE

export const appMode: AppMode = rawMode === 'readonly-demo' ? 'readonly-demo' : 'normal'

export const isReadonlyDemoMode = appMode === 'readonly-demo'

export function guardReadonlyWrite(actionName: string): boolean {
  if (!isReadonlyDemoMode) return false
  console.warn(`[readonly-demo] Blocked write action: ${actionName}`)
  return true
}
