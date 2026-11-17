# PC4D 接口清单与首批工具范围

核对日期：2026-11-17。接口文档入口：<https://cloud.4dbim.vip/pc/swagger-html>。

本清单基于该入口对应的 Swagger 快照，以及业务后端 `src/controllers/screen.controller.ts`、`src/controllers/beam-screen.controller.ts` 和对应 `src/service/` 实现交叉核对。Swagger 共有 **610 个操作：GET 364、POST 245、DELETE 1**。参数以控制器和服务实际读取为准；静态审查不代表每个项目都配置了相同数据，也不代表所有接口均已使用真实项目完成在线验收。

## 本次登记范围

工具定义保存在 `server/src/integrations/pc4d/catalogue.json`。共登记 **48 个大屏只读工具**：`beam-screen` 15 个，`screen` 33 个。每条工具具有稳定英文名称、原接口标题、具体数据描述、固定路径、参数 JSON Schema 和业务标签。

| 分类 | 接口数 | 当前处理 |
| --- | ---: | --- |
| 大屏只读查询 | 48 | 登记为 `pc4d_screen_*`，限定 `channels: ["screen"]` |
| 大屏路径中的其他操作 | 9 | 暂不暴露；逐项原因见下表 |
| 普通业务、权限、用户、管理、试验、AI、演示等接口 | 553 | 待业务讨论和权限映射确认，不自动登记工具 |
| 总计 | 610 | 不按 Swagger 批量发布全部接口 |

所有登记工具都有“大屏数据”标签，并附“梁场”“管片”“张拉”“蒸养”等标签。标签用于检索和后台筛选，不代替权限。工具仅授予大屏渠道；Web、小程序渠道的普通业务工具仍待讨论确认。

工具调用参数不含 `pid`、`access_token`、Token、任意请求 URL 或请求头。`pid` 由连接器从当前已确定的项目上下文注入，访问地址由服务配置确定。模型只能提供白名单里的业务筛选字段，所有参数对象均设置 `additionalProperties: false`。不得因工具名带有“大屏”就让普通业务助手绕过业务身份校验。

## Swagger 分组统计

以下按原 Swagger tag 计数，一个“接口”对应一种 HTTP 方法和路径组合。

| Swagger 分组 | GET | POST | DELETE | 合计 |
| --- | ---: | ---: | ---: | ---: |
| S07-小程序管片工序填报 | 12 | 2 | 0 | 14 |
| 工序管理 | 11 | 10 | 0 | 21 |
| 发货管理-地址管理 | 2 | 3 | 0 | 5 |
| AI-Exception | 1 | 1 | 0 | 2 |
| AI | 2 | 5 | 0 | 7 |
| 下部结构 | 1 | 3 | 0 | 4 |
| assets | 1 | 2 | 0 | 3 |
| 移梁机信息 | 6 | 3 | 0 | 9 |
| 梁场-固定台座蒸养区 | 2 | 3 | 0 | 5 |
| 梁场-台座类型 | 1 | 4 | 0 | 5 |
| 制梁任务 | 5 | 4 | 0 | 9 |
| 公路梁生产-质量管理 | 3 | 3 | 0 | 6 |
| 梁场-数据大屏 | 16 | 0 | 0 | 16 |
| 梁场-桥梁管理 | 6 | 5 | 0 | 11 |
| 梁场-蒸养室 | 3 | 4 | 0 | 7 |
| 梁场-工序 | 2 | 2 | 0 | 4 |
| 梁场-工序类型 | 1 | 3 | 0 | 4 |
| 梁场-梁类型 | 3 | 5 | 0 | 8 |
| 梁场-运梁任务 | 4 | 3 | 0 | 7 |
| 梁场-预警设置 | 1 | 4 | 0 | 5 |
| 梁管理 | 44 | 13 | 1 | 58 |
| Bm芯片管理 | 4 | 2 | 0 | 6 |
| 发货管理-车辆管理 | 2 | 3 | 0 | 5 |
| 蒸养窑管理 | 7 | 4 | 0 | 11 |
| 通用表单 | 3 | 4 | 0 | 7 |
| 通用表单模板 | 5 | 5 | 0 | 10 |
| 发货管理-送货单位 | 2 | 3 | 0 | 5 |
| 示范工程AI | 5 | 2 | 0 | 7 |
| 示范工程梁场 | 2 | 0 | 0 | 2 |
| demo-reset | 1 | 1 | 0 | 2 |
| 部门/班组管理 | 4 | 2 | 0 | 6 |
| 发货管理-司机管理 | 2 | 3 | 0 | 5 |
| 管片任务 | 8 | 12 | 0 | 20 |
| 管片配筋 | 3 | 8 | 0 | 11 |
| 管片BOM配置 | 14 | 14 | 0 | 28 |
| 项目 | 5 | 3 | 0 | 8 |
| 工厂信息 | 5 | 1 | 0 | 6 |
| 首页 | 16 | 0 | 0 | 16 |
| 发货管理-发货管理 | 9 | 6 | 0 | 15 |
| 水养池管理 | 8 | 5 | 0 | 13 |
| 进场管理 | 2 | 4 | 0 | 6 |
| 库存盘点 | 6 | 4 | 0 | 10 |
| 材料管理 | 8 | 4 | 0 | 12 |
| 模具管理 | 9 | 9 | 0 | 18 |
| 人员管理-班组管理 | 2 | 3 | 0 | 5 |
| 试验管理 | 3 | 4 | 0 | 7 |
| 台座管理 | 10 | 5 | 0 | 15 |
| 管片-生产线 | 2 | 3 | 0 | 5 |
| 项目配置 project_config | 4 | 3 | 0 | 7 |
| 角色管理 | 4 | 3 | 0 | 7 |
| 钢筋笼任务&清单 | 7 | 13 | 0 | 20 |
| 芯片列表管理 | 6 | 4 | 0 | 10 |
| Reader列表管理 | 2 | 3 | 0 | 5 |
| Rfid | 0 | 2 | 0 | 2 |
| 管片类型 | 3 | 3 | 0 | 6 |
| 数据大屏 | 40 | 1 | 0 | 41 |
| 堆场单元管理 | 3 | 4 | 0 | 7 |
| 系统模块权限 | 9 | 0 | 0 | 9 |
| test | 1 | 0 | 0 | 1 |
| 用户 | 6 | 10 | 0 | 16 |
| 堆场列表 | 5 | 3 | 0 | 8 |
| 合计 | 364 | 245 | 1 | 610 |

## 已登记的大屏工具

表中路径统一省略 `/pc/api`，HTTP 方法均为 GET。“无”表示模型无需提供参数，连接器仍须注入项目 `pid`。所有名称均以 `pc4d_screen_` 开头，下表仅展示后缀。

| 工具后缀 | 原接口路径 | 数据用途 | 模型可传参数 |
| --- | --- | --- | --- |
| `pedestal` | `/beam-screen/sys/pedestal` | 台座容量、占用，盖梁立柱区域统计 | 无 |
| `capacity` | `/beam-screen/prod/output` | 近七天产量、平均产能、生产区位置 | `data_type`、`type` |
| `formwork` | `/beam-screen/formwork` | 模板关联梁、台座、设备状态及事件 | 无 |
| `steam` | `/beam-screen/steam` | 梁场养护台座、梁、温湿度 | 无 |
| `steam_fixed` | `/beam-screen/steam/fixed` | 固定蒸养室、台座区域、梁与温湿度 | 无 |
| `tension` | `/beam-screen/tension/case` | 公路梁张拉统计和当前作业卡片 | 无 |
| `grout` | `/beam-screen/grout/case` | 公路梁压浆统计和当前作业卡片 | 无 |
| `tension_details` | `/beam-screen/tension/detail` | 公路梁先张、后张清单与日期 | `page`、`count`、`name` |
| `grout_details` | `/beam-screen/grout/detail` | 公路梁压浆清单与日期 | `page`、`count`、`name` |
| `beam_curing` | `/beam-screen/maintain/info` | 指定梁当前或历史养护详情 | 必填 `beamID`；可选 `isEnd` |
| `railway_tension` | `/beam-screen/railway/tension/case` | 铁路梁张拉台座卡片 | 无 |
| `railway_grout` | `/beam-screen/railway/grout/case` | 铁路梁压浆台座卡片 | 无 |
| `railway_tension_details` | `/beam-screen/railway/tension/detail` | 铁路梁张拉清单与日期 | `page`、`count`、`name` |
| `railway_grout_details` | `/beam-screen/railway/grout/detail` | 铁路梁压浆清单与日期 | `page`、`count`、`name` |
| `substructure_areas` | `/beam-screen/substructure/area-list` | 下部结构产区构件及当前工序 | 无 |
| `factory` | `/screen/sys/simple-info` | 工厂介绍、图片与经纬度 | 无 |
| `segment_production` | `/screen/sys/prod-info` | 管片各生产工序类别数量 | 无 |
| `yards` | `/screen/sys/yard-info` | 堆场容量和实际库存环数 | 无 |
| `segment_progress` | `/screen/sys/element-info` | 管片生产发货总量、月度序列 | 无 |
| `segment_areas` | `/screen/sys/area-info` | 管片生产、蒸养、水养、堆场统计 | 无 |
| `cameras` | `/screen/sys/camera` | 摄像头名称、设备与空间关联 | 无 |
| `engineering_completion` | `/screen/prod/engineer-info` | 各工程钢筋、生产、发货完成量 | 无 |
| `recent_tasks` | `/screen/prod/task-info` | 近期钢筋笼、管片、发货任务进度 | 无 |
| `mould_usage` | `/screen/prod/mould-info` | 模具总数和整体使用量 | 无 |
| `recent_production` | `/screen/prod/details-info` | 近一周逐日生产与发货量 | 无 |
| `mould_details` | `/screen/prod/mould-detail` | 模具、环型、构件、工序及RFID位置 | 无 |
| `engineering_progress` | `/screen/prod/engineer-schedule` | 各工程计划量、生产与发货进度 | 无 |
| `pool_summary` | `/screen/poll/poll-count` | 水养总量、出入池和工程分组 | 无 |
| `pool_overdue` | `/screen/poll/overtime` | 指定水养池记录、入池日期、养护天数 | 必填 `poolID` |
| `pool_details` | `/screen/poll/poll-info` | 指定水养池容量、环型、温度与pH | 必填 `poolID` |
| `pool_cards` | `/screen/poll/poll-card` | 全部启用水养池卡片及池ID | 无 |
| `pool_engineering` | `/screen/poll/engine-info` | 指定工程分规格的水养数量 | 必填 `engineID` |
| `curing_summary` | `/screen/curing/curing-count` | 蒸养容量、分窑和月度统计 | `LineID` |
| `curing_overdue` | `/screen/curing/overtime` | 蒸养记录及已养护小时数 | `LineID` |
| `curing_devices` | `/screen/curing/device` | 蒸养监测设备工作状态与温度 | `LineID` |
| `curing_details` | `/screen/curing/detail` | 蒸养窑详情、温湿度及约24小时曲线 | `LineID` |
| `beam_plan_types` | `/screen/beam-template/statistics` | 各梁类型本月计划与实际及滞后量 | 无 |
| `beam_warnings` | `/screen/beam/month-warning` | 制梁、存梁和架梁计划预警 | 无 |
| `beam_warning_details` | `/screen/beam/warning-list` | 分页读取制架梁计划、实际和原因 | `page`、`count`、`BeamID`、`BeamName`、`SegmentID` |
| `beam_lines` | `/screen/th-Lines` | 项目配置的20m、30m生产区域工序 | 无 |
| `bridges` | `/screen/th-segment-list` | 桥梁总梁数及制架梁计划时间 | 无 |
| `enterprise_relation` | `/screen/enterprise/rel-project` | 当前项目关联企业标识 | 无 |
| `transport_progress` | `/screen/transportation/beam-progress` | 分桥梁制梁、存梁、可架与架梁量 | 无 |
| `transport_vehicles` | `/screen/transportation/vehicle-list` | 架桥机、运梁车状态、位置与任务 | 无 |
| `transport_history` | `/screen/transportation/vehicle-history-list` | 指定运梁车最近10次运梁记录 | 必填 `id` |
| `erection_history` | `/screen/transportation/erect-history-list` | 最近10条架梁记录 | 无 |
| `project` | `/screen/transportation/project-info` | 当前项目名称、锚点和空间概况 | 无 |
| `segment_lines` | `/screen/production-line/list` | 管片生产线、生产蒸养量、容量及线ID | 无 |

## 大屏路径中暂不暴露的9个操作

| 方法 | 完整路径 | 原因及后续条件 |
| --- | --- | --- |
| GET | `/pc/api/screen/prod/mould-detail-bak` | 旧备份实现；使用已登记的 `mould-detail`，避免重复工具和语义混淆 |
| GET | `/pc/api/screen/get-dk` | 特定线路里程换算；不属于本次数据查询范围 |
| POST | `/pc/api/screen/beam/month-warning-description` | 会保存预警原因；属于写操作，不因位于screen路径就默认开放 |
| GET | `/pc/api/screen/sys/camera-info` | 返回视频播放地址及播放Token；需单独的前端播放和敏感字段处理方案，不将凭据交给模型 |
| GET | `/pc/api/screen/enterprise/beam-production` | 按 `EnterpriseID = -engineID` 汇总多个项目，不受当前PID直接限制；待确定企业级访问范围 |
| GET | `/pc/api/screen/enterprise/pedestal-usage` | 企业下跨项目台座汇总；同上 |
| GET | `/pc/api/screen/enterprise/project-list` | 企业下全部关联项目数据；同上 |
| GET | `/pc/api/screen/enterprise/beam-progress` | 企业下多个项目制架梁进度；同上 |
| GET | `/pc/api/beam-screen/labor/information` | 实现读取固定外部劳务账户而非按传入PID筛选，且会串行调用多次外部人员考勤接口；待改为项目绑定和明确数据范围后评估 |

`/screen/poll/engine-info` 的 `engineID` 是当前PID内的工程ID，与上述企业接口中使用的负企业标识不是同一概念。不能复用企业接口的Swagger说明判断数据范围。

## 补齐的参数与数据语义

Swagger 中多个大屏接口的 query 列表为空，服务实际仍有参数。连接器必须校验目录中的 schema，再构造固定请求；不能直接转发模型给出的对象。

- 公路和铁路的四个 `tension/detail`、`grout/detail` 补齐 `page`、`count`、`name`。默认第1页、每页20条，每页上限100。业务服务对名称存在SQL字符串拼接，工具schema拒绝引号、反斜杠、分号和控制字符；业务服务后续仍应改为参数化查询，目录校验不替代服务修复。
- `screen/beam/warning-list` 的业务服务需要 `page` 和 `count`；工具调用允许省略，由连接器补第1页、每页20条后再请求业务服务。
- `beam-screen/maintain/info` 补齐必填 `beamID` 和布尔 `isEnd`。HTTP query 中布尔值序列化为 `true` / `false`，对应服务实际比较的字符串；只控制查询历史或当前养护，不切换设备状态。
- `screen/poll/overtime` 补齐必填 `poolID`，因为实际SQL总是按该池筛选，不传并非“查询所有池”。
- `screen/transportation/vehicle-history-list` 的 `id` 明确为必填车辆ID。Swagger标记可选，但服务缺少该ID时只会返回空数据。
- `LineID`、`BeamID`、`SegmentID`、`BeamName`、`poolID`、`beamID` 大小写保持与业务实现一致，不能统一改为小写。所有ID来自当前项目的数据查询结果，禁止猜测。
- `beam-screen/prod/output` 实际支持逗号分隔的 `data_type` / `type`。省略时使用业务默认值，不能擅自把整个项目理解为仅公路梁。
- 水养字段 `In14` 在当前源码按最近七天计算；工具描述采用实际实现。水养和蒸养的 `overtime` 名为“超期预警”，实际返回按养护开始时间排序的记录，未再次筛选超期阈值。模型应展示时间，不据接口标题直接断言全部超期。
- `screen/th-Lines` 的区域分组、部分设备和统计分支存在项目专用实现；空结果不等于该业务功能不可用。项目功能是否开放应由已验证的项目配置或权限决定。

## 只读审核与输出边界

GET 不代表只读。以下接口在同一Swagger中均声明为GET，但会影响业务状态，因此没有登记为大屏工具，也绝不能通过“只导入GET”的通用导入器自动开放：

| GET 路径 | Swagger说明 | 处理 |
| --- | --- | --- |
| `/pc/api/beam/make-plan-refresh` | 制梁计划-重新生成制梁计划 | 写入或重算业务计划，排除 |
| `/pc/api/beam/change-plan-day` | 修改计划天数 | 修改业务配置或计划，排除 |
| `/pc/api/beam/activity-record-approval` | 工序记录关联审批流 | 触发或关联审批流程，排除 |

对其余553个接口，登录、权限、配置、人员管理、演示重置、上传、下载导出、设备控制和写入等能力需逐项确认。不能仅按URL名称或HTTP方法推断副作用。普通业务查询也要先确认项目模块和用户权限，不能复用公开大屏授权。

已登记的智能模板、养护、摄像头分布和车辆查询会由业务服务读取云端设备或模型信息；审查的服务方法中不发送模板开合、蒸养开关、车辆调度等控制命令。业务服务内部的只读遥测查询与Agent获得任意外部调用能力是两回事，Agent无法自行提供URL或设备控制指令。

模型输出应只获得分析所需的数据字段。尤其 `transportation/vehicle-list` 的原响应同时包含 `DriverData` 和 `CameraInfo`；连接器应移除司机手机号、播放凭据和无关设备配置后再交给模型。播放URL、Token、请求凭据和原始请求头不应写入聊天正文或工具日志。目录登记的是请求范围，具体响应裁剪由连接器负责。

本目录没有调用业务写接口，也没有导入账号、密码或服务端密钥。后续新增业务工具时先登记固定路径、实际参数和副作用，再确定助手渠道及项目/用户可见范围；通过范围过滤后的工具才参与BM25或决策模型筛选。
