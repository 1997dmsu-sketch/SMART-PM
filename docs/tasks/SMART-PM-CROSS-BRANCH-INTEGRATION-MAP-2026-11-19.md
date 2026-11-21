# SMART-PM 跨分支集成依赖图（只读预演 · 2026-11-19）

> ⚠️ **快照标注**：截至 2026-11-20T06:56 快照；未覆盖 H4-c S0–S4、rental S1、租赁合同 v4、需求台账、OPS、REL-AI-03、07B 候选等新增线；冲突矩阵仅对旧 tip 成立（任一输入前移即作废）。

> 状态：**只读预演 + 单文档交付，待 Codex 独立复审；不构成合并 / 实施 / 部署授权。**
>
> 边界：不安装、不跑业务测试、不启动 HTTP/UI、不接设备 / 支付 / 业务云、不部署、不合并；不改全局 Git/TLS；不改无关文件；不 amend / rebase / reset / squash / force / cherry-pick。
>
> **云独立参考声明**：本文引用的“云参考”为调度方转述，**非 Windows 本轮产物**，本机未取得原文；凡云参考结论均单独标注为“云参考”，不与本地实测混写。本地缺失或无法判定的项一律写“未知 / 不可判定”，不写“非祖先 / 已闭合”。

| 项 | 值 |
|---|---|
| 任务 | C（续派）：跨分支集成依赖图只读分析 |
| 执行者 | DSH 根代理 `lead`（`deepseek-flash`） |
| 任务日期（文件名） | 2026-11-19 |
| 本轮执行时点 | 2026-11-20T06:56+08:00（Asia/Shanghai） |
| run | `CROSS-BRANCH-MAP-2026-11-20T0656+0800` |
| 工作树 | `C:\Users\Administrator\Documents\ChatGPT\宇宙智联\.tmp\cross-branch-map` |
| 分支 | `docs/smart-pm-cross-branch-integration-map` |
| 起点 / 父提交 | `282a20fca9f64ab80ead50372c9c3e90bf4aeba7` |
| 本文件 | `docs/tasks/SMART-PM-CROSS-BRANCH-INTEGRATION-MAP-2026-11-19.md`（唯一新增） |
| 未执行 | 合并、提交除本文件外的任何内容、安装、业务测试、HTTP/UI、业务云 / 设备 / 支付、部署上线 |

## 0. 结论摘要

| # | 结论 | 证据强度 |
|---|---|---|
| 1 | 7 个固定对象全部存在，均为 `commit`，tree 均可解析 | 本地实测 |
| 2 | 远端 8 个候选相关 ref + main 与固定 SHA 逐一相同；目标分支远端不存在；无前移，未替换任何 SHA | 本地 `ls-remote` |
| 3 | 07B / G1 / G2 / C1 / PRE 的 main 祖先关系本地可证（exit 0） | 本地实测 |
| 4 | G3 / G4 受 shallow 边界 `5abfd74` 截断：`main→G3`、`main→G4`、`G2→G3`、`G2→G4` 等**本地不可判定**，**不得称“非祖先”** | 本地实测 + 边界声明 |
| 5 | `5f1d7a4 → 49c5f79` 本地可证（直接父） | 本地实测 |
| 6 | 真实 `merge-tree`：可判定 face 组合 exit 0；预签约 × 07B / G1 / G2 / C1 exit 1，冲突固定 2 路径；G3 / G4 参与的多数组合 exit 128（无 merge base），**不是冲突** | 本地实测 |
| 7 | 条件预演（显式 `--merge-base`）：G2 × G3 / G4、G3 / G4 × 07B / G1 / C1 均 clean；G3 / G4 × PRE 冲突同 2 路径 | 条件预演，非本地祖先证明 |
| 8 | 云参考称 G2→G3→G4、`4f9c43d` 在 G4 链内、`2054404` 不在、预签约与 6face 冲突同 2 路径；独立内容对照仅限 §3.4 所列文件，不能证明整链包含或谱系；C03/C04 不作内容包含旁证 | 云参考转述 + 限定文件对照 |
| 9 | **只读预演不解决冲突**；冲突路径留待未来获授权的合并动作处理 | 边界声明 |

### 0.1 未覆盖范围

本图只覆盖 6 个 face 固定对象 + codex 预签约代码线（`3bf5951`），不含 staged S 线（H4-c S0–S4、rental S1）与 B 线合同文档（租赁合同 v4），也不含需求台账、OPS、REL-AI-03、07B 候选等新增线；冲突矩阵仅对旧 tip 成立。

## 1. 固定输入与对象齐全性

固定输入（本轮唯一口径，不替换）：

| ID | 分支 | 固定 SHA | 类型 | tree | 直接父 |
|---|---|---|---|---|---|
| 07B | `feat/hk-face-07b-offline-gate` | `1be517e48cadd810caa4f44df9e38e14c8b2c764` | commit | `0ced1e1723342c7cfcfe8e9f0b6a450fc6d825c2` | `cc4ec7baf5ca4bcc52c3466b99b6b41b6374ff08` |
| G1 | `feat/hk-face-legacy-requeue-closure` | `205440426183053bb8b31459a1945bd955f66e63` | commit | `ecbf55c5a9779abb53be8b4e2c550193e1b82231` | `10d694fd17aecbf0a9c240ad0798e1ad07fb90c5` |
| G2 | `feat/hk-face-strict-retry` | `c8290db0c22bf5e84ceede2d58b6daad7ce2887b` | commit | `14bfb17b7ace4c7e0f71d531899535e329e9d0c8` | `b3a41eaabf59e84a2f99babfee2f0c45ac418f49` |
| G3 | `feat/hk-face-g3-e07-candidate` | `5f1d7a409847bc78d860963f13b45358fac7b5d6` | commit | `38675c39ea6652fca28106a80c49437e0257bede` | `5abfd746609ab8fac141ce5ecc527479250cc4e2` |
| G4 | `feat/hk-face-g4-compatibility-review` | `49c5f790992424f2ee5ef4c5a3f0cdbf901623d4` | commit | `c4e3fda3645ea48f63d9e34521e3186168251d92` | `5f1d7a409847bc78d860963f13b45358fac7b5d6` |
| C1 | `feat/hk-face-h4c-reconciliation` | `5dff386fe5c9648b04d1623d3e1898c59332639e` | commit | `adfca022f62a227c15d3f8621bdc58285214bb79` | `90e4189717e21a5d458b09da34677ef29795c767` |
| 预签约 | `codex/rental-post-payment-review` | `3bf595140088bc71a3939fb67880807965e9c566` | commit | `d4542a1851245412e366dac55ef0454bd4f1f807` | `922c4ab4a4407a4031fac9c3c836bba1797838ce` |

对象检查（共享对象库，只读）：

```text
git cat-file -t <sha>            # 7/7 -> commit
git rev-parse --verify <sha>^{tree}   # 7/7 -> 有效 tree
git log -1 --format=%P <sha>     # 上表父提交，逐项一致
```

### 1.1 齐全性结论

- **tip commit / tree / 本次 diff 所需 blob 齐全**：7/7 均可解析，未出现缺对象导致的读取失败。
- **G3 / G4 的历史不齐**：`.git/shallow` 含 `5abfd746609ab8fac141ce5ecc527479250cc4e2`，`git rev-parse --is-shallow-repository` = `true`；G3 的父正是该边界，G4 的父是 G3。边界之前的祖先对象本地缺失。
- 其余 5 条（07B / G1 / G2 / C1 / 预签约）可回溯至 main，无需边界假设。

> 因此：**对象齐全 ≠ 历史齐全**。G3 / G4 的“祖先/分叉”判断必须区分“本地可证”与“浅历史不可判定”。

## 2. 远端前移核对（先核输入，不替换）

`git ls-remote origin <refs>`（只读；未 `fetch`、未改 remote-tracking ref）：

| ref | 远端 SHA | 与固定输入 |
|---|---|---|
| `refs/heads/feat/hk-face-07b-offline-gate` | `1be517e48cadd810caa4f44df9e38e14c8b2c764` | 一致 |
| `refs/heads/feat/hk-face-legacy-requeue-closure` | `205440426183053bb8b31459a1945bd955f66e63` | 一致 |
| `refs/heads/feat/hk-face-strict-retry` | `c8290db0c22bf5e84ceede2d58b6daad7ce2887b` | 一致 |
| `refs/heads/feat/hk-face-g3-e07-candidate` | `5f1d7a409847bc78d860963f13b45358fac7b5d6` | 一致 |
| `refs/heads/feat/hk-face-g4-compatibility-review` | `49c5f790992424f2ee5ef4c5a3f0cdbf901623d4` | 一致 |
| `refs/heads/feat/hk-face-h4c-reconciliation` | `5dff386fe5c9648b04d1623d3e1898c59332639e` | 一致 |
| `refs/heads/feat/rental-reservations-presigning` | `922c4ab4a4407a4031fac9c3c836bba1797838ce` | 固定输入 `3bf5951` 的父，一致 |
| `refs/heads/codex/rental-post-payment-review` | `3bf595140088bc71a3939fb67880807965e9c566` | 一致（codex 线最新代码；另有 docs-only 后代 `9026f51`，未纳入固定输入） |
| `refs/heads/docs/smart-pm-cross-branch-integration-map` | **不存在（空输出）** | 本次新建 |
| `refs/heads/main` | `282a20fca9f64ab80ead50372c9c3e90bf4aeba7` | 未前移 |

结论：**无远端前移、无分叉、无需替换任何固定 SHA**；预签约分析对象取 `3bf5951`（其父为 `922c4ab`，二者都在同一远端链上）；`3bf5951` 之后另有 docs-only 后代 `9026f51`（相对 `3bf5951` 仅新增 `docs/RENTAL-OPEN-ITEMS-CONTRACT-CARD.md`，+214 行），不在本轮矩阵范围。

## 3. 祖先 / 分叉

### 3.1 本地可证（`git merge-base --is-ancestor` exit 0）

| 祖先 | 后代 | 结果 |
|---|---|---|
| `282a20f` | 07B `1be517e` | exit 0 |
| `282a20f` | G1 `2054404` | exit 0 |
| `282a20f` | G2 `c8290db` | exit 0 |
| `282a20f` | C1 `5dff386` | exit 0 |
| `282a20f` | 预签约 `922c4ab` → `3bf5951` | exit 0（两级均验） |
| `4f9c43d` | G1 `2054404` | exit 0（G1 后补） |
| `4f9c43d` | G2 `c8290db` | exit 0（G2 含 G1 代码至该点） |
| G3 `5f1d7a4` | G4 `49c5f79` | exit 0（**直接父**） |

### 3.2 浅历史不可判定（本地 exit 1，但**不得**称“非祖先”）

| 祖先 | 后代 | 本地结果 | 原因 |
|---|---|---|---|
| `282a20f` | G3 `5f1d7a4` | exit 1，`merge-base` 空 | G3 父为 shallow 边界 `5abfd74`，边界前对象缺失 |
| `282a20f` | G4 `49c5f79` | exit 1，`merge-base` 空 | 同上（G4 经 G3） |
| G2 `c8290db` | G3 `5f1d7a4` | exit 1，`merge-base` 空 | 同上 |
| G2 `c8290db` | G4 `49c5f79` | exit 1，`merge-base` 空 | 同上 |
| `4f9c43d` | G4 `49c5f79` | exit 1，`merge-base` 空 | 同上 |
| G1 `2054404` | G4 `49c5f79` | exit 1，`merge-base` 空 | 同上 |
| 07B `1be517e` | G3 / G4 | exit 1，`merge-base` 空 | 同上 |
| C1 `5dff386` | G3 / G4 | exit 1，`merge-base` 空 | 同上 |
| 预签约 `3bf5951` | G3 / G4 | exit 1，`merge-base` 空 | 同上 |

> **规则**：`exit 1` 只表示“当前对象库找不到共同祖先”，不等于“历史中一定不存在”。该历史快照中的 G3 / G4 祖先关系保持本地不可判定；§3.3 云参考仅作转述单列，§3.4 的限定文件对照不证明谱系，不写成“确定非祖先”。

### 3.3 云独立参考（非 Windows、非本轮）

调度方转述的云独立参考（本机无原文，未逐字读取）：

1. **G2 → G3 → G4** 构成祖先链；
2. **G1 原 `4f9c43d` 在 G4 祖先链内；后补 `2054404` 不含**；
3. **预签约与 6face 均冲突** `CHANGELOG.md` 及 `admin-web/lib/store.mjs`。

本文对上述三条的处置：

- 第 1 条：该历史快照中本地因 shallow 不能直接证。§4.3 C03/C04 人为将 base 指定为输入一侧 G2，该侧相对 base 无变更，所得另一侧 tree 不是独立的内容包含或祖先证明；两条仅保留为给定 base 下的条件预演记录，不能据此认定 G3/G4 包含 G2。
- 第 2 条：本地内容核对与之一致——G4 的 `h3b.mjs` / `h4b.mjs` 与 `4f9c43d` 相同；`2054404` 新增的 `admin-web/tests/helpers/closure-guard.mjs` 在 G4 中**不存在**；G4 的 `face-legacy-requeue-closure.test.mjs` 与 `4f9c43d` 相同（§3.4）。
- 第 3 条：本地 4/6 可直接复现冲突（07B / G1 / G2 / C1）；G3 / G4 条件预演（base=main）也复现同两路径（§4.2 / §4.3）。**条件预演不是本地祖先证明。**

### 3.4 内容级旁证（不是谱系判定）

既有只读文件对照仅说明各行明确列出的文件相同、不同、存在或缺失；不扩大为整个分支内容包含、不替代祖先判断：

| 核对 | 命令 | 结果 |
|---|---|---|
| G4 的 `h3b.mjs` / `h4b.mjs` 与 `4f9c43d` 相同 | `git diff --name-only 4f9c43d 49c5f79 -- admin-web/lib/face-service/h3b.mjs admin-web/lib/face-service/h4b.mjs` | 空（相同） |
| G4 不含 `2054404` 新增 helper | `git cat-file -e 49c5f79:admin-web/tests/helpers/closure-guard.mjs` | exit 128，路径不存在 |
| G4 的 G1 封闭测试 = `4f9c43d` 版 | `git diff --name-status 4f9c43d 49c5f79 -- admin-web/tests/face-legacy-requeue-closure.test.mjs` | 空（相同） |
| G3 / G4 内容不含 07B 读模型改动 | `git diff --name-only 1155b7b 5f1d7a4 -- admin-web/lib/face-service/service.mjs`（G4 同） | 空（二者 `service.mjs` = 共同底座；07B 的 +70/−3 未进入） |
| G3 / G4 缺少 `h4c-evidence.mjs` 文件 | `git cat-file -e 5f1d7a4:admin-web/lib/face-service/h4c-evidence.mjs`（G4 同） | 均不存在 |
| `5abfd74` 与 `521a0f0`、`c8290db` 与 `dcb36b8` 的变更路径对照 | `git diff --name-status 5abfd74 521a0f0` 与 `git diff --name-status c8290db dcb36b8` | 两次均为同 5 个 G3 文件；`git diff c8290db 521a0f0` 仅 `routes.mjs`（−7 行） |

> 这些仅是**限定文件/变更路径对照**；相同路径清单本身不证明文件内容或整棵 tree 相等。该历史快照中 `5abfd74` 的真实 parent 对象缺失，因此“5abfd74 的父就是 dcb36b8”仍是推断，不是本地谱系事实。

## 4. `merge-tree` 只读预演

### 4.1 记号

- 命令：`git merge-tree --write-tree --name-only [--merge-base=<base>] <A> <B>`
- `exit 0`：成功生成合并树（FF 时 tree = tip tree）；**不代表已合并、更不代表业务通过**。
- `exit 1`：内容冲突，首行是带冲突标记的 tree，随后是冲突路径。
- `exit 128`：`fatal: refusing to merge unrelated histories`——**无法建立 merge base（浅历史 / 不连通），不是冲突**。
- 下列结果绑定 main `282a20f` 与上述固定 tip；任一输入前移即作废重跑。

### 4.2 真实运行（未指定 merge-base；28 条）

```text
# [01] exit=0 tree=0ced1e1723342c7cfcfe8e9f0b6a450fc6d825c2
git merge-tree --write-tree --name-only 282a20fca9f64ab80ead50372c9c3e90bf4aeba7 1be517e48cadd810caa4f44df9e38e14c8b2c764

# [02] exit=0 tree=ecbf55c5a9779abb53be8b4e2c550193e1b82231
git merge-tree --write-tree --name-only 282a20fca9f64ab80ead50372c9c3e90bf4aeba7 205440426183053bb8b31459a1945bd955f66e63

# [03] exit=0 tree=14bfb17b7ace4c7e0f71d531899535e329e9d0c8
git merge-tree --write-tree --name-only 282a20fca9f64ab80ead50372c9c3e90bf4aeba7 c8290db0c22bf5e84ceede2d58b6daad7ce2887b

# [04] exit=128 fatal: refusing to merge unrelated histories（浅：无 merge base）
git merge-tree --write-tree --name-only 282a20fca9f64ab80ead50372c9c3e90bf4aeba7 5f1d7a409847bc78d860963f13b45358fac7b5d6

# [05] exit=128 fatal: refusing to merge unrelated histories（浅）
git merge-tree --write-tree --name-only 282a20fca9f64ab80ead50372c9c3e90bf4aeba7 49c5f790992424f2ee5ef4c5a3f0cdbf901623d4

# [06] exit=0 tree=adfca022f62a227c15d3f8621bdc58285214bb79
git merge-tree --write-tree --name-only 282a20fca9f64ab80ead50372c9c3e90bf4aeba7 5dff386fe5c9648b04d1623d3e1898c59332639e

# [07] exit=0 tree=d4542a1851245412e366dac55ef0454bd4f1f807
git merge-tree --write-tree --name-only 282a20fca9f64ab80ead50372c9c3e90bf4aeba7 3bf595140088bc71a3939fb67880807965e9c566

# [08] exit=0 tree=7981f76cc0e8354a143ba95c025fda95d8a8904a
git merge-tree --write-tree --name-only 1be517e48cadd810caa4f44df9e38e14c8b2c764 205440426183053bb8b31459a1945bd955f66e63

# [09] exit=0 tree=f925f473b59e16febce1556bed761d7a740be813
git merge-tree --write-tree --name-only 1be517e48cadd810caa4f44df9e38e14c8b2c764 c8290db0c22bf5e84ceede2d58b6daad7ce2887b

# [10] exit=128 fatal: refusing to merge unrelated histories（浅）
git merge-tree --write-tree --name-only 1be517e48cadd810caa4f44df9e38e14c8b2c764 5f1d7a409847bc78d860963f13b45358fac7b5d6

# [11] exit=128 fatal: refusing to merge unrelated histories（浅）
git merge-tree --write-tree --name-only 1be517e48cadd810caa4f44df9e38e14c8b2c764 49c5f790992424f2ee5ef4c5a3f0cdbf901623d4

# [12] exit=0 tree=c4c20469b1a0fe20ee9db2419e38408123cb896c
git merge-tree --write-tree --name-only 1be517e48cadd810caa4f44df9e38e14c8b2c764 5dff386fe5c9648b04d1623d3e1898c59332639e

# [13] exit=1 tree=de6f8f53ca6d3a38dbd1a0e52b3a759163e34f32  conflicts: CHANGELOG.md; admin-web/lib/store.mjs
git merge-tree --write-tree --name-only 1be517e48cadd810caa4f44df9e38e14c8b2c764 3bf595140088bc71a3939fb67880807965e9c566

# [14] exit=0 tree=3de75dcaa94fe8dcd9ebcba4713491cd4b2aecb0
git merge-tree --write-tree --name-only 205440426183053bb8b31459a1945bd955f66e63 c8290db0c22bf5e84ceede2d58b6daad7ce2887b

# [15] exit=128 fatal: refusing to merge unrelated histories（浅）
git merge-tree --write-tree --name-only 205440426183053bb8b31459a1945bd955f66e63 5f1d7a409847bc78d860963f13b45358fac7b5d6

# [16] exit=128 fatal: refusing to merge unrelated histories（浅）
git merge-tree --write-tree --name-only 205440426183053bb8b31459a1945bd955f66e63 49c5f790992424f2ee5ef4c5a3f0cdbf901623d4

# [17] exit=1 tree=e6494b3b941d5239430fa32a8887b150a0938e88  conflicts: CHANGELOG.md; admin-web/lib/store.mjs
git merge-tree --write-tree --name-only 205440426183053bb8b31459a1945bd955f66e63 3bf595140088bc71a3939fb67880807965e9c566

# [18] exit=128 fatal: refusing to merge unrelated histories（浅）
git merge-tree --write-tree --name-only c8290db0c22bf5e84ceede2d58b6daad7ce2887b 5f1d7a409847bc78d860963f13b45358fac7b5d6

# [19] exit=128 fatal: refusing to merge unrelated histories（浅）
git merge-tree --write-tree --name-only c8290db0c22bf5e84ceede2d58b6daad7ce2887b 49c5f790992424f2ee5ef4c5a3f0cdbf901623d4

# [20] exit=1 tree=454349ffa53dbe6975d9a96cb317dba1942080fb  conflicts: CHANGELOG.md; admin-web/lib/store.mjs
git merge-tree --write-tree --name-only c8290db0c22bf5e84ceede2d58b6daad7ce2887b 3bf595140088bc71a3939fb67880807965e9c566

# [21] exit=0 tree=c4e3fda3645ea48f63d9e34521e3186168251d92（= G4 tree）
git merge-tree --write-tree --name-only 5f1d7a409847bc78d860963f13b45358fac7b5d6 49c5f790992424f2ee5ef4c5a3f0cdbf901623d4

# [22] exit=128 fatal: refusing to merge unrelated histories（浅）
git merge-tree --write-tree --name-only 5f1d7a409847bc78d860963f13b45358fac7b5d6 5dff386fe5c9648b04d1623d3e1898c59332639e

# [23] exit=128 fatal: refusing to merge unrelated histories（浅）
git merge-tree --write-tree --name-only 5f1d7a409847bc78d860963f13b45358fac7b5d6 3bf595140088bc71a3939fb67880807965e9c566

# [24] exit=128 fatal: refusing to merge unrelated histories（浅）
git merge-tree --write-tree --name-only 49c5f790992424f2ee5ef4c5a3f0cdbf901623d4 5dff386fe5c9648b04d1623d3e1898c59332639e

# [25] exit=128 fatal: refusing to merge unrelated histories（浅）
git merge-tree --write-tree --name-only 49c5f790992424f2ee5ef4c5a3f0cdbf901623d4 3bf595140088bc71a3939fb67880807965e9c566

# [26] exit=1 tree=e3c35d125c05cddb0b260657327effed114e235c  conflicts: CHANGELOG.md; admin-web/lib/store.mjs
git merge-tree --write-tree --name-only 5dff386fe5c9648b04d1623d3e1898c59332639e 3bf595140088bc71a3939fb67880807965e9c566

# [27] exit=0 tree=25a85ef27425b748a191b2674f0fad8e6054384e
git merge-tree --write-tree --name-only 205440426183053bb8b31459a1945bd955f66e63 5dff386fe5c9648b04d1623d3e1898c59332639e

# [28] exit=0 tree=b9f99622fc26dc64d8f9e14761f39c0cf87db3b3
git merge-tree --write-tree --name-only c8290db0c22bf5e84ceede2d58b6daad7ce2887b 5dff386fe5c9648b04d1623d3e1898c59332639e
```

### 4.3 条件预演（显式 `--merge-base`，仅用于浅历史缺 base 的组合）

> 以下是人为指定 base 的**条件预演历史记录**，不是本地祖先或内容包含证明；`--merge-base` 不是 git 自动找到的 merge base。尤其 C03/C04（以及 C11）将 base 设为输入一侧，该侧相对 base 无变更，得到另一侧 tree 不具有独立证明力；原命令、退出码与 tree 值保留，不作为内容包含旁证。

```text
# [C01] G3 x PRE, base=main -> exit=1 tree=32dce220e55969cbfd56a2680ee569ea0d725664  conflicts: CHANGELOG.md; admin-web/lib/store.mjs
git merge-tree --write-tree --name-only --merge-base=282a20fca9f64ab80ead50372c9c3e90bf4aeba7 5f1d7a409847bc78d860963f13b45358fac7b5d6 3bf595140088bc71a3939fb67880807965e9c566

# [C02] G4 x PRE, base=main -> exit=1 tree=088b5f7227b1f7dcdaab1bb85336fa2a3134e8bd  conflicts: CHANGELOG.md; admin-web/lib/store.mjs
git merge-tree --write-tree --name-only --merge-base=282a20fca9f64ab80ead50372c9c3e90bf4aeba7 49c5f790992424f2ee5ef4c5a3f0cdbf901623d4 3bf595140088bc71a3939fb67880807965e9c566

# [C03] G3 x G2, base=c8290db -> exit=0 tree=38675c39ea6652fca28106a80c49437e0257bede（= G3 tree）
git merge-tree --write-tree --name-only --merge-base=c8290db0c22bf5e84ceede2d58b6daad7ce2887b 5f1d7a409847bc78d860963f13b45358fac7b5d6 c8290db0c22bf5e84ceede2d58b6daad7ce2887b

# [C04] G4 x G2, base=c8290db -> exit=0 tree=c4e3fda3645ea48f63d9e34521e3186168251d92（= G4 tree）
git merge-tree --write-tree --name-only --merge-base=c8290db0c22bf5e84ceede2d58b6daad7ce2887b 49c5f790992424f2ee5ef4c5a3f0cdbf901623d4 c8290db0c22bf5e84ceede2d58b6daad7ce2887b

# [C05] G3 x 07B, base=1155b7b -> exit=0 tree=e1f036f8e3223d517ce6b954807fbc8a10904fd1
git merge-tree --write-tree --name-only --merge-base=1155b7ba65991d324fb8b22bb8f7dd87f49428f9 5f1d7a409847bc78d860963f13b45358fac7b5d6 1be517e48cadd810caa4f44df9e38e14c8b2c764

# [C06] G4 x 07B, base=1155b7b -> exit=0 tree=ae764a1c42af9b093b67c5ccab37bb55ac9602d0
git merge-tree --write-tree --name-only --merge-base=1155b7ba65991d324fb8b22bb8f7dd87f49428f9 49c5f790992424f2ee5ef4c5a3f0cdbf901623d4 1be517e48cadd810caa4f44df9e38e14c8b2c764

# [C07] G3 x G1, base=4f9c43d -> exit=0 tree=927ce5528e026d9c50d1d1e3aaafa5ec6af9715a
git merge-tree --write-tree --name-only --merge-base=4f9c43dfc313187b5fa971cb132dce29c294c286 5f1d7a409847bc78d860963f13b45358fac7b5d6 205440426183053bb8b31459a1945bd955f66e63

# [C08] G4 x G1, base=4f9c43d -> exit=0 tree=0e871b227c746e644080a847bf1a344fb465e055
git merge-tree --write-tree --name-only --merge-base=4f9c43dfc313187b5fa971cb132dce29c294c286 49c5f790992424f2ee5ef4c5a3f0cdbf901623d4 205440426183053bb8b31459a1945bd955f66e63

# [C09] G3 x C1, base=1155b7b -> exit=0 tree=e84e39a2496fc73bd894796b98db5edebad2571b
git merge-tree --write-tree --name-only --merge-base=1155b7ba65991d324fb8b22bb8f7dd87f49428f9 5f1d7a409847bc78d860963f13b45358fac7b5d6 5dff386fe5c9648b04d1623d3e1898c59332639e

# [C10] G4 x C1, base=1155b7b -> exit=0 tree=cc540f479256ae5e028b4ce1b49c16a578849778
git merge-tree --write-tree --name-only --merge-base=1155b7ba65991d324fb8b22bb8f7dd87f49428f9 49c5f790992424f2ee5ef4c5a3f0cdbf901623d4 5dff386fe5c9648b04d1623d3e1898c59332639e

# [C11] G4 x G3, base=5f1d7a4 -> exit=0 tree=c4e3fda3645ea48f63d9e34521e3186168251d92（= G4 tree）
git merge-tree --write-tree --name-only --merge-base=5f1d7a409847bc78d860963f13b45358fac7b5d6 49c5f790992424f2ee5ef4c5a3f0cdbf901623d4 5f1d7a409847bc78d860963f13b45358fac7b5d6
```

### 4.4 汇总

| 组合类 | 本地真实 merge-tree | 条件预演 | 冲突路径 |
|---|---|---|---|
| face × face（可判定） | 07B×G1、07B×G2、07B×C1、G1×G2、G1×C1、G2×C1、G3×G4 均 exit 0 | C03–C11 均 exit 0 | 无 |
| face × face（G3/G4 参与、浅） | 除 G3×G4 外均 exit 128（无 merge base） | 除 PRE 外均 exit 0 | 无 |
| 预签约 × 07B / G1 / G2 / C1 | exit 1 | — | `CHANGELOG.md`、`admin-web/lib/store.mjs` |
| 预签约 × G3 / G4 | exit 128（浅） | exit 1 | `CHANGELOG.md`、`admin-web/lib/store.mjs` |

> **只读预演不解决冲突**：以上只证明“能生成 / 不能生成合并树、冲突在哪”，不做任何冲突解决、不产生合并提交、不改变任何分支。

## 5. 冲突路径归并

| 路径 | 出现组合 | 说明 |
|---|---|---|
| `CHANGELOG.md` | 预签约 × 07B/G1/G2/C1（真实）；× G3/G4（条件） | 双方都在文件顶部追加条目 |
| `admin-web/lib/store.mjs` | 同上 | 双方都向 `collections` 数组同一位置追加集合名：face 底座新增约 35 行；预签约新增 5 个 `rental_*`；C1 另有 3 个 evidence 集合名。计数口径：base=`282a20f`（main），只计 `collections` 数组内新增集合名 **+37**（face 底座 32 个 + 预签约 5 个 `rental_*`）；“约 35 行”= face 侧 32 个集合名 + 3 条注释行；C1 的 3 个 evidence 集合名另计 |

- 除上述 2 条路径外，本轮所有可判定组合**未发现其它冲突路径**。
- `admin-web/server.mjs` 在预签约合并中为自动合并成功（不属于冲突路径）。
- 冲突根因是**同一 `collections` 数组与 `CHANGELOG` 顶部**的结构性重叠，不是行号漂移；换合并顺序不能自动消除，只能人工解决。

## 6. 与云参考对照

| 云参考条目（非 Windows、非本轮） | 本地可证 | 本地内容核对 | 本文判定 |
|---|---|---|---|
| G2 → G3 → G4 | 仅 G3→G4 本地 exit 0；G2→G3、G2→G4 因 shallow exit 1 | 本文没有独立的 G2 整体内容包含证明；C03/C04 仅为人为 base 下的条件结果，不作包含旁证 | 云参考仅作转述；该快照本地不可直接证 |
| G1 原 `4f9c43d` 在 G4 祖先链内 | 本地 exit 1（浅，不可判定） | G4 的 `h3b/h4b` 与 `4f9c43d` 相同；G4 的 G1 封闭测试与 `4f9c43d` 相同 | 仅已列文件对照一致；云参考单列，不由文件对照证明谱系 |
| G1 后补 `2054404` 不含于 G4 | 本地 exit 1（浅，不可判定） | G4 无 `tests/helpers/closure-guard.mjs`；G4 的封闭测试 = `4f9c43d` 版 | 仅已列文件对照一致；云参考单列，不由文件对照证明谱系 |
| 预签约与 6face 冲突 `CHANGELOG.md` + `store.mjs` | 07B/G1/G2/C1 真实复现；G3/G4 条件复现 | 冲突路径逐字一致 | 采信；G3/G4 条件结果单独标注 |

> “6face”按本轮 6 个 face 固定对象（07B、G1、G2、G3、G4、C1）逐对核对；本文不把该简称当作某个未知 SHA 或 ref。

## 7. 未验证 / 未知（不得填补）

1. **G3 / G4 的 shallow 前祖先未知**：该历史快照中 `5abfd74` 真实 parent 对象缺失，本地不能证明其父就是 `dcb36b8`；§3.4 既有变更路径对照也不能单独证明 tree 等价于 `dcb36b8` + E07 补丁。
2. **G2→G3→G4 谱系及整体内容包含**：该历史快照本地不可直接证；云参考只作转述，限定文件对照不证明整链，C03/C04 不作内容包含旁证。
3. **条件预演不证明实际谱系或包含**：`--merge-base` 为人工给定，结果只在该假设下成立；不能据此宣布“已合并 / 可合并 / 无冲突”或整体内容包含。
4. **未跑任何测试**：未安装依赖、未跑业务/单元/HTTP 测试、未跑 guard、未跑 verify；任何“通过”均不在本文范围。
5. **未接触真实环境**：HTTP/UI、Provider、设备、支付、生产云、部署上线均未触碰。
6. **未做逐行代码评审**：本文只做对象/谱系/路径级预演。
7. **云参考原文未取得**：`PARALLEL-DISPATCH.md` / `REVIEW.md` 本机不可达；本文只引用调度方转述，不声称逐字读取。
8. **未覆盖范围**：本图只覆盖 6 个 face 固定对象 + codex 预签约代码线，不含 staged S 线与 B 线合同文档（H4-c S0–S4、rental S1、租赁合同 v4、需求台账、OPS、REL-AI-03、07B 候选等新增线）。

## 8. 冻结与不自批

- 不合并、不 cherry-pick、不 rebase、不 reset、不 squash、不 force、不 amend。
- 不改全局/仓库 Git 配置、不关闭 TLS 校验、不改无关文件。
- 不实施、不安装、不跑业务测试、不启动 HTTP/UI、不接业务云/设备/支付、不部署上线。
- 本文件提交**不表示**任何分支已合并、任何门禁已闭合、任何功能可上线。
- **先停手交 Codex 独立复审；复审通过前不得据此执行合并或实施。**
- **Codex 复审仅确认文本准确性；合并 / 实施仍须单独授权**，本图不构成该授权。

## 9. 交付与复现

| 项 | 值 |
|---|---|
| run | `CROSS-BRANCH-MAP-2026-11-20T0656+0800` |
| 父提交 | `282a20fca9f64ab80ead50372c9c3e90bf4aeba7` |
| 本文件 | `docs/tasks/SMART-PM-CROSS-BRANCH-INTEGRATION-MAP-2026-11-19.md` |
| 最终提交 SHA | 由交付回报给出（提交后生成，文内不自指） |
| 固定 SHA 文件 URL | 由交付回报给出（`.../blob/<final-sha>/docs/tasks/SMART-PM-CROSS-BRANCH-INTEGRATION-MAP-2026-11-19.md`） |
| 推送 | 普通 `git push origin HEAD:refs/heads/docs/smart-pm-cross-branch-integration-map`；`ls-remote` 复核完整 SHA（**已发生的交付记录，非待执行指令**） |

复现顺序：先核 §1 对象与 §2 远端，再按 §4 的命令逐条执行；`git diff --check` / `git show --check` 应 exit 0；任何输入 SHA 前移即重跑，不沿用本文结论。

## 10. MAP-01 文档修订记录（2026-11-21）

- 修订基线：`820015a560023af781b422d01c8968c0563f2f43`；执行者：Codex 子智能体（文档修订执行，不是独立验收）。
- 更正摘要、§3.3、§4.3、§6、§7：C03/C04 将 base 人为设为输入一侧，得到另一侧 tree 不构成独立的内容包含或祖先证明；原历史命令、退出码与 tree 值保留。
- §3.4 的既有对照仅限所列文件/变更路径；不扩大为分支整体包含，也不以相同路径清单证明 tree 相等。
- 原调查仍是 2026-11-20T06:56+08:00 的 Windows 浅历史快照；本次执行环境的对象齐全程度不覆盖或改写当时记录。本次只修正文档推导，未重跑 `merge-tree`，未新增历史实测。
- G2/G3/G4 既有关闭结论不变，不重开、不重验；本修订未运行测试/guard/构建/安装，不涉及实现、实际合并或真实环境动作。
- 状态：**已按 MAP-01 修订，待独立复审；不自批，不构成实施/合并/发布授权。**
