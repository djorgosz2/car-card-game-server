import { IGameState, MetricType } from '../shared/interfaces';
import { getCardDefinition, getGameInitConfig } from '../shared/game-engine'; // isValidPlay import eltávolítva

type AiStrategy = 'basic' | 'good';

const INVERTED_METRICS: Record<MetricType, boolean> = {
    speed: false,
    hp: false,
    accel: true,
    weight: true,
    year: false,
};

const ALL_METRICS: MetricType[] = ['speed', 'hp', 'accel', 'weight', 'year'];

function getMetricValue(cardId: string, metric: MetricType): number | null {
    const def = getCardDefinition(cardId);
    if (!def || !def.metrics) return null;
    return def.metrics[metric];
}

function normalizeInHand(values: number[], invert: boolean): (val: number) => number {
    const min = Math.min(...values);
    const max = Math.max(...values);
    if (max === min) {
        return () => 0.5; // all equal
    }
    return (val: number) => {
        const norm = (val - min) / (max - min);
        return invert ? 1 - norm : norm;
    };
}

function chooseBestCardForMetric(gameState: IGameState, botId: string, metric: MetricType): { cardInstanceId: string | null; score: number } {
    const bot = gameState.players.find(p => p.id === botId);
    if (!bot) return { cardInstanceId: null, score: -1 };
    const carCards = bot.hand.filter(c => getCardDefinition(c.cardId)?.type === 'car');
    if (carCards.length === 0) return { cardInstanceId: null, score: -1 };

    const metricValues = carCards
        .map(c => getMetricValue(c.cardId, metric))
        .filter((v): v is number => typeof v === 'number');
    if (metricValues.length === 0) return { cardInstanceId: null, score: -1 };

    const normalize = normalizeInHand(metricValues, INVERTED_METRICS[metric]);

    let bestId: string | null = null;
    let bestScore = -1;
    for (const c of carCards) {
        const v = getMetricValue(c.cardId, metric);
        if (typeof v !== 'number') continue;
        const s = normalize(v);
        if (s > bestScore) {
            bestScore = s;
            bestId = c.instanceId;
        }
    }
    return { cardInstanceId: bestId, score: bestScore };
}

export function decideMoveBasic(gameState: IGameState, botId: string) {
    const botPlayer = gameState.players.find(p => p.id === botId);
    if (!botPlayer || botPlayer.hand.length === 0) {
        return null; // Nincs lapja
    }
    const carCard = botPlayer.hand.find(c => getCardDefinition(c.cardId)?.type === 'car');
    if (!carCard && (gameState.currentPlayerPhase === 'waiting_for_initial_play' || gameState.currentPlayerPhase === 'waiting_for_car_card_after_action')) {
        console.log(`[AI] Bot ${botId} has no car card to play.`);
        return null; 
    }
    if (!carCard) {
         console.log(`[AI] Bot ${botId} found no suitable card to play.`);
         return null;
    }
    let selectedMetric: MetricType | undefined = undefined;
    if (gameState.selectedMetricForRound === null) {
        const availableMetrics: MetricType[] = ALL_METRICS;
        selectedMetric = availableMetrics[Math.floor(Math.random() * availableMetrics.length)];
    }
    return {
        cardInstanceId: carCard.instanceId,
        payload: { selectedMetric }
    };
}

export function decideMoveGood(gameState: IGameState, botId: string) {
    const botPlayer = gameState.players.find(p => p.id === botId);
    if (!botPlayer || botPlayer.hand.length === 0) {
        return null;
    }

    // Ha már meg van adva a metrika, arra optimalizálunk
    if (gameState.selectedMetricForRound) {
        const metric = gameState.selectedMetricForRound;
        const best = chooseBestCardForMetric(gameState, botId, metric);
        if (!best.cardInstanceId) return null;
        return {
            cardInstanceId: best.cardInstanceId,
            payload: { }
        };
    }

    // Ha a bot választ metrikát, nézzük végig az összeset, és válasszuk a legígéretesebbet
    let bestOverallMetric: MetricType | null = null;
    let bestOverallCard: string | null = null;
    let bestOverallScore = -1;
    for (const m of ALL_METRICS) {
        const cand = chooseBestCardForMetric(gameState, botId, m);
        if (cand.cardInstanceId && cand.score > bestOverallScore) {
            bestOverallScore = cand.score;
            bestOverallMetric = m;
            bestOverallCard = cand.cardInstanceId;
        }
    }

    if (!bestOverallCard || !bestOverallMetric) {
        return null;
    }

    return {
        cardInstanceId: bestOverallCard,
        payload: { selectedMetric: bestOverallMetric }
    };
}

function getConfiguredStrategy(): AiStrategy {
    try {
        const cfg = getGameInitConfig() as unknown as { ai?: { strategy?: string } };
        const s = cfg.ai?.strategy;
        if (s === 'good') return 'good';
        return 'basic';
    } catch {
        return 'basic';
    }
}

const SELECTED_STRATEGY: AiStrategy = getConfiguredStrategy();

export function decideMove(gameState: IGameState, botId: string) {
    if (SELECTED_STRATEGY === 'good') {
        return decideMoveGood(gameState, botId);
    }
    return decideMoveBasic(gameState, botId);
}