import { App } from "antd";
import React, { useEffect, useRef } from "react";
import { useRuntime } from "../../app/runtime";

export const GraphPane: React.FC = () => {
  const runtime = useRuntime();
  const { message } = App.useApp();
  const adapter = runtime.graphAdapter;
  const mountRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const container = mountRef.current;
    if (!container) {
      return;
    }

    void adapter.mount(container, {
      onCanvasSelected: () => void runtime.controller.selectTree(),
      onNodeSelected: (node, opts) =>
        void runtime.controller.selectNode(node.instanceKey, { force: opts?.force }),
      onNodeDoubleClicked: () => void runtime.controller.openSelectedSubtree(),
      onVariableHotspotClicked: (_node, payload) =>
        void runtime.controller.focusVariable(payload.variableNames),
      onDropCommitted: async (intent) => {
        try {
          await runtime.controller.performDrop(intent);
        } catch (error) {
          message.error(error instanceof Error ? error.message : String(error));
        }
      },
    });

    return () => adapter.unmount();
  }, [adapter, message, runtime.controller]);

  return <div ref={mountRef} className="b3-v2-graph" />;
};
