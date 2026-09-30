# 道路城市方向推断

本功能仅派生地图显示结果，不写入行程、路线缓存、人工道路分类或里程统计。

## 参考资料

- `src/components/map/roadDirectionReference.ts` 保存带来源和 PDF 页码的沿线控制点顺序，以及 DataV 行政区中心坐标（2026-09-20获取）。行政中心不是实际道路中心线。
- 本轮覆盖实际数据核验中的 70 条全国性线性道路及 6 条有省份限定的省级高速。环线、旧编号有争议的道路和不明省份的同号道路不强行指定端点。
- 完整控制点提取记录保存在本地 `output/road-catalog-audit/ordered-controls.json`；运行时不联网、不上传用户轨迹。

## 判定边界

1. 优先保留明确导航文字；没有文字时按轨迹实际先后经过的控制点顺序推断。
2. 行政中心邻域半径为地级/直辖市12公里、区县7公里。至少匹配两个不重叠邻域；有效路径跨度至少20公里，中心距离与沿线路程需相容。
3. 相邻匹配点在官方顺序中最多相差3个序号，缺失坐标不重新编号。重复经过、往返、反向弯道按实际点序处理。
4. 无效点或超过5公里的相邻点跳跃会阻止锚点跨越。仅给匹配点之间的区间标名，不根据远方端点方位猜测，也不外推到远端孤立片段。
5. 同编号、同参考身份、实际连通且没有岔路的道路分析片段可以组合控制点。闭环不赋予全线端点方向。
6. 推断与文字或其他记录冲突时保留待确认。界面标明“按沿线地点顺序推断”，不把推断标成实测方向。

## 本地真实快照验证

`node scripts/road-directions/validate-snapshot.mjs <snapshot.json>`

输入结构：`{ tripReview, caches: [{segmentId, points, roadParts}] }`。工具只读输入，输出到忽略提交的 `output/road-direction-validation/`。不得将用户完整轨迹或 Electron 数据目录提交到仓库。

验证包含：原始对象不变、分方向次数之和等于合计、实际命名覆盖与未命中原因。命名覆盖率不是准确率；本功能是保守的地理推断，未建立人工逐段真值。

相关测试：

`node --test tests/roadControlPointDirection.test.js tests/overviewAggregation.test.js tests/overviewDirectionDisplay.test.js tests/roadTypeVisualization.test.js`
