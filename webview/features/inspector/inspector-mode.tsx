import React, { createContext, useContext } from "react";

interface InspectorModeValue {
    readOnly: boolean;
}

const InspectorModeContext = createContext<InspectorModeValue>({
    readOnly: false,
});

export const InspectorModeProvider: React.FC<
    React.PropsWithChildren<Partial<InspectorModeValue>>
> = ({ children, readOnly = false }) => {
    return (
        <InspectorModeContext.Provider value={{ readOnly }}>
            {children}
        </InspectorModeContext.Provider>
    );
};

export const useInspectorMode = (): InspectorModeValue => useContext(InspectorModeContext);
