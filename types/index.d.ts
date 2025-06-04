import { Logger } from "@caporal/core";

export type PackageJson = {
    name: string;
    version: string;
    description?: string;
    main?: string,
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
    useHashInVersion: boolean;
    useTagInVersion: boolean;
    dryRun: boolean;
    webhookUrl: string | null | undefined;
    overrideName: string | null | undefined;
    overrideVersion: string | null | undefined;
}