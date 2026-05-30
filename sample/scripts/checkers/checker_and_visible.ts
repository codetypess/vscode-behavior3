import type { NodeFieldCheckContext } from "vscode-behavior3/build";

@behavior3.check("positive")
export class PositiveChecker {
    validate(value: unknown, ctx: NodeFieldCheckContext) {
        if (value === undefined || value === null || value === "") {
            return;
        }
        if (typeof value !== "number") {
            return `${ctx.fieldName} must be a number`;
        }
        if (value <= 0) {
            return `${ctx.fieldName} must be greater than 0`;
        }
    }
}

@behavior3.check("test_args_health_checker")
export class HealthChecker {
    validate(value: unknown, ctx: NodeFieldCheckContext) {
        if (value === undefined || value === null || value === "") {
            return;
        }
        if (typeof value !== "number") {
            return `${ctx.fieldName} must be a number`;
        }
        if (value <= 0) {
            return `${ctx.fieldName} must be greater than 0`;
        }
    }
}



@behavior3.visible("test_args_health_visible")
export class CheckHealthVisible {
    visible(value: unknown, ctx: NodeFieldCheckContext) {
       return !!ctx.node.args?.type && Number(ctx.node.args.type) < 3;
    }
}

@behavior3.check("test_input_checker")
export class TestInputChecker {
    validate(value: unknown, ctx: NodeFieldCheckContext) {
        return String(value).startsWith("tar") ? undefined : `${ctx.fieldName} must name start with "tar"`;
    }
}


@behavior3.visible("test_input_visible")
export class VisibleChecker {
    visible(value: unknown, ctx: NodeFieldCheckContext) {
        return !!ctx.node.args?.type
    }
}