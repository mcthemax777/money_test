import type { Config } from 'tailwindcss';

const config: Config = {
  content: [
    './src/pages/**/*.{js,ts,jsx,tsx,mdx}',
    './src/components/**/*.{js,ts,jsx,tsx,mdx}',
    './src/app/**/*.{js,ts,jsx,tsx,mdx}',
    // core에도 클래스 문자열이 있다 (card-color.ts의 카드 앞면·글씨 색,
    // account-type.ts의 배지 색). 여기 없으면 그 클래스만 조용히 빠져서
    // 카드가 하얗게 나온다. dist가 아니라 소스를 훑는다.
    '../core/src/**/*.{js,ts,jsx,tsx,mdx}',
  ],
  theme: {
    extend: {},
  },
  plugins: [],
};
export default config;
