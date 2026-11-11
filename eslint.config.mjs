import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import nextPlugin from '@next/eslint-plugin-next';

export default tseslint.config(
  { ignores: ['**/dist/**','**/.next/**','**/node_modules/**','**/generated/**'] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  { files:['apps/web/**/*.{ts,tsx}'],plugins:{'@next/next':nextPlugin},rules:{...nextPlugin.configs.recommended.rules,'@next/next/no-html-link-for-pages':'off'} },
  { files:['**/*.{ts,tsx}'],rules:{'@typescript-eslint/no-explicit-any':'off','@typescript-eslint/no-unused-vars':'off','@typescript-eslint/no-empty-object-type':'off'} }
);
