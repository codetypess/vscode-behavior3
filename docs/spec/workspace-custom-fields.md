# Workspace Custom Fields

Status: Verifying
Date: 2026-11-01
Scope: workspace settings / tree custom / condition custom / inspector

## 1. Context

`node-conditions.md` 落地后，自定义数据里有两类字段由编辑器特殊对待：

- 树的 `custom.$condition_type`：键名、取值 `local` / `global`、缺省值 `local` 都写死在 `webview/shared/condition-branch.ts`。树用到条件时，解析（`normalizeTreeData`）和每次修改（`reduceDocumentMutation`）都会补上它；Inspector 里这一行键名锁定、不可删、值是下拉框。
- 条件项的 `custom.enterPriority` / `maintainPriority`：原装饰器的约定字段，现在编辑器完全不认识，新建条件时不会带上，Inspector 里只是普通的 key/value 行。

这些都是使用方项目的约定，behavior3 运行时不读 `custom`。把项目约定写死在通用编辑器里，其他项目没法改名、加字段或去掉它们。

## 2. Goals

- 在 `.b3-workspace` 的 `settings.customFields` 里声明自定义数据字段，分 `tree`（树的 `custom`）和 `condition`（条件项的 `custom`）两组。
- 每个字段可以配置：类型、枚举选项、默认值、是否必填（自动补上且不可删除）、值是否可编辑、说明；树字段还可以限定「只在树用到条件时」生效。
- Inspector 按声明渲染：键名锁定，值按类型/枚举用对应控件，不可编辑时禁用，必填时隐藏删除按钮。
- 新建条件时按 `condition` 组写入默认值。
- 去掉 `$condition_type` 的硬编码，改成 sample workspace 里的一条配置。

## 3. Non-Goals

- 不给节点的 `args` 引入这套配置（节点参数已经由 `.b3-setting` 描述）。
- 不支持对象、数组类型的值（自定义数据本来就只支持 `string` / `number` / `boolean`）。
- 不在构建 / CLI 导出时补默认值；导出仍是文件里的原样内容。
- 不做按节点类型、按树路径区分的字段配置。

## 4. Current Behavior

- `CONDITION_TYPE_CUSTOM_KEY` / `CONDITION_TYPE_VALUES` / `DEFAULT_CONDITION_TYPE` 是常量。
- `normalizeTreeData` 调用 `ensureConditionTypeCustom`，所以打开、构建、读 subtree 时只要树里有条件，内存里的 `custom` 就会多出 `$condition_type`。
- `reduceUpdateTreeMeta` 提交时把缺失或无法识别的 `$condition_type` 写成原值或 `local`。
- `attachCondition` 新建的条件没有 `custom`。
- `CustomDataSection` 支持 `reservedKeys`，目前只有树 Inspector 传了 `$condition_type` 一项；条件 Inspector 没有传。

## 5. Proposed Behavior

### 5.1 配置格式

```jsonc
// sample/workspace.b3-workspace
{
  "settings": {
    "customFields": {
      "tree": [
        {
          "key": "$condition_type",
          "desc": "条件作用域",
          "type": "string",
          "options": [
            { "name": "本地", "value": "local" },
            { "name": "全局", "value": "global" }
          ],
          "default": "local",
          "required": true,
          "when": "hasConditions"
        }
      ],
      "condition": [
        { "key": "enterPriority", "type": "int", "default": "$nodeId", "required": true, "editable": false },
        { "key": "maintainPriority", "type": "int", "default": "$nodeId", "required": true }
      ]
    }
  }
}
```

字段说明：

| 字段       | 类型                                     | 缺省       | 含义                                                                                            |
| ---------- | ---------------------------------------- | ---------- | ----------------------------------------------------------------------------------------------- |
| `key`      | string                                   | 必填       | 自定义数据的键，同一组内不能重复                                                                |
| `desc`     | string                                   | —          | Inspector 里的提示文字                                                                          |
| `type`     | `"string"` / `"int"` / `"float"` / `"bool"` | 由 `default` 推断，否则 `string` | 值类型，和 `.b3-setting` 节点参数的类型名一致                       |
| `options`  | `{ name, value }[]`                      | —          | 有值时是枚举，Inspector 用下拉框；`value` 必须符合 `type`                                       |
| `default`  | string / number / boolean                | —          | 默认值，必须符合 `type`，有 `options` 时必须是其中一项。条件字段可以写 `"$nodeId"`，见下文      |
| `required` | boolean                                  | `false`    | `true`：字段生效时自动补上默认值，Inspector 里不能删除。`true` 时必须给 `default`               |
| `editable` | boolean                                  | `true`     | `false`：Inspector 里值只读                                                                     |
| `when`     | `"always"` / `"hasConditions"`           | `"always"` | 只用于 `tree` 组。`hasConditions`：只在树用到条件时生效，不生效时这一行就是普通自定义数据       |

- `default: "$nodeId"`：只用于 `condition` 组，类型必须是 `int` 或 `float`（不写 `type` 时按 `int`），不能有 `options`。写入时取宿主节点的 id 转成数字（id 不是整数时为 0）。值写入后固定，节点之后重新编号不会跟着改，也不做大小范围检查。这对应原装饰器的「进入优先级等于宿主节点 id」和「维持优先级默认等于进入优先级」。
- 解析 `.b3-workspace` 时校验上面的约束，不合法时整个 `customFields` 报错并忽略（输出到 Output 面板），不影响其他 settings。
- 没有配置 `customFields` 时，编辑器不再对任何自定义数据键做特殊处理，包括 `$condition_type`。

### 5.2 写入规则（宿主 reducer）

- **补必填字段**：每次修改成功后（现在调用 `ensureConditionTypeCustom` 的位置），对 `tree` 组里生效且 `required` 的字段，缺失时写入 `default`。对每个条件项的 `custom`，同样补 `condition` 组里 `required` 的字段。
- **去掉条件后**：树不再用到条件时，`when: hasConditions` 的字段保留在文件里，不自动删除，只是变回普通自定义数据，可以手动删改。再加上条件时沿用已有的值，缺失才补默认值。
- **新建条件**：`attachCondition` 写入 `condition` 组里所有带 `default` 的字段（不只是必填的），没有任何字段时不写 `custom`。`$nodeId` 取目标节点的 display id。
- **`$nodeId` 的宿主 id**：补必填字段时用宿主节点在文件里的 `id`；条件 Inspector 提交用选中节点的 display id；条件文件写回用宿主节点的 `id`。写在 overrides 里的条件没有节点 id，补必填字段时跳过 `$nodeId` 字段（这些条件在新建时已经写入）；条件文件自己的树 Inspector 也不显示这类占位行。
- **提交自定义数据**（`updateTreeMeta`、条件 Inspector 提交、条件文件 `setConditionRoot`）：必填字段被删掉时恢复成原值，原值也没有时用 `default`。
- **不可编辑字段**：提交时如果值和原值不同，保留原值。
- **非法值**（类型不符、不在 `options` 里）：不静默改写。Inspector 在这一行显示错误并拒绝提交这一行；文件里已有的非法值原样保留。这和现在「无法识别的 `$condition_type` 写成 `local`」不同，见第 9 节。
- **解析不再注入**：`normalizeTreeData` 去掉 `ensureConditionTypeCustom`，解析只负责格式。构建、CLI、subtree 读取看到的就是文件内容。

### 5.3 Inspector

- 树 Inspector 用 `tree` 组（生效的字段），条件 Inspector 和条件文件里的树 Inspector 用 `condition` 组。
- 声明过的字段：键名锁定；值按 `options` → 下拉框，`bool` → 开关，`int` / `float` → 数字输入，其他 → 文本框；`editable: false` 时禁用；`required` 时不显示删除按钮；有 `desc` 时显示在提示里。
- 文件里缺失的必填字段显示为一行，值是 `default`，用淡色标出「未写入」，任意一次提交后写入文件。这样打开文件不会因为补字段变成未保存。
- 「添加条目」时，如果键名和声明的字段一致，这一行自动切换成该字段的控件。

### 5.4 配置下发

和 `nodeColors` 走同一条路径：`parseWorkspaceModelContent` → `resolveWorkspaceFileSettings` → `EditorLiveSettings` → `init` / `settingLoaded` → `Settings.customFields` → workspace store。宿主 reducer 的 context 里也带上 `customFields`。`.b3-workspace` 已经被监视，修改后实时生效。

## 6. Design

### 6.1 类型

```ts
// webview/shared/b3type.ts
type CustomFieldValue = string | number | boolean;

interface CustomFieldDef {
    key: string;
    desc?: string;
    type: "string" | "int" | "float" | "bool";
    options?: { name: string; value: CustomFieldValue }[];
    default?: CustomFieldValue;
    required: boolean;
    editable: boolean;
    when: "always" | "hasConditions";
}

interface CustomFieldDefs {
    tree: CustomFieldDef[];
    condition: CustomFieldDef[];
}

interface WorkspaceModel {
    settings: {
        // ...
        customFields?: CustomFieldDefs;
    };
}
```

`Settings`（contracts.ts）、`EditorLiveSettings`、`init` / `settingLoaded` 消息加 `customFields?: CustomFieldDefs`。

### 6.2 模块

- `webview/shared/custom-fields.ts`（新）：`normalizeCustomFieldDefs`（解析校验）、`activeTreeCustomFields(tree, defs)`、`ensureRequiredCustomFields(tree, defs)`（树和所有条件项）、`createConditionCustom(defs)`、`mergeCustomCommit(prev, next, fields)`（必填恢复、只读保留）、`validateCustomFieldValue(def, raw)`。
- `webview/shared/condition-branch.ts`：删掉 `$condition_type` 相关常量和 `ensureConditionTypeCustom`、`readConditionType`；`treeUsesConditions` 保留（`when: hasConditions` 用）；`createConditionData` 接收可选的 `custom`。
- `webview/shared/schema.ts`：`normalizeWorkspaceModel` 解析 `customFields`；`normalizeTreeData` 去掉注入。
- `webview/shared/document.ts`：`DocumentMutationReducerContext` 加 `customFields?: CustomFieldDefs`；`reduceDocumentMutation`、`reduceUpdateTreeMeta`、`attachCondition`、`setConditionRoot`、条件 custom 提交改用 `custom-fields.ts`。
- `src/editor-session/session/document-mutations.ts`、`src/tree-editor-provider.ts`：调用 reducer 时传入当前 live settings 里的 `customFields`。
- `webview/features/inspector/custom-data-section.tsx`：`reservedKeys` 改成接收 `CustomFieldDef[]`，在组件内部根据类型选择控件；缺失的必填字段作为占位行渲染。
- `tree-inspector-form.tsx` / `condition-inspector-form.tsx`：传入对应组的字段。
- 条件文件：`createLiveSettingsResolver` 对条件文件 session 用 `scopeCustomFieldDefsForConditionFile` 把 `tree` 组换成 `condition` 组后再下发，webview 和 reducer 不用区分条件文件。没打开的宿主文件由 `writeConditionFile` 直接写盘，它读宿主所在项目的 `customFields`。

## 7. Implementation Plan

1. 类型、`custom-fields.ts`、workspace 解析和配置下发。
   Exit: webview store 和宿主 reducer 都能拿到 `customFields`。
2. reducer 规则替换 `$condition_type` 硬编码，解析不再注入。
   Exit: 第 8 节的 shared tests 通过。
3. Inspector 控件、占位行、条件 Inspector 接入。
4. sample workspace 加配置；同步基线 spec（01、02、11、16、17）和 `node-conditions.md`。

## 8. Testing Plan

shared tests：

- `customFields` 解析：合法配置；重复 key、`default` 类型不符、`default` 不在 `options`、`required` 无 `default`、`condition` 组用了 `when` 都报错。
- 必填补齐：`when: hasConditions` 的树字段在加上第一个条件后写入，去掉所有条件后保留但不再强制；`always` 字段任意修改后写入；条件项的必填字段被补上。
- `attachCondition`（内联和 subtree override 两种）写入 `condition` 组默认值；没有配置时不写 `custom`。
- `updateTreeMeta` / 条件 custom 提交删掉必填字段时恢复，改了只读字段时保留原值。
- 非法值不被改写。
- 没有 `customFields` 时：不补任何字段，`$condition_type` 不再出现（替换现有的 `defaults $condition_type` 用例）。
- `parseTreeContent` 不再修改 `custom`。

## 9. Acceptance Criteria

- sample workspace 配置后，`hero.json` 里的 `$condition_type` 行为和现在一致：加条件后出现、默认 `local`、下拉选择、不可删除。
- 新建条件的自定义数据带上 `enterPriority` 和 `maintainPriority`，值都等于宿主节点 id；`enterPriority` 只读，`maintainPriority` 可以改，两项都不能删。
- 修改 `.b3-workspace` 后不重开编辑器即可生效。
- 删掉 `customFields` 后，编辑器不再特殊对待任何键。
- `npm run check`、`npm run test:shared`、`npm run build` 通过。

## 10. Risks and Rollback

- **行为变化**：非法值不再被改写成默认值；解析不再注入 `$condition_type`，所以没有配置的项目，构建产物里也不会再出现它。条件功能还没发布，可以接受。
- **占位行**：缺失的必填字段只在下一次修改时写入。只打开、构建而不编辑的文件，导出结果里不会有这个字段。需要导出时一定带上的话，由 build script 处理。
- **回滚**：恢复 `condition-branch.ts` 里的常量和解析时的注入即可，配置字段会被忽略。

## 11. Decisions

- `when` 只支持 `always` / `hasConditions`。
- 缺失的必填字段在 Inspector 里显示为占位行，下一次修改时写入，打开文件不会变成未保存。
- 去掉所有条件后不自动清理 `when: hasConditions` 的字段。
