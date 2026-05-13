import React, { createContext, useContext, useState } from "react";

interface InspectorJsonViewValue {
    nodeJsonVisible: boolean;
    toggleNodeJsonVisible(): void;
}

const InspectorJsonViewContext = createContext<InspectorJsonViewValue>({
    nodeJsonVisible: false,
    toggleNodeJsonVisible: () => undefined,
});

export const InspectorJsonViewProvider: React.FC<React.PropsWithChildren> = ({ children }) => {
    const [nodeJsonVisible, setNodeJsonVisible] = useState(false);

    return (
        <InspectorJsonViewContext.Provider
            value={{
                nodeJsonVisible,
                toggleNodeJsonVisible: () =>
                    setNodeJsonVisible((currentVisible) => !currentVisible),
            }}
        >
            {children}
        </InspectorJsonViewContext.Provider>
    );
};

export const useInspectorJsonView = (): InspectorJsonViewValue =>
    useContext(InspectorJsonViewContext);
