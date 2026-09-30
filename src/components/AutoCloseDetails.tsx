import { useEffect, useRef, type ReactNode } from 'react'

interface AutoCloseDetailsProps {
  className?: string
  children: ReactNode
}

/** 原生 details 下拉菜单：点击外部自动收起 */
export function AutoCloseDetails({ className, children }: AutoCloseDetailsProps) {
  const ref = useRef<HTMLDetailsElement | null>(null)

  useEffect(() => {
    const onClick = (event: MouseEvent) => {
      const el = ref.current
      if (!el) return
      if (!el.contains(event.target as Node)) {
        el.open = false
      }
    }
    document.addEventListener('mousedown', onClick)
    return () => document.removeEventListener('mousedown', onClick)
  }, [])

  return (
    <details ref={ref} className={className}>
      {children}
    </details>
  )
}
