// **REVIEW_9 D-LOW-3 / D-claude L1**: 抽到项目根 `src/format-bytes.ts` 中立位置避免与
// cli-shared.ts:237 重复。本文件保留作 caller import 路径兼容(client/components/profile/
// 几个 modal 仍 `import {formatBytes} from "../../format-bytes.ts"`)。
export { formatBytes } from "../format-bytes.ts";
