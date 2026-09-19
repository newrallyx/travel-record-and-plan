# components

这里存放页面区域和可复用展示组件。

## 地图模块

`MapPanel.tsx` 是页面使用的稳定入口，只负责组合地图能力。具体实现放在 `map/`：

- `useMapTracks.ts`：复用缓存、按需规划路线并生成可展示轨迹。
- `useTrackEditing.ts`：管理起终点和轨迹控制点的编辑草稿。
- `MapCanvas.tsx`：渲染 Leaflet 图层、标记、轨迹和评分图例。
- `MapControllers.tsx`：处理视口、容器尺寸和途经点定位。
- `mapIcons.ts`：集中配置 Leaflet 图标。
- `trackUtils.ts`：坐标转换和全局视图降采样。
- `types.ts`：地图子模块共享类型。

页面和其他业务模块应继续通过 `MapPanel.tsx` 使用地图，不直接依赖内部子模块。
