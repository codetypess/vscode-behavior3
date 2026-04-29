import { ArrowDownOutlined, ArrowUpOutlined, CloseOutlined, SearchOutlined } from "@ant-design/icons";
import { Button, Flex, Input, Segmented, Switch, Typography } from "antd";
import React from "react";
import { useRuntime, useSelectionStore } from "../../app/runtime";

export const SearchBar: React.FC = () => {
  const runtime = useRuntime();
  const search = useSelectionStore((state) => state.search);

  if (!search.open) {
    return null;
  }

  return (
    <Flex className="b3-v2-search" gap={8} align="center">
      <Segmented
        size="small"
        value={search.mode}
        options={[
          { label: "Content", value: "content" },
          { label: "Id", value: "id" },
        ]}
        onChange={(value) => {
          void runtime.controller.openSearch(value as "content" | "id");
        }}
      />
      <Input
        allowClear
        size="small"
        prefix={<SearchOutlined />}
        value={search.query}
        placeholder={search.mode === "id" ? "Jump by node id" : "Search nodes"}
        onChange={(event) => {
          void runtime.controller.updateSearch(event.target.value);
        }}
      />
      <Typography.Text type="secondary">
        {search.results.length === 0 ? "0" : `${search.index + 1}/${search.results.length}`}
      </Typography.Text>
      <Button
        size="small"
        icon={<ArrowUpOutlined />}
        onClick={() => void runtime.controller.prevSearchResult()}
      />
      <Button
        size="small"
        icon={<ArrowDownOutlined />}
        onClick={() => void runtime.controller.nextSearchResult()}
      />
      <Flex align="center" gap={4}>
        <Typography.Text type="secondary">Focus</Typography.Text>
        <Switch
          size="small"
          checked={search.focusOnly}
          onChange={(checked) => {
            runtime.selectionStore.setState((state) => ({
              ...state,
              search: {
                ...state.search,
                focusOnly: checked,
              },
            }));
            void runtime.controller.updateSearch(search.query);
          }}
        />
      </Flex>
      <Button
        size="small"
        icon={<CloseOutlined />}
        onClick={() => {
          runtime.selectionStore.setState((state) => ({
            ...state,
            search: {
              ...state.search,
              open: false,
              query: "",
              results: [],
              index: 0,
            },
          }));
          void runtime.controller.updateSearch("");
        }}
      />
    </Flex>
  );
};
