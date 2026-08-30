/** @type {import('tailwindcss').Config} */
module.exports = {
  content: [
    './App.tsx',
    './src/**/*.{js,ts,jsx,tsx}',
    // core 에도 클래스 문자열이 있다 (card-color.ts 의 카드 색 등).
    '../core/src/**/*.{js,ts}',
  ],
  presets: [require('nativewind/preset')],
  theme: { extend: {} },
  plugins: [],
};
