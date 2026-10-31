# Custom Field Script Hooks

Status: Verifying
Date: 2026-11-01
Scope: workspace custom fields / check scripts runtime / host save / condition creation

## 1. Context

`workspace-custom-fields.md` 让项目在 `.b3-workspace` 里声明自定义数据字段。条件字段可以用 `default: "$nodeId"` 取宿主节点 id，但值写入后就固定了。

原装饰器（提交 `b0467dc`）的优先级规则更多：

- `enterPriority` 永远等于宿主节点 id，保存时节点重新编号后跟着变。
- `maintainPriority` 等于旧进入优先级时跟着变；改小过的保留，并截断到 `0..enterPriority`。

这类规则是项目自己的约定，不同项目可能不同，写死在编辑器里或者用配置拼都不合适。仓库已经有让使用者写 TypeScript 钩子的机制（`checkScripts` 里的 `@behavior3.check` / `@behavior3.visible`），这里加一种新钩子，让使用者自己决定字段的值。

## 2. Goals

- `checkScripts` 模块可以用 `@behavior3.customField(name?)` 注册字段解析器。
- `customFields.condition` 里的字段可以写 `"script": "<name>"`，由这个解析器决定值。
- 编辑器在两个时机调用解析器：新建条件（以及条件缺少这个字段时），和主文档保存时节点 id 回写之后。
- 解析器拿得到字段当前值、这项条件的 `custom`（本轮之前和本轮已算出的）、宿主节点（新 id）、宿主节点的旧 id。
- 脚本出错或返回值不合法时，记录到输出面板，字段保持原值，不阻止保存。
- sample 里用钩子实现原装饰器的优先级规则。

## 3. Non-Goals

- 树字段（`customFields.tree`）用脚本：树没有宿主节点，先不支持。
- 写在主树 `overrides` 里的条件（加在 subtree 节点上的条件）：保存时拿不到稳定的宿主 id，先跳过。
- subtree 源文件里的条件：只在打开那个 subtree 文件并保存时处理。
- 条件文件直接写盘到未打开的宿主文件（`writeConditionFile` 的磁盘路径）：这条路径不做 id 回写，也不调用钩子；宿主文件下次在编辑器里保存时会补上。
- 编辑过程中实时调用：节点 id 只在保存时回写，解析器也只在保存时跑。保存前 Inspector 显示的是上次保存的值。
- batch 不调用这个钩子（batch 写回源文件，不重新编号）。

## 4. Proposed Behavior

### 4.1 配置

```jsonc
"condition": [
  { "key": "enterPriority", "type": "int", "script": "conditionPriority", "required": true, "editable": false },
  { "key": "maintainPriority", "type": "int", "script": "conditionPriority", "required": true }
]
```

- `script` 只用于 `condition` 组，值是注册名（`\w+`）。不能和 `default: "$nodeId"` 同时用；可以同时写普通的 `default`（脚本没注册时用它）和 `options`（脚本返回值也要在选项里）。
- `required: true` 时不再要求有 `default`：脚本负责给值。
- `editable` 只影响 Inspector；脚本写入不受它限制。
- 多个字段可以共用一个注册名，解析器用 `ctx.key` 区分。

### 4.2 钩子接口

```ts
// checkScripts 匹配到的模块里
import type { CustomFieldResolveContext } from "vscode-behavior3/build";

@behavior3.customField("conditionPriority")
export class ConditionPriority {
    resolve(ctx: CustomFieldResolveContext) {
        const id = Number(ctx.node.id) || 0;
        if (ctx.key === "enterPriority") {
            return id;
        }
        // maintainPriority：没改过（等于旧 enter）就跟着新 id，改过的截断到 0..enter
        const prevEnter = ctx.previous.enterPriority;
        const prevMaintain = ctx.previous.maintainPriority;
        const enter = ctx.custom.enterPriority as number;
        const tracking = prevMaintain === undefined || prevMaintain === prevEnter;
        const maintain = tracking ? enter : Number(prevMaintain);
        return Math.min(enter, Math.max(0, maintain));
    }
}
```

```ts
type CustomFieldResolveContext = {
    /** create：新建条件或条件缺少这个字段；save：主文档保存、节点 id 回写之后；build：构建重新编号、加前缀之后 */
    reason: "create" | "save" | "build";
    key: string;
    /** 字段当前值（本轮里前面的字段已经更新过 custom） */
    value: unknown;
    /** 这项条件的 custom，按声明顺序逐个字段更新 */
    custom: Readonly<Record<string, unknown>>;
    /** 本轮开始前这项条件的 custom */
    previous: Readonly<Record<string, unknown>>;
    /** 宿主节点，id 是回写后的新 id */
    node: Readonly<NodeData>;
    /** 重新编号前的 id（build 时是源文件里的 id）；create 时等于 node.id */
    previousNodeId: string;
    /** 第几项条件（编辑器目前只编辑第一项） */
    conditionIndex: number;
    tree: Readonly<TreeData>;
    treePath: string;
    env: BuildEnv;
};

interface CustomFieldResolver {
    /** 返回 undefined 表示保持当前值 */
    resolve(ctx: CustomFieldResolveContext): string | number | boolean | undefined;
}
```

- 同一项条件里，脚本字段按 `customFields.condition` 的声明顺序依次解析。前一个字段的结果会写进 `ctx.custom`，所以 `maintainPriority` 能用新的 `enterPriority`。
- 返回值必须符合字段的 `type` / `options`。不符合时记录错误，保持原值。
- 返回 `undefined` 保持原值；字段原来没有值时，用 `default`（有的话）。

### 4.3 调用时机

- **新建条件 / 缺字段**：宿主处理文档修改（`mutateDocument`）时，reducer 返回 `changed` 后，找出主树里缺少脚本字段的条件，用 `reason: "create"` 解析，再写进这次修改的结果。所以新建条件、或者给已有条件新加了脚本字段声明后的第一次修改，都会补上值。这一步是异步的，在 reducer 之后、写入文档之前。
- **构建**（编辑器里的构建命令和 CLI 都走 `buildBehaviorProject`）：构建会展开 subtree、顺序重新编号并给 id 加 `tree.prefix`，所以在 `createBuildDataWithContext` 里编号和加前缀之后，对展开后树里的每项条件（包括 subtree 实例和 overrides 带来的条件，每个实例各算一次）用 `reason: "build"` 解析，再交给 build script 的 `onProcessNode`。`previousNodeId` 是源文件里的 id（subtree 实例共用 uuid，按节点对象对应）。结果只写进导出产物，不改源文件。钩子缺失、报错或返回值不合法时记为这棵树的构建错误，构建失败，避免导出过期的值。
- **保存**：`buildMainDocumentSavePlan` 在 `applyMainTreeDisplayIds` 回写 id 之后，对主树里每个节点上的每项条件、每个脚本字段，用 `reason: "save"` 解析。`previousNodeId` 是回写前的 id。值有变化时写进保存内容；保存后文档内容和编辑器跟着更新（和现在 id 回写导致的内容变化走同一条路径）。
- 没有任何字段声明 `script` 时，不加载脚本，上面两步都跳过。

### 4.4 出错处理

- `script` 名字没注册：输出面板 warning（每个名字每轮一条）；字段已有值时保持原值，没有值时用 `default`（有的话）。
- 脚本抛异常、返回值类型不对：输出面板 error，带字段名和节点 id，字段保持原值。
- 脚本加载失败（语法错误等）：和 `checkScripts` 现在的处理一样记录错误，本次跳过所有脚本字段。
- 以上情况都不阻止保存。

## 5. Design

- `webview/shared/b3type.ts`：`CustomFieldDef.script?: string`。
- `webview/shared/custom-fields.ts`：解析 `script`（只允许 condition 组、名字格式、不能和 `$nodeId` 同用）；`required` 有 `script` 时不要求 `default`；`resolveCustomFieldDefault` 对脚本字段返回 `undefined`，所以 reducer 补必填、新建条件、Inspector 占位行都不处理脚本字段，交给脚本这一轮。
- 新文件 `webview/shared/custom-field-scripts.ts`：`resolveScriptCustomFields`（遍历主树内联条件、按声明顺序调用、校验返回值、回退 `default`、报告错误）、`treeNeedsScriptCustomFields`、`collectInlineNodeIds`。
- `webview/shared/b3build.ts` / `b3build-model.d.ts` / `build.d.ts`：`@behavior3.customField` 装饰器、marker、注册表，`CustomFieldResolveContext` / `CustomFieldResolver` 类型；`createCustomFieldResolverRuntimeWithCheckModules`（和 visible 的写法一样）。
- `src/editor-session/project/node-check-runtime.ts`：`SessionNodeCheckRuntimeResult` 加 `customFieldResolvers`。
- 新文件 `src/editor-session/session/custom-field-scripts.ts`：`runCustomFieldScripts`，没有脚本字段（或 `create` 时没有缺字段的条件）时不加载脚本；否则加载 `checkScripts` 运行时并调用 `resolveScriptCustomFields`，错误写到输出面板。
- `src/editor-session/session/document-mutations.ts`：reducer `changed` 之后调用 `reason: "create"`。
- `webview/domain/main-document-save.ts`：`preparePersistedTreeForMainDocumentSave` 加可选的异步参数 `afterApplyDisplayIds(tree, previousNodeId)`；`src/tree-editor-provider.ts` 的 `buildMainDocumentSavePlan` 传入调用 `reason: "save"` 的实现。
- `webview/features/inspector`：脚本字段在 Inspector 里和普通声明字段一样显示；提示里注明"由脚本计算"。
- `sample/scripts/checkers/condition_priority.ts`：原装饰器优先级规则的示例；sample workspace 改用 `script`。

## 6. Implementation Plan

1. 类型、配置解析、钩子注册和运行时。
2. 宿主：新建条件后的解析、保存时的解析、出错处理。
3. Inspector 提示、sample 脚本和配置、README。
4. 测试和基线 spec（16、17、13 里 `checkScripts` 的说明）。

## 7. Testing Plan

shared tests：

- 配置：`script` 只能在 condition 组；名字格式；`required` + `script` 不要求 `default`。
- 钩子注册：`@behavior3.customField(name)` 和默认类名；重名报错。
- 解析：按声明顺序，`ctx.custom` 带上前一个字段的结果；`previous`、`previousNodeId` 正确；返回 `undefined` 保持原值；类型不符时保持原值并报错；抛异常不影响其他字段。
- 保存：节点重新编号后，sample 规则下 enter 跟着变；maintain 没改过时跟着变、改小过的保留、超过 enter 时截断。
- 新建条件：`attachCondition` 后字段被解析写入。
- 构建：带 `prefix` 的树重新编号后，导出值按新 id 计算；同一个 subtree 展开两次，各实例的值不同；源文件不变；声明了 `script` 但没注册钩子时构建失败。
- 没声明脚本字段时不加载脚本。

## 8. Acceptance Criteria

- sample 项目里给节点加条件，`enterPriority` / `maintainPriority` 等于节点 id。
- 在它前面插入节点并保存，两个值都变成新 id；把 `maintainPriority` 改小后再重新编号保存，它保留原值；id 变小到低于它时被截断。
- 脚本抛异常时保存仍然成功，输出面板有错误。
- 构建产物里的优先级和导出的节点 id（去掉前缀）一致，包括展开的 subtree 实例。
- `npm run check`、`npm run test:shared`、`npm run build` 通过。

## 9. Risks and Rollback

- **保存依赖用户脚本**：脚本慢或死循环会拖慢保存。脚本和 `checkScripts` 一样在扩展宿主里同步执行，不做超时；在 README 里说明。
- **保存时内容变化**：保存会改写条件的 `custom`，和现在 id 回写一样，保存后文档会刷新一次。
- **`$nodeId` 和 `script` 并存**：`$nodeId` 保留给不想写脚本的简单场景。
- **回滚**：去掉 `script` 配置即可，字段退回普通声明字段。
