import { Logger } from "@caporal/core";

export type PackageJson = {
    name: string;
    version: string;
    description?: string;
    main?: string,
    dependencies?: Record<string, string>;
    devDependencies?: Record<string, string>;
    peerDependencies?: Record<string, string>;
    optionalDependencies?: Record<string, string>;
}

export type UnityPackageJson = Pick<PackageJson, "name" | "version" | "description">;

export type Npmdef = {
    packageName: string;
    packageVersion: string;
}


export type PublishOptions = {
    logger: Logger;
    packageDirectory: string;
    registry: string;
    accessToken: string | null | undefined;
    tag: string | null | undefined;
    setLatestTag: boolean | undefined;
    useHashInVersion: boolean;
    useTagInVersion: boolean;
    createGitTag: boolean;
    createGitTagPrefix: string | null | undefined;
    dryRun: boolean;
    webhookUrl: string | null | undefined;
    overrideName: string | null | undefined;
    overrideVersion: string | null | undefined;
    llm?: {
        apiKey: string | null | undefined;
    }
}


export type RepositoryDispatchOptions = {
    logger: Logger;
    accessToken: string;
    repository: string;
    ref?: string;
    workflow: string;
    inputs?: Record<string, any>;
    webhookUrl?: string | null | undefined;
}