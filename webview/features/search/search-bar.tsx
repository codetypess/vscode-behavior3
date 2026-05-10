import { ArrowDownOutlined, ArrowUpOutlined, CloseOutlined } from "@ant-design/icons";
import { Button, Flex, Input, type InputRef } from "antd";
import React, { useEffect, useRef } from "react";
import { useTranslation } from "react-i18next";
import { RiFocus3Line } from "react-icons/ri";
import { VscCaseSensitive } from "react-icons/vsc";
import { Hotkey } from "../../shared/keys";
import { mergeClassNames } from "../../shared/util";
import { useGraphUiStore, useRuntime } from "../../app/runtime";
import { patchGraphUiSearchState, resetGraphUiSearchState } from "../../stores/graph-ui-store";

interface SearchBarProps {
    focusToken: number;
    onClose?: () => void;
}

export const SearchBar: React.FC<SearchBarProps> = ({ focusToken, onClose }) => {
    const runtime = useRuntime();
    const { t } = useTranslation();
    const search = useGraphUiStore((state) => state.search);
    const searchInputRef = useRef<InputRef | null>(null);

    useEffect(() => {
        if (!search.open) {
            return;
        }

        const frame = requestAnimationFrame(() => {
            searchInputRef.current?.focus();
        });
        return () => cancelAnimationFrame(frame);
    }, [focusToken, search.mode, search.open]);

    if (!search.open) {
        return null;
    }

    const reapplySearch = () => {
        void runtime.controller.updateSearch(search.query);
    };

    const handleClose = () => {
        resetGraphUiSearchState(runtime.graphUiStore);
        void runtime.controller.updateSearch("");
        onClose?.();
    };

    const handleInputKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
        if (event.code === Hotkey.Enter) {
            event.preventDefault();
            void runtime.controller.nextSearchResult();
        } else if ((event.ctrlKey || event.metaKey) && event.code === "KeyF") {
            event.preventDefault();
            void runtime.controller.openSearch("content");
        } else if ((event.ctrlKey || event.metaKey) && event.code === "KeyG") {
            event.preventDefault();
            void runtime.controller.openSearch("id");
        }
        event.stopPropagation();
    };

    return (
        <Flex className="b3-search-overlay">
            <Flex className="b3-search-box">
                <Input
                    key={search.mode}
                    ref={searchInputRef}
                    size="small"
                    className="b3-search-input"
                    value={search.query}
                    placeholder={search.mode === "id" ? t("jumpNode") : t("searchNode")}
                    onChange={(event) => {
                        void runtime.controller.updateSearch(event.target.value);
                    }}
                    onKeyDownCapture={handleInputKeyDown}
                    suffix={
                        <Flex gap={2} className="b3-search-suffix">
                            {search.mode !== "id" ? (
                                <Button
                                    type="text"
                                    size="small"
                                    className={mergeClassNames(
                                        "b3-search-filter",
                                        search.caseSensitive && "b3-search-filter-selected"
                                    )}
                                    icon={
                                        <VscCaseSensitive
                                            style={{ width: "18px", height: "18px" }}
                                        />
                                    }
                                    onClick={() => {
                                        patchGraphUiSearchState(runtime.graphUiStore, {
                                            caseSensitive: !search.caseSensitive,
                                        });
                                        reapplySearch();
                                    }}
                                />
                            ) : null}
                            <Button
                                type="text"
                                size="small"
                                className={mergeClassNames(
                                    "b3-search-filter",
                                    search.focusOnly && "b3-search-filter-selected"
                                )}
                                icon={<RiFocus3Line />}
                                onClick={() => {
                                    patchGraphUiSearchState(runtime.graphUiStore, {
                                        focusOnly: !search.focusOnly,
                                    });
                                    reapplySearch();
                                }}
                            />
                        </Flex>
                    }
                />
                <div className="b3-search-counter">
                    {search.results.length > 0
                        ? `${search.index + 1}/${search.results.length}`
                        : ""}
                </div>
                {search.mode !== "id" ? (
                    <Button
                        icon={<ArrowDownOutlined />}
                        type="text"
                        size="small"
                        style={{ width: "30px" }}
                        disabled={search.results.length === 0}
                        onClick={() => void runtime.controller.nextSearchResult()}
                    />
                ) : null}
                {search.mode !== "id" ? (
                    <Button
                        icon={<ArrowUpOutlined />}
                        type="text"
                        size="small"
                        style={{ width: "30px" }}
                        disabled={search.results.length === 0}
                        onClick={() => void runtime.controller.prevSearchResult()}
                    />
                ) : null}
                <Button
                    icon={<CloseOutlined />}
                    type="text"
                    size="small"
                    style={{ width: "30px" }}
                    onClick={handleClose}
                />
            </Flex>
        </Flex>
    );
};
