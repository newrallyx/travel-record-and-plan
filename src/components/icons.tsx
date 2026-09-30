import type { ReactNode } from 'react'

export type AppIconName =
  | 'archive'
  | 'key'
  | 'compass'
  | 'route'
  | 'edit'
  | 'info'
  | 'image'
  | 'plus'
  | 'trash'
  | 'upload'
  | 'download'
  | 'alert'
  | 'chevronLeft'
  | 'chevronRight'
  | 'windowMinimize'
  | 'windowMaximize'
  | 'windowRestore'
  | 'windowClose'
  | 'book'
  | 'zoomIn'
  | 'zoomOut'
  | 'rotateLeft'
  | 'rotateRight'
  | 'fit'

const iconPaths: Record<AppIconName, ReactNode> = {
  archive: (
    <>
      <path d="M3.5 7.5 5 4.5h14l1.5 3v13h-17v-13Z" />
      <path d="M3.5 7.5h17" />
      <path d="M12 11.5v4.5" />
      <path d="m9.5 13.5 2.5 2.5 2.5-2.5" />
    </>
  ),
  key: (
    <>
      <circle cx="7.5" cy="15.5" r="4" />
      <path d="m10.8 12.3 9.2-9.3" />
      <path d="m16.5 6.5 3 3" />
      <path d="m14 9 2.5 2.5" />
    </>
  ),
  compass: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="m15.6 8.4-2.1 5.1-5.1 2.1 2.1-5.1 5.1-2.1Z" />
    </>
  ),
  route: (
    <>
      <circle cx="6" cy="18" r="2.2" />
      <circle cx="18" cy="6" r="2.2" />
      <path d="M8.2 18H14a3 3 0 0 0 0-6H10a3 3 0 0 1 0-6h5.8" />
    </>
  ),
  edit: (
    <>
      <path d="m4 16.5-.8 4.3 4.3-.8L18.5 9l-3.5-3.5L4 16.5Z" />
      <path d="m13.5 7 3.5 3.5" />
    </>
  ),
  info: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 11v5.5" />
      <circle cx="12" cy="7.6" r="0.9" />
    </>
  ),
  image: (
    <>
      <rect x="3" y="5" width="18" height="14" rx="2.5" />
      <circle cx="8.5" cy="9.5" r="1.5" />
      <path d="m3.5 17.5 5-4.5 4 3.5 3.5-3 4.5 4" />
    </>
  ),
  plus: (
    <>
      <path d="M12 5v14" />
      <path d="M5 12h14" />
    </>
  ),
  trash: (
    <>
      <path d="M4 7h16" />
      <path d="M9.5 7V4.5h5V7" />
      <path d="M6.5 7l1 13h9l1-13" />
      <path d="M10 11v5" />
      <path d="M14 11v5" />
    </>
  ),
  upload: (
    <>
      <path d="M12 16V4" />
      <path d="m7 8.5 5-5 5 5" />
      <path d="M4 20h16" />
    </>
  ),
  download: (
    <>
      <path d="M12 4v12" />
      <path d="m7 11.5 5 5 5-5" />
      <path d="M4 20h16" />
    </>
  ),
  alert: (
    <>
      <path d="M10.3 4.1 2.7 17.4A2 2 0 0 0 4.4 20.4h15.2a2 2 0 0 0 1.7-3l-7.6-13.3a2 2 0 0 0-3.4 0Z" />
      <path d="M12 9.5v4" />
      <circle cx="12" cy="16.5" r="0.9" />
    </>
  ),
  chevronLeft: <path d="m15 18-6-6 6-6" />,
  chevronRight: <path d="m9 18 6-6-6-6" />,
  windowMinimize: <path d="M5 12h14" />,
  windowMaximize: <rect x="5" y="5" width="14" height="14" rx="1.5" />,
  windowRestore: (
    <>
      <rect x="4.5" y="4.5" width="13" height="13" rx="1.5" />
      <path d="M9 7.5h7.5V15" />
    </>
  ),
  windowClose: (
    <>
      <path d="M6 6l12 12" />
      <path d="M18 6 6 18" />
    </>
  ),
  book: (
    <>
      <path d="M12 6.5C10.5 5 8.5 4.5 5.5 4.5v14c3 0 5 .5 6.5 2 1.5-1.5 3.5-2 6.5-2v-14c-3 0-5 .5-6.5 2Z" />
      <path d="M12 6.5v14" />
    </>
  ),
  zoomIn: (
    <>
      <circle cx="11" cy="11" r="7" />
      <path d="m21 21-4.3-4.3" />
      <path d="M11 8v6" />
      <path d="M8 11h6" />
    </>
  ),
  zoomOut: (
    <>
      <circle cx="11" cy="11" r="7" />
      <path d="m21 21-4.3-4.3" />
      <path d="M8 11h6" />
    </>
  ),
  rotateLeft: (
    <>
      <path d="M4.5 9a8.5 8.5 0 1 1-.5 4" />
      <path d="M4.5 4v5h5" />
    </>
  ),
  rotateRight: (
    <>
      <path d="M19.5 9a8.5 8.5 0 1 0 .5 4" />
      <path d="M19.5 4v5h-5" />
    </>
  ),
  fit: (
    <>
      <path d="M4 9V6a2 2 0 0 1 2-2h3" />
      <path d="M20 9V6a2 2 0 0 0-2-2h-3" />
      <path d="M4 15v3a2 2 0 0 0 2 2h3" />
      <path d="M20 15v3a2 2 0 0 1-2 2h-3" />
    </>
  ),
}

interface AppIconProps {
  name: AppIconName
  className?: string
}

export function AppIcon({ name, className }: AppIconProps) {
  return (
    <svg
      className={className}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {iconPaths[name]}
    </svg>
  )
}
