import type { NumericStatisticsTotal, StatisticsCompleteness } from '../../types/tripStatistics.ts'
import { formatDistance } from '../../utils/distance.ts'
import { formatDurationSeconds } from '../../utils/durations.ts'

export const COMPLETENESS_LABEL: Record<StatisticsCompleteness['status'], string> = {
  complete: '数据完整', partial: '部分完整', missing: '待补全',
}

export function formatNullableDistance(value: number | null): string {
  if (value === null) return '待补全'
  return value === 0 ? '0 公里' : formatDistance(value, '待补全')
}

export function formatPercentage(value: number | null): string {
  return value === null ? '—' : `${(value * 100).toFixed(1)}%`
}

function formatMetricCompletion(completeness: StatisticsCompleteness): string {
  if (completeness.totalItemCount === 0) return '暂无路段记录'
  if (completeness.notApplicableItemCount === completeness.totalItemCount) return '不适用'
  if (completeness.status === 'complete') return '数据完整'
  const knownCount = completeness.completeItemCount + completeness.partialItemCount
  const details = [`已记录 ${knownCount}/${completeness.totalItemCount}`]
  if (completeness.missingItemCount > 0) details.push(`待补全 ${completeness.missingItemCount}`)
  if (completeness.staleItemCount > 0) details.push(`已过期 ${completeness.staleItemCount}`)
  return `${COMPLETENESS_LABEL[completeness.status]}：${details.join('，')}`
}

export function MetricValue({ metric, kind }: { metric: NumericStatisticsTotal; kind: 'distance' | 'duration' | 'days' }) {
  const format = (value: number | null) => value === null ? '待补全' : kind === 'distance'
    ? formatNullableDistance(value) : kind === 'duration' ? formatDurationSeconds(value) : `${value} 天`
  const isComplete = metric.completeness.status === 'complete'
  const notApplicable = metric.completeness.totalItemCount > 0
    && metric.completeness.notApplicableItemCount === metric.completeness.totalItemCount
  return (
    <span className={isComplete ? 'statistics-metric-value' : 'statistics-metric-value is-partial'}>
      <strong>{notApplicable ? '不适用' : isComplete ? format(metric.value) : metric.value === null ? '待补全' : `已记录 ${format(metric.value)}`}</strong>
      <small>{formatMetricCompletion(metric.completeness)}</small>
    </span>
  )
}

export function OverviewCard({ label, metric, kind }: {
  label: string; metric: NumericStatisticsTotal; kind: 'distance' | 'duration' | 'days'
}) {
  return <article className="statistics-overview-card"><span>{label}</span><MetricValue metric={metric} kind={kind} /></article>
}
