import { IGameState, MetricType } from '../shared/interfaces';
import { getCardDefinition } from '../shared/game-engine'; // isValidPlay import eltávolítva

export function decideMove(gameState: IGameState, botId: string) {
    const botPlayer = gameState.players.find(p => p.id === botId);
    if (!botPlayer || botPlayer.hand.length === 0) {
        return null; // Nincs lapja
    }

    // Egyszerű stratégia: keres egy autós kártyát.
    // TODO: Fejleszteni a stratégiát (pl. akciókártya használata, legjobb metrika választása)
    const carCard = botPlayer.hand.find(c => getCardDefinition(c.cardId)?.type === 'car');
    
    // Ha nincs autós kártyája, amikor kellene, nem tud lépni.
    if (!carCard && (gameState.currentPlayerPhase === 'waiting_for_initial_play' || gameState.currentPlayerPhase === 'waiting_for_car_card_after_action')) {
        console.log(`[AI] Bot ${botId} has no car card to play.`);
        return null; 
    }
    
    // Ha valamiért még sincs carCard (pl. csak action lapjai vannak), de játszhatna,
    // akkor most egyszerűen nem lép semmit (később lehetne pl. action kártyát választani)
    if (!carCard) {
         console.log(`[AI] Bot ${botId} found no suitable card to play.`);
         return null;
    }

    let selectedMetric: MetricType | undefined = undefined;

    // Metrikát csak akkor választunk, ha a bot az első játékos a körben
    if (gameState.selectedMetricForRound === null) {
        const availableMetrics: MetricType[] = ['speed', 'hp', 'accel', 'weight', 'year'];
        selectedMetric = availableMetrics[Math.floor(Math.random() * availableMetrics.length)];
    }

    // A validációt eltávolítottuk innen. Csak visszaadjuk a döntést.
    return {
        cardInstanceId: carCard.instanceId,
        payload: { selectedMetric }
    };
}