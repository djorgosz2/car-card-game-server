
// --- 1. Típusdefiníciók ---
export type MetricType = 'speed' | 'hp' | 'accel' | 'weight' | 'year'; 
export type PlayerId = string; 
export type GameStatus = 'menu' | 'playing' | 'win' | 'loss' | 'tie' | 'waiting_opponent';
export type PlayerActionPhase = 
  | 'waiting_for_initial_play'          // A játékos még nem játszott le semmit a körben
  | 'must_discard'                      // A játékosnak dobnia kell egy lapot
  | 'waiting_for_car_card_after_action' // A játékos akciókártyát játszott ki, és most autós kártya jön
  | 'turn_ended'                        // A játékos befejezte a lapok kijátszását a körben
  | 'awaiting_opponent_play'          // Várakozás az ellenfél lépésére (technikai fázis)
  | 'round_resolved'; // A kör lezárva, de még nem következik a kör váltás


export interface CardMetrics {
  speed: number;
  hp: number;
  accel: number;
  weight: number;
  year: number; 
}

export type ActionEffectType =
  | 'time_mod'             // Idő módosító
  | 'metric_mod_temp'      // Ideiglenes metrika módosító
  | 'metric_mod_perm'      // Permanens metrika módosító (játék végéig)
  | 'override_metric'      // Felülírja az összehasonlítás metrikáját
  | 'drop_card'            // Ellenféltől lapot dob el
  | 'extra_turn';          // Extra kör

// Union típus az összes lehetséges akció effektushoz
export type IActionEffect = 
  | { type: 'time_mod'; value: number }
  | { type: 'metric_mod_temp' | 'metric_mod_perm'; targetMetric: MetricType; value: number; modifierType: 'percentage' | 'absolute' }
  | { type: 'override_metric'; availableMetrics: CardMetrics; newMetric?: MetricType } // A newMetric itt lehet, hogy felesleges, ha a felhasználó választ
  | { type: 'drop_card' }
  | { type: 'extra_turn' };

export interface ICardDefinition {
  id: string;             
  name: string;
  type: 'car' | 'action';
  description: string;
  imageUrl?: string;      // URL a kártya képéhez
  brandLogoUrl?: string;  // URL a márka logójához
  brand?: string;
  model?: string;
  carRank?: string;
  engineType?: string;
  metrics?: CardMetrics; 
  actionEffect?: IActionEffect; 
}

export interface ICarCard extends ICardDefinition {
  type: 'car';
  metrics: CardMetrics;
}

export interface IActionCard extends ICardDefinition {
  type: 'action';
  actionEffect: IActionEffect;
}

export interface ICardInstance {
  instanceId: string;       
  cardId: string;           
  currentMetrics?: CardMetrics; 
  isModifiedPermanently?: boolean; 
  playedByPlayerId?: PlayerId;
  effectAppliedToCardInstanceId?: string;
  carRank?: string;
  originalMetrics?: CardMetrics; // Mentés az alap metrikákról
}

export interface IPlayerState {
  id: PlayerId;
  name: string;
  hand: ICardInstance[]; 
  score: number; 
}

export interface IGameState {
  gameId: string;
  players: IPlayerState[];
  currentPlayerId: PlayerId;
  gameStatus: GameStatus;
  roundWinnerId: PlayerId | null;
  winnerId: PlayerId | null;
  selectedMetricForRound: MetricType | null; 
  activeActionCardsOnBoard: { 
    [playerId: string]: ICardInstance | null;
  };
  carCardsOnBoard: { 
    [playerId: string]: ICardInstance | null;
  };
  discardPile: ICardInstance[]; 
  drawPile: ICardInstance[]; 
  lastPlayedCardInstanceId: string | null; 
  currentTurnStartTime: number; 
  turnTimeLimit: number; 
  rngSeed: number; 
  gameLog: string[]; 
  extraTurnPlayerId: PlayerId | null; 
  currentPlayerPhase: PlayerActionPhase; 
  pendingMetricModifiers: { // Függőben lévő metrika módosítók
    [playerId: string]: { // Annak a játékosnak az ID-je, akinek a kártyájára hat majd
      actionCardInstanceId: string; // Melyik akciókártya okozza
      effect: IActionEffect;       // Milyen hatás
    } | null;
  };
}
