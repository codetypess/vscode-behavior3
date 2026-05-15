import { editableEventTargetSharedTests } from "./shared-tests/editable-event-target-shared-tests";
import { editorStateSharedTests } from "./shared-tests/editor-state-shared-tests";
import { graphNodeMeasureSharedTests } from "./shared-tests/graph-node-measure-shared-tests";
import { hostProtocolSharedTests } from "./shared-tests/host-protocol-shared-tests";
import { hostRequestSpecSharedTests } from "./shared-tests/host-request-spec-shared-tests";
import { inspectorSharedTests } from "./shared-tests/inspector-shared-tests";
import { nodeDefinitionSlotUtilsSharedTests } from "./shared-tests/node-definition-slot-utils-shared-tests";
import { runtimeI18nSharedTests } from "./shared-tests/runtime-i18n-shared-tests";
import { sessionFileVersionSharedTests } from "./shared-tests/session-file-version-shared-tests";
import { validationMaterializationSharedTests } from "./shared-tests/validation-materialization-shared-tests";
import { documentDomainSharedTests } from "./shared-tests/document-domain-shared-tests";
import { editorControllerSharedTests } from "./shared-tests/editor-controller-shared-tests";
import { buildCliSharedTests } from "./shared-tests/build-cli-shared-tests";
import { registerSharedTestSuites } from "./shared-test-types";

const tests = registerSharedTestSuites(
    editableEventTargetSharedTests,
    graphNodeMeasureSharedTests,
    inspectorSharedTests,
    hostProtocolSharedTests,
    hostRequestSpecSharedTests,
    nodeDefinitionSlotUtilsSharedTests,
    runtimeI18nSharedTests,
    sessionFileVersionSharedTests,
    editorStateSharedTests,
    documentDomainSharedTests,
    validationMaterializationSharedTests,
    editorControllerSharedTests,
    buildCliSharedTests
);

async function main() {
    for (const test of tests) {
        await test.run();
        console.log(`ok - ${test.name}`);
    }

    console.log(`${tests.length} shared tests passed`);
}

main().catch((error) => {
    console.error(error);
    process.exit(1);
});
