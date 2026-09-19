# hooks

这里存放负责组合页面状态和领域操作的自定义 Hook。

## 旅程管理

`useTripManager.ts` 是供页面使用的稳定入口，只负责组装以下领域操作：

- `tripManager/useTripActions.ts`：新增、编辑、复制、删除和排序旅程。
- `tripManager/useDayActions.ts`：插入、删除日期以及后续日期顺延。
- `tripManager/useSegmentActions.ts`：新增、编辑、移动和删除路段。
- `tripManager/types.ts`：子模块共享类型。
- `tripManager/utils.ts`：ID、复制标题和选择回退等纯工具。

页面组件不应直接依赖这些子模块；新增领域操作时，先放入对应子模块，再由
`useTripManager.ts` 统一导出。这样可以保持页面调用稳定，也避免业务逻辑重新堆回
`App.tsx`。

## 页面装配

`App.tsx` 只负责连接页面组件，页面级状态按职责拆分：

- `useAppEditingState.ts`：路段、途经点和起终点的编辑会话。
- `useTripWorkspace.ts`：工作区、筛选条件以及当前旅程视图的派生数据。
- `useTripBackup.ts`：备份文件的导入、导出及进度反馈。
- `useResolvedRoutes.ts`：地图规划结果回写到旅程状态。
- `useMapInfo.ts`：地图标题栏的距离和缓存状态摘要。
