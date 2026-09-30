import type { ReviewTag } from '../types/trip'

// 复盘标签白名单：稳定英文代码 + 中文界面文案。
// 数据结构与展示分离：存储永远是英文代码，新增标签时同步更新本文件与 ReviewTag 类型。

export interface ReviewTagOption {
  code: ReviewTag
  label: string
}

export interface ReviewTagGroup {
  key: 'weather' | 'road' | 'feeling'
  label: string
  tags: ReviewTagOption[]
}

export const REVIEW_TAG_GROUPS: ReviewTagGroup[] = [
  {
    key: 'weather',
    label: '天气',
    tags: [
      { code: 'SUNNY', label: '晴天' },
      { code: 'OVERCAST', label: '阴天' },
      { code: 'RAIN', label: '下雨' },
      { code: 'FOG', label: '大雾' },
      { code: 'SNOW', label: '下雪' },
      { code: 'HOT', label: '高温' },
      { code: 'COLD', label: '低温' },
    ],
  },
  {
    key: 'road',
    label: '道路情况',
    tags: [
      { code: 'SMOOTH', label: '顺畅' },
      { code: 'CONGESTED', label: '拥堵' },
      { code: 'ROADWORK', label: '修路' },
      { code: 'ROUGH_ROAD', label: '烂路' },
      { code: 'MOUNTAIN_ROAD', label: '山路' },
      { code: 'NIGHT_DRIVING', label: '夜路' },
      { code: 'DETOUR', label: '临时改道' },
    ],
  },
  {
    key: 'feeling',
    label: '自己的感受',
    tags: [
      { code: 'RELAXED', label: '轻松' },
      { code: 'TIRED', label: '疲惫' },
      { code: 'SURPRISE', label: '惊喜' },
      { code: 'NEUTRAL', label: '一般' },
      { code: 'WORTH_REVISIT', label: '值得再走' },
      { code: 'NO_REVISIT', label: '不想再走' },
    ],
  },
]

const REVIEW_TAG_LABELS = new Map<ReviewTag, string>(
  REVIEW_TAG_GROUPS.flatMap((group) => group.tags.map((option) => [option.code, option.label] as const)),
)

export function isReviewTag(value: unknown): value is ReviewTag {
  return typeof value === 'string' && REVIEW_TAG_LABELS.has(value as ReviewTag)
}

export function getReviewTagLabel(code: ReviewTag): string {
  return REVIEW_TAG_LABELS.get(code) ?? code
}

export function getReviewTagLabelSafe(value: unknown): string {
  return isReviewTag(value) ? getReviewTagLabel(value) : ''
}
