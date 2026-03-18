import type { TripReview } from '../types/trip'

// 假数据：当 localStorage 为空时使用，方便立刻验证筛选和展示逻辑。
export const mockTripReview: TripReview = {
  trips: [
    {
      id: 'trip-1',
      title: '川西环线复盘',
      category: 'review',
      startDate: '2026-05-01',
      endDate: '2026-05-05',
      days: [
        {
          id: 'day-1-1',
          date: '2026-05-01',
          routeSegments: [
            {
              id: 'seg-1-1-1',
              name: '成都到雅安',
              startPoint: '成都',
              endPoint: '雅安',
              waypoints: [
                { id: 'mock-wp-1', name: '温江' },
                { id: 'mock-wp-2', name: '崇州' },
              ],
              preference: 'HIGHWAY_FIRST',
              routeType: 'DRIVING',
              scenicScore: 7.8,
              difficultyScore: 3.6,
              note: '平原过渡到山区，适合作为热身段。',
            },
            {
              id: 'seg-1-1-2',
              name: '雅安到泸定',
              startPoint: '雅安',
              endPoint: '泸定',
              waypoints: [{ id: 'mock-wp-3', name: '二郎山' }],
              preference: 'AVOID_TOLL',
              routeType: 'DRIVING',
              scenicScore: 8.9,
              difficultyScore: 6.7,
              note: '二郎山一线风景明显提升，弯道也更多。',
            },
          ],
        },
        {
          id: 'day-1-2',
          date: '2026-05-02',
          routeSegments: [
            {
              id: 'seg-1-2-1',
              name: '泸定到康定',
              startPoint: '泸定',
              endPoint: '康定',
              waypoints: [{ id: 'mock-wp-4', name: '磨西镇' }],
              preference: 'HIGHWAY_FIRST',
              routeType: 'DRIVING',
              scenicScore: 9.2,
              difficultyScore: 7.4,
              note: '山路景观突出，注意天气和视线变化。',
            },
          ],
        },
      ],
    },
    {
      id: 'trip-2',
      title: '江南自驾复盘',
      category: 'review',
      startDate: '2026-06-10',
      endDate: '2026-06-12',
      days: [
        {
          id: 'day-2-1',
          date: '2026-06-10',
          routeSegments: [
            {
              id: 'seg-2-1-1',
              name: '杭州到绍兴',
              startPoint: '杭州',
              endPoint: '绍兴',
              waypoints: [{ id: 'mock-wp-5', name: '钱塘江' }],
              preference: 'HIGHWAY_FIRST',
              routeType: 'DRIVING',
              scenicScore: 6.8,
              difficultyScore: 2.9,
              note: '城市间转场路段，补给便利。',
            },
          ],
        },
      ],
    },
  ],
}
