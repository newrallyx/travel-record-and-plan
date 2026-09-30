# 样式维护

`app.css` 是唯一的页面样式入口，由 `App.tsx` 引入。`global.css` 继续由
`main.tsx` 引入，负责全局基础样式、深浅主题令牌和减少动画设置。
Vite 在构建时展开 CSS 导入，不需要修改组件或增加运行时依赖。

## 模块归属

| 模块 | 内容 |
| --- | --- |
| `shell`、`responsive` | 标题栏、导航、工作区和屏幕断点 |
| `controls` | 卡片、表单、按钮及其交互态 |
| `filters`、`trips`、`segment-order` | 筛选、旅程编辑与管理、路段排序 |
| `map`、`map-editor`、`map-legend`、`photo-markers` | 地图、编辑工具、图例、照片标记 |
| `segment-details`、`review-facts` | 路段详情、实际记录 |
| `photos`、`photo-viewer-controls`、`photo-library` | 相册、候选选择、查看器、照片库 |
| `settings-dialog`、`dialogs`、`help` | 地图配置、通用对话框、帮助 |
| `panels`、`panel-responsive` | 面板折叠、锚点导航和窄屏恢复 |
| `feedback`、`loading`、`icons-toast`、`interaction` | 动画、加载、图标、提示及交互补充 |
| `roadbook`、`roadbook-library` | 路书详情与书架 |
| `statistics` | 统计页、路书统计、道路分析折叠区 |
| `theme`、`theme-supplements` | 现有跨模块深色主题规则 |
| `compatibility` | 仍依赖末尾级联顺序的跨模块覆盖 |

以上文件均位于 `modules/`。导入顺序保留原有级联阶段，不能按文件名排序，
也不能直接改用 `@layer`，否则可能改变选择器优先级。

## 归并约定

- 模块的新增样式、精修和局部响应式规则写回所属文件；已有相同选择器时合并声明。
- 颜色和表面效果使用 `global.css` 中已有令牌；公共控件的 38px 最小高度使用
  `--control-min-height`，筛选器与详情按钮的特定尺寸继续保留。
- 公共按钮的最终样式和字重已并入 `controls.css`。路书、详情、编辑表单和
  道路分析精修已归入各自模块；被最终规则无条件覆盖的旧声明已移除。
- 顶栏、面板表面与卡片阴影已归回 `shell`、`panels`、`controls`、`roadbook`
  和 `statistics`；地图外框使用同一轻阴影，不保留被兼容层覆盖的重阴影。
  通用圆角使用 `--radius-sm/md/panel/lg`，键盘焦点光晕使用 `--shadow-focus`。
- `compatibility.css` 暂时保留共享控件状态、跨模块控件尺寸，以及覆盖早期断点的
  工作区列宽和地图行顺序。这些规则需要在主题和响应式规则之后生效。
  不应继续在这里追加单个功能的样式。
- 合并时同时检查简写/长写、组合类、伪类、深色主题、容器查询和媒体查询。
  例如书架同时拥有 `roadbook-stats-row` 和 `roadbook-library-stats`，其旧的
  `margin-top: 0` 已被最终的 `margin: 14px 0` 覆盖，不能在归并后重新生效。

## 验证边界

本次以修改前工作区 CSS 副本为基准，在独立浏览器的内置示例数据上逐页切换
原样式和新样式，对照计算样式、伪元素和截图。主要覆盖路书书架、单次旅程、
整理记录、路段详情/编辑、规划和统计页面，以及深浅主题和布局断点。
该验证不等于真实轨迹、照片内容或已发布 EXE 的验证。
