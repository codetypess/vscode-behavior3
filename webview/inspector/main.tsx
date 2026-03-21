import { App, ConfigProvider } from "antd";
import React, { useEffect, useState } from "react";
import ReactDOM from "react-dom/client";
import { setGlobalHooks } from "@shared/misc/hooks";
import "@shared/misc/i18n";
import { getThemeConfig } from "@shared/misc/theme";
import { Inspector } from "./components/inspector";
import * as vscodeApi from "./vscodeApi";
import "./style.scss";

const GlobalHooksBridge = () => {
  setGlobalHooks();
  return null;
};

type InspectorState =
  | { kind: "empty" }
  | { kind: "node"; node: unknown; nodeDefs: unknown[]; editingTree: unknown; workdir: string; checkExpr: boolean }
  | { kind: "tree"; tree: unknown; nodeDefs: unknown[]; workdir: string; checkExpr: boolean };

const InspectorApp = () => {
  const [theme, setTheme] = useState<"dark" | "light">("dark");
  const [state, setState] = useState<InspectorState>({ kind: "empty" });

  useEffect(() => {
    const off = vscodeApi.onMessage((msg) => {
      if (msg.type === "nodeSelected") {
        setState({
          kind: "node",
          node: msg.node,
          nodeDefs: msg.nodeDefs,
          editingTree: msg.editingTree,
          workdir: msg.workdir,
          checkExpr: msg.checkExpr,
        });
      } else if (msg.type === "treeSelected") {
        setState({
          kind: "tree",
          tree: msg.tree,
          nodeDefs: msg.nodeDefs,
          workdir: msg.workdir,
          checkExpr: msg.checkExpr,
        });
      } else if (msg.type === "theme") {
        setTheme(msg.value);
      }
    });

    vscodeApi.postMessage({ type: "ready" });

    return off;
  }, []);

  const themeConfig = getThemeConfig(theme);

  return (
    <ConfigProvider theme={themeConfig}>
      <App>
        <GlobalHooksBridge />
        <Inspector state={state} />
      </App>
    </ConfigProvider>
  );
};

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <InspectorApp />
  </React.StrictMode>
);
