import { useEffect, useState } from 'react'
import { AppIcon } from './icons'

interface WindowControlApi {
  minimize: () => Promise<void>
  maximizeToggle: () => Promise<void>
  close: () => Promise<void>
  onMaximizedChange: (callback: (maximized: boolean) => void) => () => void
}

function getWindowApi(): WindowControlApi | null {
  return window.roadtripDesktop?.windowControls ?? null
}

/** 自定义标题栏：仅桌面版渲染（无边框窗口的拖拽区 + 窗口控制按钮） */
export function WindowTitlebar() {
  const api = getWindowApi()
  const [isMaximized, setIsMaximized] = useState(false)

  useEffect(() => {
    if (!api) return
    const unsubscribe = api.onMaximizedChange(setIsMaximized)
    return unsubscribe
  }, [api])

  if (!api) return null

  return (
    <div className="window-titlebar">
      <span className="window-titlebar-title">旅行轨迹记录与规划工具</span>
      <div className="window-titlebar-controls">
        <button type="button" onClick={() => void api.minimize()} aria-label="最小化">
          <AppIcon name="windowMinimize" className="icon-inline" />
        </button>
        <button
          type="button"
          onClick={() => void api.maximizeToggle()}
          aria-label={isMaximized ? '还原窗口' : '最大化窗口'}
        >
          <AppIcon name={isMaximized ? 'windowRestore' : 'windowMaximize'} className="icon-inline" />
        </button>
        <button type="button" className="window-close-btn" onClick={() => void api.close()} aria-label="关闭窗口">
          <AppIcon name="windowClose" className="icon-inline" />
        </button>
      </div>
    </div>
  )
}
