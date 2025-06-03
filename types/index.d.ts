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
    tag: string | null | undefined;
}