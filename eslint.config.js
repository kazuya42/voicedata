// ESLint Flat Config (ESLint 9) – Expo-Basis + Prettier-Kompatibilität.
const { defineConfig } = require('eslint/config');
const expoConfig = require('eslint-config-expo/flat');
const eslintConfigPrettier = require('eslint-config-prettier');

module.exports = defineConfig([
  expoConfig,
  eslintConfigPrettier,
  {
    ignores: ['dist/*', 'node_modules/*', 'coverage/*'],
  },
]);
