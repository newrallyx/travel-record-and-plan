import type { ReactNode } from 'react'

export type EmptyStateIcon = 'trip' | 'segment' | 'photo' | 'generic'

const iconPaths: Record<EmptyStateIcon, ReactNode> = {
  trip: (
    <>
      <path d="M3.5 13.5 9.5 6.5l3.5 5.5 3-3.5 5.5 5" />
      <circle cx="4" cy="15.5" r="1.8" />
      <circle cx="21.5" cy="15.5" r="1.8" />
    </>
  ),
  segment: (
    <>
      <path d="M12 21c4-3.4 7-6.4 7-10a7 7 0 1 0-14 0c0 3.6 3 6.6 7 10Z" />
      <circle cx="12" cy="11" r="2.4" />
    </>
  ),
  photo: (
    <>
      <rect x="3" y="5" width="18" height="14" rx="2.5" />
      <circle cx="8.5" cy="9.5" r="1.5" />
      <path d="m3.5 17.5 5-4.5 4 3.5 3.5-3 4.5 4" />
    </>
  ),
  generic: (
    <>
      <path d="M4 6.5 12 3l8 3.5v11L12 21l-8-3.5v-11Z" />
      <path d="M4 6.5 12 10l8-3.5M12 10v11" />
    </>
  ),
}

interface EmptyStateProps {
  icon?: EmptyStateIcon
  title: string
  description?: string
  action?: ReactNode
}

function EmptyState({ icon = 'generic', title, description, action }: EmptyStateProps) {
  return (
    <div className="empty-state" role="status">
      <div className="empty-state-icon" aria-hidden="true">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
          {iconPaths[icon]}
        </svg>
      </div>
      <strong className="empty-state-title">{title}</strong>
      {description && <p className="empty-state-description">{description}</p>}
      {action && <div className="empty-state-action">{action}</div>}
    </div>
  )
}

export default EmptyState
