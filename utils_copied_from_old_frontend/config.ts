// src/utils/config.ts
const API_URL = process.env.EXPO_PUBLIC_API_URL || 'http://localhost:3000/api'; // Default fallback
const INITIAL_TIMER_DURATION = parseInt(process.env.EXPO_PUBLIC_INITIAL_TIMER_DURATION || '60', 10);
const INITIAL_CARD_COUNT = parseInt(process.env.EXPO_PUBLIC_INITIAL_CARD_COUNT || '5', 10);
const INITIAL_ACTION_CARD_COUNT = parseInt(
  process.env.EXPO_PUBLIC_INITIAL_ACTION_CARD_COUNT || '7',
  10,
);
const JSON_CAR_COUNT = parseInt(process.env.EXPO_PUBLIC_JSON_CAR_COUNT || '50', 10);
const DEFAULT_METRICS: string[] = [
  'speed',
  'acceleration',
  'horsepower',
  'price',
  'year',
  'weight',
]; // Example metrics

// Theme configuration
const DEFAULT_THEME_INDEX = 51; // Theme 52 (index 51)

export const gameConfig = {
  apiUrl: API_URL,
  initialTimerDuration: INITIAL_TIMER_DURATION,
  initialCardCount: INITIAL_CARD_COUNT,
  initialActionCardCount: INITIAL_ACTION_CARD_COUNT,
  jsonCarCount: JSON_CAR_COUNT,
  defaultMetrics: DEFAULT_METRICS,
  animationDurations: {
    deal: 300,
    play: 500,
    flip: 400,
  },
  theme: {
    defaultIndex: DEFAULT_THEME_INDEX,
  },
};
