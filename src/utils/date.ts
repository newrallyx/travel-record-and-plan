import type { TripDay } from '../types/trip'

// 日期工具：根据起止日期（包含端点）生成 YYYY-MM-DD 列表，不依赖第三方库。
export function eachDayInRange(startDate: string, endDate: string): string[] {
  if (!startDate || !endDate) return []

  const start = new Date(`${startDate}T00:00:00`)
  const end = new Date(`${endDate}T00:00:00`)

  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime()) || start > end) {
    return []
  }

  const result: string[] = []
  const cursor = new Date(start)

  while (cursor <= end) {
    const year = cursor.getFullYear()
    const month = String(cursor.getMonth() + 1).padStart(2, '0')
    const day = String(cursor.getDate()).padStart(2, '0')
    result.push(`${year}-${month}-${day}`)
    cursor.setDate(cursor.getDate() + 1)
  }

  return result
}

// TripDay.date 使用 YYYY-MM-DD，按字符串比较即可得到时间顺序。
// 返回新数组，避免排序时意外修改 React state。
export function sortTripDaysByDate(days: TripDay[]): TripDay[] {
  return [...days].sort((a, b) => a.date.localeCompare(b.date))
}

export function addDaysToIsoDate(date: string, days: number): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date)
  if (!match) return date

  const shifted = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]) + days))
  if (Number.isNaN(shifted.getTime())) return date

  return [
    shifted.getUTCFullYear(),
    String(shifted.getUTCMonth() + 1).padStart(2, '0'),
    String(shifted.getUTCDate()).padStart(2, '0'),
  ].join('-')
}
