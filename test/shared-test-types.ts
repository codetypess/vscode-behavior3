export type SharedTestCase = {
    name: string;
    run(): Promise<void> | void;
};

export const defineSharedTests = (tests: SharedTestCase[]): SharedTestCase[] => tests;

export const registerSharedTestSuites = (
    ...suites: ReadonlyArray<ReadonlyArray<SharedTestCase>>
): SharedTestCase[] => suites.flatMap((suite) => [...suite]);
