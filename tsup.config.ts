import { defineConfig } from 'tsup';
import path from 'path';

export default defineConfig({
  entry: {
    index: 'src/index.ts',
    'handlers/message': 'src/handlers/message.ts',
    'handlers/import_data': 'src/handlers/import_data.ts',
    schema: 'src/schema.ts',
    sandbox: 'src/sandbox.ts',
  },
  format: ['esm'],
  target: 'es2022',
  outDir: 'dist',
  clean: true,
  bundle: true,
  splitting: false,
  sourcemap: false,
  esbuildOptions(options) {
    options.alias = {
      'sdk/db': path.resolve(__dirname, 'src/adapters/db.ts'),
      sdk: path.resolve(__dirname, 'src/adapters/db.ts'),
    };
  },
  onSuccess: 'cp dist/schema.js schema.js 2>/dev/null || copy dist\\schema.js schema.js',
});
