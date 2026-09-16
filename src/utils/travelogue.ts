import type { ReviewTag, RouteSegment, Trip } from '../types/trip'
import { buildTripFactSummary } from './factSummary.ts'
import { formatDistance, getDayDistanceMeters, getTrackDistanceMeters } from './distance.ts'
import { formatDurationSeconds, getSegmentDurationSeconds } from './durations.ts'
import { formatTollAmount, getSegmentTollYuan } from './tolls.ts'
import { REVIEW_TAG_GROUPS, isReviewTag } from './reviewTags.ts'
import {
  formatSegmentActualDistance,
  formatSegmentActualDuration,
  formatSegmentActualToll,
} from './reviewFacts.ts'
import { normalizeScore } from './segmentScores.ts'
import { getDifficultyScoreBand, getScenicScoreBand } from './roadStatistics.ts'

// 游记生成器：纯规则模板，只使用旅程中已存在的数据。
// 输出 Markdown 文本；缺失的数据会被省略，绝不出现 undefined/NaN。

const REVIEW_TAG_NARRATIVES: Record<ReviewTag, string> = {
  SUNNY: '天气晴朗',
  OVERCAST: '天空多云',
  RAIN: '途中遇雨',
  FOG: '路上起了大雾',
  SNOW: '一路风雪',
  HOT: '天气炎热',
  COLD: '天气寒冷',
  SMOOTH: '路况顺畅',
  CONGESTED: '有些拥堵',
  ROADWORK: '沿途有路段修路',
  ROUGH_ROAD: '路况较差',
  MOUNTAIN_ROAD: '山路弯多坡陡',
  NIGHT_DRIVING: '有一段夜路',
  DETOUR: '途中临时改道',
  RELAXED: '整体轻松',
  TIRED: '有些疲惫',
  SURPRISE: '有意外的惊喜',
  NEUTRAL: '感受一般',
  WORTH_REVISIT: '值得再走一次',
  NO_REVISIT: '不想再走',
}

/** 转义用户文本中的 HTML 字符，避免通过 marked 渲染时注入标记。 */
function escapeMarkdownText(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
}

function formatIsoDateChinese(value: string): string | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value)
  if (!match) return null
  return `${Number(match[1])} 年 ${Number(match[2])} 月 ${Number(match[3])} 日`
}

function describeScenicScore(score: number): string {
  return getScenicScoreBand(score)?.label ?? ''
}

function describeDifficultyScore(score: number): string {
  return getDifficultyScoreBand(score)?.label ?? ''
}

function collectSegmentTags(segment: RouteSegment): ReviewTag[] {
  const tags = segment.reviewFacts?.tags ?? []
  const present = new Set(tags.filter(isReviewTag))
  const ordered: ReviewTag[] = []
  for (const group of REVIEW_TAG_GROUPS) {
    for (const option of group.tags) {
      if (present.has(option.code)) ordered.push(option.code)
    }
  }
  return ordered
}

function buildNoteBlockquote(note: string): string {
  return note
    .split(/\r?\n/)
    .map((line) => `> ${line}`.trimEnd())
    .join('\n')
}

function buildSegmentSection(segment: RouteSegment): string[] {
  const lines: string[] = []

  const heading = segment.name.trim() || `${segment.startPoint} → ${segment.endPoint}`
  lines.push(`### ${escapeMarkdownText(heading)}`)

  const paragraphs: string[] = []

  const routeSentence: string[] = []
  if (segment.startPoint.trim() && segment.endPoint.trim()) {
    routeSentence.push(`从${segment.startPoint}出发，前往${segment.endPoint}`)
  } else if (segment.startPoint.trim()) {
    routeSentence.push(`从${segment.startPoint}出发`)
  } else if (segment.endPoint.trim()) {
    routeSentence.push(`前往${segment.endPoint}`)
  }

  const waypointNames = (segment.waypoints ?? [])
    .map((waypoint) => waypoint.name.trim())
    .filter(Boolean)
  if (waypointNames.length > 0 && routeSentence.length > 0) {
    routeSentence.push(`途经${waypointNames.join('、')}`)
  }
  if (routeSentence.length > 0) paragraphs.push(`${routeSentence.join('，')}。`)

  const statsParts: string[] = []
  const distanceText = formatDistance(getTrackDistanceMeters(segment), '')
  if (distanceText) statsParts.push(`全程 ${distanceText}`)

  const durationSeconds = getSegmentDurationSeconds(segment)
  if (durationSeconds !== null) {
    statsParts.push(`预计行驶 ${formatDurationSeconds(durationSeconds)}`)
  }

  const tollYuan = getSegmentTollYuan(segment)
  if (tollYuan !== null) statsParts.push(`过路费约 ${formatTollAmount(tollYuan)}`)

  const actualParts = [
    formatSegmentActualDistance(segment),
    formatSegmentActualDuration(segment),
    formatSegmentActualToll(segment),
  ].filter((part): part is string => Boolean(part))
  if (actualParts.length > 0) {
    statsParts.push(`实际${actualParts.join('、')}`)
  }
  if (statsParts.length > 0) paragraphs.push(`${statsParts.join('，')}。`)

  const tagPhrases = collectSegmentTags(segment).map((tag) => REVIEW_TAG_NARRATIVES[tag])
  if (tagPhrases.length > 0) paragraphs.push(`${tagPhrases.join('，')}。`)

  const scoreParts: string[] = []
  const scenicScore = normalizeScore(segment.scenicScore)
  if (scenicScore !== null) {
    scoreParts.push(`风景评分 ${scenicScore.toFixed(1)} 分（${describeScenicScore(scenicScore)}）`)
  }
  const difficultyScore = normalizeScore(segment.difficultyScore)
  if (difficultyScore !== null) {
    scoreParts.push(`难度评分 ${difficultyScore.toFixed(1)} 分（${describeDifficultyScore(difficultyScore)}）`)
  }
  if (scoreParts.length > 0) paragraphs.push(`${scoreParts.join('，')}。`)

  if (paragraphs.length > 0) lines.push(escapeMarkdownText(paragraphs.join(' ')))

  const note = segment.note?.trim()
  if (note) lines.push(buildNoteBlockquote(escapeMarkdownText(note)))

  const photoCount = (segment.photoIds ?? []).length
  if (photoCount > 0) lines.push(`沿途留影 ${photoCount} 张。`)

  return lines
}

function buildDaySection(dayIndex: number, day: Trip['days'][number]): string[] {
  const lines: string[] = []
  lines.push(`## 第 ${dayIndex + 1} 天 · ${escapeMarkdownText(day.date)}`)
  lines.push('')

  const dayDistanceText = formatDistance(getDayDistanceMeters(day.routeSegments), '')
  if (dayDistanceText) {
    lines.push(`这一天共行驶 ${dayDistanceText}。`)
    lines.push('')
  }

  for (const segment of day.routeSegments) {
    lines.push(...buildSegmentSection(segment))
    lines.push('')
  }

  return lines
}

/**
 * 根据旅程数据生成游记 Markdown。
 * 只使用已存在的数据，缺失即省略；旅程没有任何路段时输出提示文案。
 */
export function buildTripTravelogue(trip: Trip): string {
  const lines: string[] = []
  lines.push(`# ${escapeMarkdownText(trip.title.trim() || '未命名旅程')}`)
  lines.push('')

  const dateParts = [formatIsoDateChinese(trip.startDate), formatIsoDateChinese(trip.endDate)]
    .filter((part): part is string => Boolean(part))
  if (dateParts.length > 0) lines.push(`> ${dateParts.join(' ～ ')}`)
  if (dateParts.length > 0) lines.push('')

  const sortedDays = [...trip.days].sort((a, b) => a.date.localeCompare(b.date))
  const segmentCount = sortedDays.reduce((sum, day) => sum + day.routeSegments.length, 0)

  if (segmentCount === 0) {
    lines.push('这个旅程还没有记录路段，暂时无法生成游记内容。先在「整理记录」中补充路线、评分和备注，再回来生成吧。')
    return lines.join('\n')
  }

  sortedDays.forEach((day, index) => {
    lines.push(...buildDaySection(index, day))
    lines.push('---')
    lines.push('')
  })

  const summaryText = buildTripFactSummary(trip)
  lines.push('## 行程小结')
  lines.push('')
  if (summaryText) {
    lines.push(escapeMarkdownText(summaryText))
    lines.push('')
  }
  lines.push('> 本文由「旅行轨迹记录与规划工具」根据行程数据自动生成。')

  return lines.join('\n')
}

/** 根据旅程标题生成安全的下载文件名。 */
export function createTravelogueFilename(title: string): string {
  const safeTitle = title.trim().replace(/[\\/:*?"<>|]/g, '-').replace(/\s+/g, ' ').slice(0, 80) || '未命名旅程'
  return `${safeTitle}-游记.md`
}
