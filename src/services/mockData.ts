import type { TripReview } from '../types/trip'

// 假数据：当 localStorage 为空时使用，方便立刻验证筛选和展示逻辑。
export const mockTripReview: TripReview = {
  trips: [
    {
      id: 'trip-1',
      title: '川西环线复盘',
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
              viaPointsText: '温江,崇州',
              preference: 'HIGHWAY_FIRST',
            },
            {
              id: 'seg-1-1-2',
              name: '雅安到泸定',
              startPoint: '雅安',
              endPoint: '泸定',
              viaPointsText: '二郎山',
              preference: 'LESS_TOLL',
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
              viaPointsText: '磨西镇',
              preference: 'SHORTEST_TIME',
            },
          ],
        },
      ],
    },
    {
      id: 'trip-2',
      title: '江南自驾复盘',
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
              viaPointsText: '钱塘江',
              preference: 'NORMAL_ROAD_FIRST',
            },
          ],
        },
      ],
    },
  ],
}
