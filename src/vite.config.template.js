import { transform } from 'esbuild';

// dont import vite here because it requires the user to have vite installed

/** 
 * @type {import('vite').UserConfig}
*/
/** @ts-ignore (because of esm format + rollupOptions plugins ) */
export default {
    base: "./",
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
        rollupOptions: {
            output: {
                plugins: [
                    minifyEs()
                ],
                manualChunks: _ => "<name>",
                inlineDynamicImports: false,
                // https://rollupjs.org/configuration-options/#output-globals
                globals: {
                    "three": "THREE",
                    "@needle-tools/engine": "NE",
                }
            },
            external: [
                "@needle-tools/engine",
                "three",
                "three/examples/jsm/loaders/GLTFLoader.js",
                "three/examples/jsm/libs/meshopt_decoder.module.js",
                "three/examples/jsm/loaders/DRACOLoader.js",
                "three/examples/jsm/loaders/KTX2Loader.js",
            ],
        }
    }
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
