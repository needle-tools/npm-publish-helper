import { transform } from 'esbuild';
import * as fs from 'fs';
import path from 'path';

// dont import vite here because it requires the user to have vite installed

/** 
 * @type {import('vite').UserConfig}
*/
/** @ts-ignore (because of esm format + rollupOptions plugins ) */
export default {
    base: "./",
    assetsInclude: ['**/*.wasm', '**/*.data.txt'], // Ensure these are treated as assets
    plugins: [
        viteHandleWasmFiles(),
    ],
    build: {
        lib: {
            entry: "<entry>",
            name: "<name>",
            formats: [
                'es',
                'esm',
                'cjs'
            ],
            fileName: (format) => ({
                es: `<name>.js`,
                esm: `<name>.min.js`,
                cjs: `<name>.umd.cjs`,
            }[format])
        },
        // sourcemap: true,
        // assetsInlineLimit: 0,//(file) => {
        // //     if (file.includes('.wasm')) return false;
        // //     return 4096; // Default limit for other assets
        // // },
        rollupOptions: {
            output: {
                /** Don't minify dependency names (e.g. export three.Mesh as Mesh and not as $) */
                minifyInternalExports: false,

                plugins: [
                    minifyEs(),
                ],
                manualChunks: _ => "<name>",
                inlineDynamicImports: false,
                // https://rollupjs.org/configuration-options/#output-globals
                globals: {
                    "three": "THREE",
                    "@needle-tools/engine": "NEEDLE",
                },
                // Preserve asset file names
                assetFileNames: '[name][extname]',
            },
            external: [
                "@needle-tools/engine",
                "three",
                "three/examples/jsm/loaders/GLTFLoader.js",
                "three/examples/jsm/libs/meshopt_decoder.module.js",
                "three/examples/jsm/loaders/DRACOLoader.js",
                "three/examples/jsm/loaders/KTX2Loader.js",
            ],
        },
    },
}



// https://github.com/vitejs/vite/issues/6555
function minifyEs() {
    return {
        name: 'minifyEs',
        renderChunk: {
            order: 'post',
            async handler(code, chunk, outputOptions) {
                if (outputOptions.format === 'es' && chunk.fileName.endsWith('.min.js')) {
                    return await transform(code, { minify: true });
                }
                return code;
            },
        }
    };
}



/** @returns {import("vite").Plugin} */
function viteHandleWasmFiles() {
    return {
        name: 'debug-wasm',
        enforce: 'pre', // Run before other plugins
        resolveId(id, importer) {
            if (id.endsWith('.wasm?url') || id.endsWith('.data.txt?url')) {
                console.log('Resolving WASM/data file:', id);
                // Remove the ?url suffix for resolution
                const cleanId = id.replace('?url', '');

                // Resolve the actual file path
                if (cleanId.startsWith('../bin/')) {
                    const absolutePath = path.resolve(__dirname, '../..', cleanId.substring(3));
                    return absolutePath;
                }
                return this.resolve(cleanId, importer, { skipSelf: true });
            }
        },
        load(id) {
            if (id.endsWith('.wasm') || id.endsWith('.data.txt')) {
                console.log('Loading file:', id);

                // Emit the file as an asset
                const content = fs.readFileSync(id);
                // const relativePath = path.relative(path.resolve(__dirname, '../..'), id);

                const fileName = path.basename(id);

                const assetId = this.emitFile({
                    type: 'asset',
                    fileName: fileName,
                    source: content
                });

                // Return code that exports the URL
                return `export default import.meta.ROLLUP_FILE_URL_${assetId};`;
            }
        }
    };
}