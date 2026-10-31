import type { CustomFieldResolveContext } from "vscode-behavior3/build";

/** Build ids carry the tree prefix (`hero_5`); editor ids do not. */
const toPriority = (id: string, prefix: string) => {
    const value = Number(prefix && id.startsWith(prefix) ? id.slice(prefix.length) : id);
    return Number.isSafeInteger(value) ? value : 0;
};

/**
 * Priorities of a node condition, following the old node decorator rules.
 * Runs on create, on save and on build, each time after node ids are renumbered:
 * - enterPriority always equals the host node id.
 * - maintainPriority follows the id while it still equals the old enterPriority;
 *   a lowered value stays, clamped to 0..enterPriority.
 */
@behavior3.customField("conditionPriority")
export class ConditionPriority {
    resolve(ctx: CustomFieldResolveContext) {
        const enter = toPriority(ctx.node.id, ctx.tree.prefix);
        if (ctx.key === "enterPriority") {
            return enter;
        }
        if (ctx.key !== "maintainPriority") {
            return undefined;
        }
        const previousMaintain = ctx.previous.maintainPriority;
        const tracking =
            typeof previousMaintain !== "number" || previousMaintain === ctx.previous.enterPriority;
        const maintain = tracking ? enter : previousMaintain;
        return Math.min(enter, Math.max(0, Math.trunc(maintain)));
    }
}
