// ======================================================================
// shared/game-engine.ts
// A játék autoritatív logikája, amelyet a szerver és a kliens is használ.
// Ez a modul tisztán funkcionális: bemeneti állapot -> kimeneti új állapot.
// ======================================================================

import { v4 as uuidv4 } from 'uuid'; // npm install uuid, @types/uuid
// Assuming interfaces.ts is in the same directory or accessible
import { IGameState, IPlayerState, GameStatus, ICardDefinition, ICardInstance, ICarCard, IActionCard, MetricType, PlayerId, PlayerActionPhase, CardMetrics } from './interfaces';
import CarList from '../shared/data/CarList.json';
// --- Determinisztikus RNG ---
class DeterministicRNG {
  private seed: number;
  constructor(seed: number) { this.seed = seed; }
  next(): number {
    this.seed ^= this.seed << 13; this.seed ^= this.seed >> 17; this.seed ^= this.seed << 5;
    return ((this.seed < 0 ? ~this.seed + 1 : this.seed) % 100000) / 100000;
  }
  shuffle<T>(array: T[]): T[] {
    const newArray = [...array];
    for (let i = newArray.length - 1; i > 0; i--) {
      const j = Math.floor(this.next() * (i + 1));
      [newArray[i], newArray[j]] = [newArray[j], newArray[i]];
    }
    return newArray;
  }
  pickRandom<T>(array: T[]): T {
    return array[Math.floor(this.next() * array.length)];
  }
}

// --- Segédfüggvények ---
const getPlayerState = (state: IGameState, playerId: PlayerId): IPlayerState => {
  const player = state.players.find(p => p.id === playerId);
  if (!player) throw new Error(`Player ${playerId} not found.`);
  return player;
};

const getOpponentPlayerState = (state: IGameState, playerId: PlayerId): IPlayerState => {
  const opponent = state.players.find(p => p.id !== playerId);
  if (!opponent) throw new Error(`Opponent for ${playerId} not found.`);
  return opponent;
};

// --- Kártya Rangszámítás Logika ---

// Define weights for each metric (customize as needed)
const METRIC_WEIGHTS: { [K in keyof CardMetrics]?: number } = {
  speed: 1.0,
  hp: 0.9,
  accel: 0.8, // Lower is better
  weight: 0.7, // Lower is better
  year: 0.5,
};

const ENGINE_TYPE_SCORES: { [key: string]: number } = {
  Electric: 1.0,
  Hybrid: 0.8,
  V8: 0.7,
  V6: 0.6,
  'Flat-6': 0.75, // Added for Porsche from your mock
  default: 0.5,
};

function getEngineScore(engineType: string): number {
  return ENGINE_TYPE_SCORES[engineType] ?? ENGINE_TYPE_SCORES.default;
}

function normalize(value: number, min: number, max: number, invert = false): number {
  if (max === min) return 0.5; // Avoid division by zero
  const norm = (value - min) / (max - min);
  return invert ? 1 - norm : norm;
}

export function calculateCarRanks(deck: ICarCard[]): ICarCard[] {
  if (deck.length === 0) return deck;

  // Find min/max for each metric
  const metrics = Object.keys(METRIC_WEIGHTS) as (keyof CardMetrics)[];
  const minMax: { [K in keyof CardMetrics]?: { min: number; max: number } } = {};
  metrics.forEach((metric) => {
    const values = deck
      .map((card) => card.metrics[metric])
      .filter((v) => typeof v === 'number') as number[];
    minMax[metric] = {
      min: Math.min(...values),
      max: Math.max(...values),
    };
  });

  // For scoring, lower accel and weight are better
  const invertMetric: { [K in keyof CardMetrics]?: boolean } = { accel: true, weight: true };

  // Calculate scores
  const scores = deck.map((card) => {
    let score = 0;
    let totalWeight = 0;
    metrics.forEach((metric) => {
      const value = card.metrics[metric];
      const { min, max } = minMax[metric]!;
      const weight = METRIC_WEIGHTS[metric]!;
      const norm = normalize(value, min, max, invertMetric[metric]);
      score += norm * weight;
      totalWeight += weight;
    });
    // Engine type as bonus
    score += getEngineScore(card.engineType || '') * 0.5;
    totalWeight += 0.5;
    return score / totalWeight;
  });

  // Assign ranks based on quantiles
  const sortedScores = [...scores].sort((a, b) => b - a);
  const getRank = (score: number): string => {
    // If all scores are identical (e.g., deck of 1 or all same stats), assign a default rank
    if (deck.length === 1 || sortedScores[0] === sortedScores[sortedScores.length - 1]) {
      return 'B'; 
    }

    const idx = sortedScores.findIndex((s) => s === score);
    // Ensure index is within bounds, especially for small decks
    const effectiveLength = deck.length - 1;
    const quantile = effectiveLength > 0 ? idx / effectiveLength : 0.5; // Default to 0.5 for single card

    if (quantile <= 0.15) return 'S';
    if (quantile <= 0.35) return 'A';
    if (quantile <= 0.65) return 'B';
    if (quantile <= 0.85) return 'C';
    return 'D';
  };

  // Return new deck with carRank assigned
  return deck.map((card, i) => ({
    ...card,
    carRank: getRank(scores[i]),
  }));
}

// --- JSON Autó Adatok Feldolgozása ---

// Define the JSON car data structure
interface JsonCarData {
  Year?: number;
  'Makes: 96'?: string; // Brand
  'Models: 675'?: string; // Model
  'Car Value'?: string;
  HP?: number;
  Wt?: number;
  'Top Speed'?: number;
  '0-60 Sec'?: number;
  'Special Reward/Gift'?: string;
  Engine?: string;
  // További mezők, amik a JSON-ban vannak
  FALSE?: string;
  'Year Makes: 96 Models: 675'?: string;
  Nickname?: string;
  Ordinal?: number;
  'Access Type'?: string;
  'DLC Pack'?: string;
  'Direct Access'?: string;
  Rarity?: string;
  'FE Boost'?: string;
  'Featured Sale Deadline'?: string;
  'Car Division'?: string;
  Spec?: string;
  PI?: number;
  Class?: string;
  S?: number;
  B?: number;
  H?: number;
  A?: number;
  L?: number;
  O?: number;
  T?: number;
  'Wt / HP'?: number;
  '%'?: number;
  'Displ cc'?: number;
  Aspiration?: string;
  Cylinders?: number;
  Eng?: string;
  Drive?: string;
  'F Tire/RRim'?: string;
  'R Tire/RRim'?: string;
  'Track Width'?: string;
  'Aero or kit Options'?: string;
  'Engine Conversions (hp)'?: string;
  'Aspiration Options'?: string;
  'Naturally Aspirated'?: string;
  Region?: string;
  Country?: string;
  'Model Family'?: string;
  'Open Top'?: string;
  Doors?: number;
  Steering?: string;
  Wheels?: number;
  'No lights'?: string;
  'Car Themes'?: string;
  '0-100 Sec'?: number;
  '1/4 Mile'?: number;
  '60-0 Feet'?: number;
  '100-0 Ft'?: number;
  "60 mph g's"?: number;
  "100mph g's"?: number;
  '60-100 sec'?: number;
  'MM VIN'?: number;
  'FM Debut'?: string;
  'FH5 Debut'?: string;
  'Forza Debut'?: string;
  'Latest game'?: string;
  'New to Forza'?: string;
  FM?: string;
  FH5?: string;
  FH4?: string;
  FM7?: string;
  FH3?: string;
  FM6?: string;
  FH2?: string;
  FM5?: string;
  FH1?: string;
  FM4?: string;
  FM3?: string;
  FM2?: string;
  FM1?: string;
  '# Titles'?: number;
  'Xbox gen'?: string;
  ''?: number;
}

/**
 * Converts JSON car data into ICarCard objects.
 *
 * @param jsonData Array of car data from JSON file
 * @returns An array of ICarCard objects
 */
export function parseJsonToCarCards(jsonData: JsonCarData[]): ICarCard[] {
  const cars: ICarCard[] = [];

  jsonData.forEach((carData, index) => {
    try {
      // Safely access values, providing a fallback for missing data
      const brand = carData['Makes: 96'] || 'Unknown Brand';
      let model: string = 'Unknown Model';
      if (carData['Models: 675'] !== undefined && carData['Models: 675'] !== null) {
        model = String(carData['Models: 675']);
      }
      // Ensure model is always a string before using toUpperCase
      model = String(model);
      const year = carData.Year || 0;
      // Debug log before ID generation
      console.log('Generating ID for car:', { brand, model, year });
      const speed = carData['Top Speed'] || 0;
      const hp = carData.HP || 0;
      const accel = carData['0-60 Sec'] || 0;
      const weight = carData.Wt || 0;
      const engineType = carData.Engine || 'Unknown';

      // Validation: if any essential metric is 0, skip this car
      // Also ensure accel and weight are positive as they are divisors/comparators
      if (speed <= 0 || hp <= 0 || accel <= 0 || weight <= 0 || year <= 0) {
        return; // Skip this car if essential data is missing or invalid
      }
      
      // Generate image URLs pointing to server's static files
      // Image file naming convention: car-brand-model-year.jpg (lowercase, spaces replaced with dashes)
      const imageSlug = `${brand}-${model}-${year}`.toLowerCase().replace(/[^a-z0-9-]/g, '-').replace(/-+/g, '-');
      const brandSlug = brand.toLowerCase().replace(/[^a-z0-9-]/g, '-').replace(/-+/g, '-');
      
      const SERVER_URL = process.env.SERVER_URL || 'http://localhost:3000';
      const imageUrl = `${SERVER_URL}/images/car-${imageSlug}.jpg`;
      const brandLogoUrl = `${SERVER_URL}/images/brand-${brandSlug}.png`;

      cars.push({
        // Dynamic ID based on car data, made URL-friendly
        id: `CAR_${String(brand).toUpperCase().replace(/[^A-Z0-9]/g, '')}_${String(model).toUpperCase().replace(/[^A-Z0-9]/g, '')}_${year}`,
        name: `${brand} ${model} (${year})`,
        type: 'car',
        description: `A ${year}-es gyártású ${brand} ${model}.`, // Simple description in Hungarian
        brand: brand,
        model: model,
        metrics: {
          speed: speed,
          hp: hp,
          accel: accel,
          weight: weight,
          year: year,
        },
        carRank: 'D', // Temporary, will be assigned by calculateCarRanks
        engineType: engineType,
        imageUrl: imageUrl,
        brandLogoUrl: brandLogoUrl,
      });
    } catch (e) {
      console.error(`Error processing car ${index + 1}:`, carData, 'Error:', e);
      // Skip this car and continue
    }
  });

  return cars;
}

/**
 * Reads cars from the CarList.ts file and returns a limited number of cars with calculated ranks.
 * This function needs to be adapted for server-side Node.js environment.
 *
 * @param maxCars Maximum number of cars to return (default: 50)
 * @returns An array of ICarCard objects
 */
export function readCarsFromJson(maxCars: number = 50): ICarCard[] {
  try {
    const jsonData = CarList as JsonCarData[]; 
    
    const allCars = parseJsonToCarCards(jsonData);
    
    // Calculate ranks for all cars
    const rankedCars = calculateCarRanks(allCars);

    // Return only the specified number of cars
    const limitedCars = rankedCars.slice(0, maxCars);
    
    console.log(`Successfully loaded and ranked ${limitedCars.length} cars from CarList.json.`);
    return limitedCars;
  } catch (error) {
    console.error('Error reading or processing CarList.json:', error);
    // Return empty array if file cannot be read
    return [];
  }
}


// --- Kártya Adatbázis Kezelés ---
// Ezt a tömböt töltjük fel a dinamikusan betöltött és a statikus kártyadefiníciókkal.
let ALL_GAME_CARD_DEFINITIONS: ICardDefinition[] = [];

// Ez a függvény tölti be a kártyákat egyszer a játék indítása előtt.
export const loadCardDefinitions = () => {
    if (ALL_GAME_CARD_DEFINITIONS.length > 0) {
        return; // Már be voltak töltve
    }

    // Autós kártyák betöltése JSON-ból és rangok számítása
    const jsonCarCards = readCarsFromJson(50); // Például 50 autós kártya betöltése

    // Statikus akciókártya definíciók (ahogy eddig is voltak)
    const SERVER_URL = process.env.SERVER_URL || 'http://localhost:3000';
    
    const staticActionCards: IActionCard[] = [
      // Globális hatás
    { 
      id: "ACTION_TIME_BOOST", 
      name: "Időbónusz", 
      type: "action", 
      description: "+30 mp",
      imageUrl: `${SERVER_URL}/images/action-time-boost.png`,
      actionEffect: { type: "time_mod", value: 30, target: 'game' }
    },

    // Saját magára ható (pozitív) hatások
    { 
      id: "ACTION_HP_BOOST_TEMP", 
      name: "Turbó Feltöltés", 
      type: "action", 
      description: "+20% HP (ideiglenes)",
      imageUrl: `${SERVER_URL}/images/action-hp-boost-temp.png`,
      actionEffect: { type: "metric_mod_temp", targetMetric: "hp", value: 20, modifierType: "percentage", target: 'self' }
    },
    { 
      id: "ACTION_HP_BOOST_PERM", 
      name: "Örök Tuning", 
      type: "action", 
      description: "+50 HP (permanens)",
      imageUrl: `${SERVER_URL}/images/action-hp-boost-perm.png`,
      actionEffect: { type: "metric_mod_perm", targetMetric: "hp", value: 50, modifierType: "absolute", target: 'self' }
    },
    { 
      id: "ACTION_EXTRA_TURN", 
      name: "Extra Kör", 
      type: "action", 
      description: "Még egy kör",
      imageUrl: `${SERVER_URL}/images/action-extra-turn.png`,
      actionEffect: { type: "extra_turn", target: 'self' }
    },

    // Ellenfélre ható (negatív) hatások
    { 
      id: "ACTION_WEIGHT_PENALTY_TEMP", 
      name: "Homokzsák", 
      type: "action", 
      description: "+200 kg (ideiglenes)",
      imageUrl: `${SERVER_URL}/images/action-weight-penalty-temp.png`,
      actionEffect: { type: "metric_mod_temp", targetMetric: "weight", value: 200, modifierType: "absolute", target: 'opponent' }
    },
    { 
      id: "ACTION_DROP_CARD", 
      name: "Lap Lehúzás", 
      type: "action", 
      description: "Ellenféltől lapot vesz el",
      imageUrl: `${SERVER_URL}/images/action-drop-card.png`,
      actionEffect: { type: "drop_card", target: 'opponent' }
    },

    // Speciális, helyzetfüggő hatás
    { 
      id: "ACTION_OVERRIDE_METRIC_CHOICE", 
      name: "Taktikai Váltás", 
      type: "action", 
      description: "Válassz új metrikát!",
      imageUrl: `${SERVER_URL}/images/action-override-metric.png`,
      actionEffect: { type: "override_metric", availableMetrics: { speed: 0, hp: 0, accel: 0, weight: 0, year: 0 }, target: 'self' }
    },
  ];

    ALL_GAME_CARD_DEFINITIONS = [...jsonCarCards, ...staticActionCards];
    console.log(`Összesen ${jsonCarCards.length} autós és ${staticActionCards.length} akciókártya definíció betöltve.`);
};

// Ez a függvény adja vissza a kártya definíciókat az ID alapján.
export const getCardDefinition = (cardId: string): ICardDefinition | undefined => {
  // Ensure cards are loaded before trying to retrieve
  if (ALL_GAME_CARD_DEFINITIONS.length === 0) {
      loadCardDefinitions(); // Load if not already loaded (e.g., first call)
  }
  return ALL_GAME_CARD_DEFINITIONS.find(card => card.id === cardId);
};

export const isCarCardDef = (cardDef: ICardDefinition): cardDef is ICarCard => cardDef.type === 'car';
export const isActionCardDef = (cardDef: ICardDefinition): cardDef is IActionCard => cardDef.type === 'action';
// Meglévő segédfüggvények
export const getActionCardDefinition = (card: ICardInstance): IActionCard => {
  const cardDef = getCardDefinition(card.cardId);
  if (!cardDef) {
    throw new Error(`Action card definition not found for cardId: ${card.cardId}`);
  }
  if (!isActionCardDef(cardDef)) {
    throw new Error(`Card ${card.cardId} is not an action card`);
  }
  return cardDef;
};
export const getCarCardDefinition = (card: ICardInstance): ICarCard => {
  const cardDef = getCardDefinition(card.cardId);
  if (!cardDef) {
    throw new Error(`Car card definition not found for cardId: ${card.cardId}`);
  }
  if (!isCarCardDef(cardDef)) {
    throw new Error(`Card ${card.cardId} is not a car card`);
  }
  return cardDef;
};


// --- 2. Játék Inicializálás (Exportált funkció) ---
export const initializeGame = (playerIds: PlayerId[], playerNames: string[], initialSeed: number, timeLimit: number, isInitialDrawEnabled: boolean): IGameState => {
  const rng = new DeterministicRNG(initialSeed);

  // Kártya definíciók betöltése (ha még nem történt meg)
  if (ALL_GAME_CARD_DEFINITIONS.length === 0) {
      loadCardDefinitions();
  }

  // Különválasztjuk az autós és akciókártya definíciókat
  const allCarCardDefs = ALL_GAME_CARD_DEFINITIONS.filter(isCarCardDef);
  const allActionCardDefs = ALL_GAME_CARD_DEFINITIONS.filter(isActionCardDef);

  // Készítsünk egy paklit a játékhoz (példa: 20 autós kártya és 5 akciókártya)
  // Ezeket véletlenszerűen választjuk ki a teljes betöltött listából
  if (allCarCardDefs.length === 0) {
      throw new Error("Nincsenek betöltött autós kártyák a játékhoz! Ellenőrizze a CarList.json fájlt.");
  }
  if (allActionCardDefs.length === 0) {
      console.warn("Nincsenek betöltött akciókártyák!");
  }

  const numCarsInDeck = Math.min(20, allCarCardDefs.length); // Max 20 autó, vagy amennyi van
  const numActionsInDeck = Math.min(5, allActionCardDefs.length); // Max 5 akció, vagy amennyi van

  const carsForDeck = rng.shuffle(allCarCardDefs).slice(0, numCarsInDeck);
  const actionsForDeck = rng.shuffle(allActionCardDefs).slice(0, numActionsInDeck);

  const rawCardDefsForDeck: ICardDefinition[] = [...carsForDeck, ...actionsForDeck];
  
  const allGameCardInstances: ICardInstance[] = rawCardDefsForDeck.map(cardDef => {
    const baseMetrics = isCarCardDef(cardDef) ? { ...cardDef.metrics! } : undefined;
    return {
      instanceId: uuidv4(),
      cardId: cardDef.id,
      currentMetrics: baseMetrics, // Kezdetben azonos az eredetivel
      originalMetrics: baseMetrics, // Elmentjük az eredetit is
    };
  });

  const shuffledDeck = rng.shuffle(allGameCardInstances);

  const players: IPlayerState[] = playerIds.map((id, index) => ({
    id,
    name: playerNames[index],
    hand: [],
    score: 0,
  }));

  // Lapok kiosztása (7-7 lap)
  for (let i = 0; i < 7; i++) {
    players.forEach(player => {
      if (shuffledDeck.length > 0) {
        player.hand.push(shuffledDeck.shift()!);
      }
    });
  }

  // For testing: always start with the first player (human player)
  // Comment out random selection and use first player instead
  // const startingPlayerId = rng.pickRandom(playerIds);
  const startingPlayerId = playerIds[0]; // Always first player starts (for testing)
  const opponentPlayerId = playerIds.find(id => id !== startingPlayerId)!; // Biztosan létezik 2 játékosnál

  return {
    gameId: uuidv4(),
    players,
    currentPlayerId: startingPlayerId,
    gameStatus: 'playing',
    roundWinnerId: null,
    winnerId: null,
    selectedMetricForRound: null, 
    activeActionCardsOnBoard: { [playerIds[0]]: null, [playerIds[1]]: null }, // Inicializáljuk mindkét játékosra
    carCardsOnBoard: { [playerIds[0]]: null, [playerIds[1]]: null },
    discardPile: [],
    drawPile: shuffledDeck, 
    lastPlayedCardInstanceId: null,
    currentTurnStartTime: Date.now(), // Szerver idő
    turnTimeLimit: timeLimit,
    rngSeed: initialSeed,gameLog: [`A játék elindult! ${players.find(p => p.id === startingPlayerId)!.name} kezd.`],
    extraTurnPlayerId: null,
    currentPlayerPhase: 'waiting_for_initial_play', 
    pendingMetricModifiers: { [playerIds[0]]: null, [playerIds[1]]: null }, // Inicializáljuk mindkét játékosra
  };
};

// --- 3. Validáció (Exportált, a kliens oldali pre-validációhoz is) ---

export const isValidPlay = (
    state: IGameState,
    playerId: PlayerId,
    cardInstanceId: string,
    payload?: { selectedMetric?: MetricType; targetPlayerId?: PlayerId; }
): { isValid: boolean; message?: string } => {
    const player = getPlayerState(state, playerId);
    const cardInstance = player.hand.find(c => c.instanceId === cardInstanceId);
    if (!cardInstance) return { isValid: false, message: "Kártya nem található a kezedben." };

    const cardDef = getCardDefinition(cardInstance.cardId)!;

    // Fázis ellenőrzés
    if (isActionCardDef(cardDef)) {
        if (state.currentPlayerPhase !== 'waiting_for_initial_play') {
            return { isValid: false, message: "Akciókártyát csak a köröd legelején játszhatsz ki." };
        }
    } else if (isCarCardDef(cardDef)) {
        if (state.currentPlayerPhase !== 'waiting_for_initial_play' && state.currentPlayerPhase !== 'waiting_for_car_card_after_action') {
            return { isValid: false, message: "Most nem játszhatsz ki autós kártyát." };
        }
        // Az első játékosnak, aki autót tesz, kötelező metrikát választania.
        if (state.selectedMetricForRound === null && !payload?.selectedMetric) {
            return { isValid: false, message: "Ki kell választanod egy metrikát az első autós kártyához." };
        }
    }

    // Specifikus 'override_metric' validáció
    const pendingModifier = state.pendingMetricModifiers[playerId];
    if (pendingModifier && pendingModifier.effect.type === 'override_metric') {
        if (!payload?.selectedMetric || !pendingModifier.effect.availableMetrics || !(payload.selectedMetric in pendingModifier.effect.availableMetrics)) {
            return { isValid: false, message: "Érvénytelen metrikát választottál a felülíráshoz." };
        }
    }

    return { isValid: true };
};

// Define a type for the return value
type PerformPlayResult =
  | { success: true; newState: IGameState }
  | { success: false; message: string };

export const performPlay = (
  state: IGameState,
  playerId: PlayerId,
  cardInstanceId: string,
  payload: { selectedMetric?: MetricType; targetPlayerId?: PlayerId; }
): PerformPlayResult => {
  const validation = isValidPlay(state, playerId, cardInstanceId, payload);
  if (!validation.isValid) {
    // Instead of throwing, return a failure object
    return { success: false, message: validation.message ?? 'Érvénytelen lépés' };
  }
  
  let newState = JSON.parse(JSON.stringify(state)); // Mély másolás az immutabilitásért
  const player = getPlayerState(newState, playerId);
  const opponent = getOpponentPlayerState(newState, playerId);
  const cardIndex = player.hand.findIndex(c => c.instanceId === cardInstanceId);
  
  // Extra safety check (shouldn't happen if validation passes, but good practice)
  if (cardIndex === -1) {
      return { success: false, message: "Kártya hiba: Nem található a kezedben (belső hiba)." };
  }
  
  const cardInstance = player.hand[cardIndex];
  const cardDef = getCardDefinition(cardInstance.cardId)!; // Biztosan létezik, hiszen érvényesítve van

  player.hand.splice(cardIndex, 1); // Kártya eltávolítása a kézből

  // --- LOGIKA ---
  // 1. Akciókártya kijátszása
  if (isActionCardDef(cardDef)) {
    const effect = cardDef.actionEffect;
    let targetId = playerId;
    if (effect.target === 'opponent') {
        targetId = opponent.id;
    }
    newState.activeActionCardsOnBoard[playerId] = cardInstance;

    switch (effect.type) {
      case 'time_mod':
        newState.turnTimeLimit += effect.value;
        newState.gameLog.push(`${player.name} kijátszotta a(z) '${cardDef.name}' kártyát, +${effect.value}s.`);
        break;
      case 'extra_turn':
        newState.extraTurnPlayerId = playerId;
        newState.gameLog.push(`${player.name} kijátszotta a(z) '${cardDef.name}' kártyát.`);
        break;
      case 'drop_card':
        if (opponent.hand.length > 0) {
          // Használjuk a játék RNG-jét a determinisztikus működésért
          const rngForDrop = new DeterministicRNG(newState.rngSeed + opponent.hand.length); // A seed-et kicsit módosítjuk, hogy ne mindig ugyanazt adja
          const cardIndexToDrop = Math.floor(rngForDrop.next() * opponent.hand.length);
      
          // A splice metódussal vesszük ki a véletlenszerű lapot
          const [droppedCard] = opponent.hand.splice(cardIndexToDrop, 1);
      
          newState.discardPile.push(droppedCard);
          newState.gameLog.push(`${player.name} a(z) '${cardDef.name}' kártyával eldobatta az ellenfél egy véletlenszerű lapját.`);
        } else {
          newState.gameLog.push(`${player.name} a(z) '${cardDef.name}' kártyát játszotta ki, de az ellenfélnek nem volt lapja.`);
        }
        break;
      case 'metric_mod_temp':
      case 'metric_mod_perm':
      case 'override_metric':
        
        newState.pendingMetricModifiers[targetId] = {
          sourcePlayerId: playerId,
          actionCardInstanceId: cardInstance.instanceId,
          effect: effect,
      };
      newState.gameLog.push(`${player.name} előkészített egy ${effect.type} hatást ${targetId === opponent.id ? 'az ellenfélre.' : 'magára.'}`);
      break;
    }
    newState.currentPlayerPhase = 'waiting_for_car_card_after_action';
  } 
  // 2. Autós kártya kijátszása
  else if (isCarCardDef(cardDef)) {
    const carCardOnBoard = cardInstance;
    newState.carCardsOnBoard[playerId] = carCardOnBoard;
    newState.lastPlayedCardInstanceId = cardInstanceId;

    // I. FÜGGŐBEN LÉVŐ AKCIÓKÁRTYA ALKALMAZÁSA
    const pendingModifier = newState.pendingMetricModifiers[playerId];
    if (pendingModifier) {
      const actionCardInstanceOnBoard = newState.activeActionCardsOnBoard[pendingModifier.sourcePlayerId];
      if (!actionCardInstanceOnBoard) {
        throw new Error(`Inconsistent state: Pending modifier exists for player ${playerId}, but no action card is on the board.`);
      }

      const actionCardPlayedDef = getCardDefinition(actionCardInstanceOnBoard.cardId)!;
      if (!actionCardPlayedDef) {
           throw new Error(`Card definition not found for action card: ${actionCardInstanceOnBoard.cardId}`);
      }
      
      const effect = pendingModifier.effect;

      if (!carCardOnBoard.currentMetrics) {
        carCardOnBoard.currentMetrics = { ...(getCarCardDefinition(carCardOnBoard).metrics) };
      }

      if ((effect.type === 'metric_mod_temp' || effect.type === 'metric_mod_perm')) {
        const metricToModify: MetricType = effect.targetMetric;
        const originalValue = carCardOnBoard.originalMetrics![metricToModify];
        let modifiedValue = originalValue;
        if (effect.modifierType === 'percentage') {
          modifiedValue = originalValue * (1 + effect.value / 100);
        } else { // absolute
          modifiedValue = originalValue + effect.value;
        }
        carCardOnBoard.currentMetrics![metricToModify] = Math.round(modifiedValue);
        
        if (effect.type === 'metric_mod_perm') {
          carCardOnBoard.isModifiedPermanently = true;
        }
        newState.gameLog.push(`A(z) '${actionCardPlayedDef.name}' hatása érvényesült a(z) '${getCarCardDefinition(carCardOnBoard).name}' kártyán (${effect.targetMetric} módosítva).`);
      }
      
      else if (effect.type === 'override_metric' && payload.selectedMetric) {
        newState.selectedMetricForRound = payload.selectedMetric;
        newState.gameLog.push(`${player.name} a(z) '${actionCardPlayedDef.name}' kártyával megváltoztatta a metrikát erre: ${payload.selectedMetric}.`);
      }
      
      newState.pendingMetricModifiers[playerId] = null; // Módosító alkalmazva, töröljük a függőben lévők közül
    }
    
    // II. A KÖR METRIKÁJÁNAK BEÁLLÍTÁSA (HA MÉG NINCS)
    if (newState.selectedMetricForRound === null) {
      if (!payload.selectedMetric) {
        // Return failure instead of throwing
        return { success: false, message: "Metrika választás kötelező, ha még nincs kiválasztva a körre." };
      }
      newState.selectedMetricForRound = payload.selectedMetric;
      newState.gameLog.push(`${player.name} a(z) '${cardDef.name}' kijátszásával a kör metrikáját erre állította: ${payload.selectedMetric}.`);
    }
    
    newState.currentPlayerPhase = 'turn_ended';
  }
  
  // --- JAVÍTOTT RÉSZ ---
  // Kör kiértékelése, ha mindkét játékos tett le autót
  if (newState.carCardsOnBoard[player.id] && newState.carCardsOnBoard[opponent.id]) {
    // ResolveRound might still throw internal errors, keep that possibility
    try {
        newState = resolveRound(newState); 
    } catch (e: any) {
        console.error("Internal error during resolveRound:", e);
        return { success: false, message: "Belső hiba a kör lezárásakor." };
    }
    // Csak akkor állítsuk be a 'round_resolved' fázist, ha a resolveRound nem állított be egy specifikusabbat.
    if (newState.currentPlayerPhase !== 'must_discard') {
      newState.currentPlayerPhase = 'round_resolved';
    }
  }

  // A `checkGameEndConditions` hívás maradjon itt, mert a kör lezárása is okozhatja a játék végét
  newState = checkGameEndConditions(newState);

  // Ha a játék nem ért véget, és a körnek sincs vége, a másik játékos jön
  // DE ha csak az első játékos tett le kártyát, akkor most jön a másik.
  if (newState.gameStatus === 'playing' && newState.roundWinnerId === null && newState.currentPlayerId === player.id && newState.currentPlayerPhase === 'turn_ended') {
    const opponentId = getOpponentPlayerState(newState, playerId).id;
    // Ha az ellenfél még nem rakott le autót, akkor az ő köre következik
    if (!newState.carCardsOnBoard[opponentId]) {
      newState.currentPlayerId = opponentId;
      newState.currentTurnStartTime = Date.now(); 
      newState.currentPlayerPhase = 'waiting_for_initial_play'; // Az ellenfél is kezdhet akciókártyával.
      newState.gameLog.push(`--> Most ${getOpponentPlayerState(newState, playerId).name} köre.`);
    }
  }

  return {
    newState: newState,
    success: true,
  };
};


// --- 5. Kör lezárása és győztes meghatározása (Exportált funkció) ---
export const resolveRound = (state: IGameState): IGameState => {
  let newState: IGameState = JSON.parse(JSON.stringify(state));
  const player1 = newState.players[0];
  const player2 = newState.players[1];
  const player1Card = newState.carCardsOnBoard[player1.id];
  const player2Card = newState.carCardsOnBoard[player2.id];

  if (!player1Card || !player2Card || !newState.selectedMetricForRound) {
    throw new Error("GameEngine hiba: Nem lehet lezárni a kört, hiányzó kártya vagy metrika.");
  }

  const metric = newState.selectedMetricForRound;

  // Használjuk a lap aktuális (módosított) metrikáit
  const player1MetricValue = (player1Card.currentMetrics || getCarCardDefinition(player1Card).metrics)[metric];
  const player2MetricValue = (player2Card.currentMetrics || getCarCardDefinition(player2Card).metrics)[metric];

  let roundWinnerId: PlayerId | null = null;
  let message: string;

  // Súly és Gyorsulás metrika fordított logika: alacsonyabb a jobb
  if (metric === 'weight' || metric === 'accel') {
    if (player1MetricValue < player2MetricValue) {
      roundWinnerId = player1.id;
    } else if (player2MetricValue < player1MetricValue) {
      roundWinnerId = player2.id;
    }
  } else { // Minden más metrika: magasabb a jobb
    if (player1MetricValue > player2MetricValue) {
      roundWinnerId = player1.id;
    } else if (player2MetricValue > player1MetricValue) {
      roundWinnerId = player2.id;
    }
  }

  const winner = roundWinnerId ? getPlayerState(newState, roundWinnerId) : null;
  const loser = roundWinnerId ? getOpponentPlayerState(newState, roundWinnerId) : null;

  if (winner && loser) {
    const winnerCard = newState.carCardsOnBoard[winner.id]!;
    const loserCard = newState.carCardsOnBoard[loser.id]!;
    const winnerMetricValue = (winnerCard.currentMetrics || getCarCardDefinition(winnerCard).metrics)[metric];
    const loserMetricValue = (loserCard.currentMetrics || getCarCardDefinition(loserCard).metrics)[metric];
    winner.hand.push(winnerCard, loserCard);
    winner.score += 1; 
    message = `${winner.name} nyerte a kört! (${metric}: ${winnerMetricValue} vs ${loserMetricValue})`;
    // ÚJ RÉSZ: Kézméret limit ellenőrzése
    if (winner.hand.length > 10) {
      newState.currentPlayerPhase = 'must_discard';
      newState.currentPlayerId = winner.id; // A nyertesnek kell dobnia
      newState.gameLog.push(`${winner.name} kezében túl sok lap van (${winner.hand.length}), dobnia kell egyet!`);
  }
  } else {
    // DÖNTETLEN ESETÉN EZ A HELYES LOGIKA:
    player1.hand.push(player1Card);
    player2.hand.push(player2Card);
    message = `Döntetlen a körben! (${metric}: ${player1MetricValue} vs ${player2MetricValue}). A kártyák visszakerültek a játékosokhoz.`;
  }

  newState.roundWinnerId = roundWinnerId;
  newState.gameLog.push(message);
  
  // Tisztítás az asztalról és az aktív akciókártyákról
  newState.carCardsOnBoard = { [player1.id]: null, [player2.id]: null };
  newState.activeActionCardsOnBoard = { [player1.id]: null, [player2.id]: null }; // Akciókártyák elvésznek a kör végén
  
  // Játék vége ellenőrzés
  newState = checkGameEndConditions(newState);
  
  return newState;
};

export const advanceTurn = (state: IGameState, roundWinnerId: PlayerId | null): IGameState => {
  const newState: IGameState = JSON.parse(JSON.stringify(state));
  
  if (newState.gameStatus !== 'playing') {
    return newState; 
  }
  
  newState.roundWinnerId = null; 
  newState.selectedMetricForRound = null;

  let nextPlayerId: PlayerId;
  
  // A győztes meghatározásának logikája helyes.
  if (newState.extraTurnPlayerId) {
    nextPlayerId = newState.extraTurnPlayerId;
    newState.gameLog.push(`--> ${getPlayerState(newState, nextPlayerId).name} extra köre következik.`);
    newState.extraTurnPlayerId = null;
  } else if (roundWinnerId) {
    nextPlayerId = roundWinnerId;
  } else {
    // Döntetlen esetén a kezdési jog nem változik.
    // A currentPlayerId a kör végén a második játékos, így az ellenfele volt a kezdő.
    nextPlayerId = getOpponentPlayerState(newState, newState.currentPlayerId).id;
  }

  newState.currentPlayerId = nextPlayerId;
  newState.currentTurnStartTime = Date.now(); 
  newState.currentPlayerPhase = 'waiting_for_initial_play';

  newState.gameLog.push(`--> Most ${getPlayerState(newState, newState.currentPlayerId).name} köre.`);

  return newState;
};

// --- 7. Játék Vége Feltételek (Exportált funkció) ---
export const checkGameEndConditions = (state: IGameState): IGameState => {
    const newState: IGameState = JSON.parse(JSON.stringify(state));

    // Annak a játékosnak a kártyáit ellenőrizzük, aki épp jönne.
    const currentPlayerState = getPlayerState(newState, newState.currentPlayerId);
    const currentPlayerCarCardsInHand = currentPlayerState.hand.filter(c => isCarCardDef(getCardDefinition(c.cardId)!));
    
    // Az ellenfél autós kártyáinak száma
    const opponentPlayerState = getOpponentPlayerState(newState, newState.currentPlayerId);
    // const opponentCarCardsInHand = opponentPlayerState.hand.filter(c => isCarCardDef(getCardDefinition(c.cardId)!)).length;


    let winnerId: PlayerId | null = null;
    let status: GameStatus = 'playing';
    let reason: string | null = null;

    // 1. Ha valaki kifogyott az autós kártyákból a kezéből, amikor rá kerülne a sor.
    // Ez a feltétel azt ellenőrzi, hogy ha valakinek nincs autós kártyája a kezében, amikor
    // a kör elején (vagy akció után) kellene autós kártyát kijátszania.
    if (currentPlayerCarCardsInHand.length === 0 && 
        (newState.currentPlayerPhase === 'waiting_for_initial_play' || newState.currentPlayerPhase === 'waiting_for_car_card_after_action')) {
        winnerId = opponentPlayerState.id;
        status = 'win'; // Az ellenfél szemszögéből
        reason = `${currentPlayerState.name} kifogyott az autós kártyákból!`;
    }
    
    // 2. Ha minden lap elfogyott a húzópakliból ÉS mindkét játékos kezéből (végső döntetlen)
    // Ezt csak akkor ellenőrizzük, ha még nem találtunk győztest
    if (!winnerId && currentPlayerState.hand.length === 0 && opponentPlayerState.hand.length === 0 && newState.drawPile.length === 0) {
        status = 'tie';
        reason = "Döntetlen - minden lap elfogyott!";
    }

    if (winnerId) {
        newState.winnerId = winnerId;
        newState.gameStatus = status; 
        newState.gameLog.push(`Játék vége! ${getPlayerState(newState, winnerId).name} nyert. Ok: ${reason}`);
    } else if (status === 'tie') { 
        newState.gameStatus = status;
        newState.gameLog.push(`Játék vége! ${reason}`);
    }

    return newState;
};


// --- 8. Server-oldali időtúllépés kezelése (Exportált funkció) ---
// Ezt a szerver hívja meg, ha egy játékos ideje lejárt.
export const endGameByTimeout = (state: IGameState, timedOutPlayerId: PlayerId): IGameState => {
    const newState: IGameState = JSON.parse(JSON.stringify(state));
    if (newState.gameStatus !== 'playing') return newState;

    const opponentOfTimedOut = getOpponentPlayerState(newState, timedOutPlayerId);

    // Ha az időtúllépő játékos épp autós kártyát kellene, hogy tegyen
    // Itt a logikát egyszerűsítjük: ha valaki időtúllép, az ellenfél nyer, függetlenül a lapoktól.
    // Ezt azért tesszük, mert az időtúllépés büntetés, nem pedig egy kártyaszámlálás.
    newState.winnerId = opponentOfTimedOut.id;
    newState.gameStatus = 'win';
    
    const reason = `${getPlayerState(newState, timedOutPlayerId).name} ideje lejárt! ${opponentOfTimedOut.name} nyert.`;
    
    newState.gameLog.push(reason);

    return newState;
};

// --- Kliensnek küldendő állapot szűrése ---
// Ezt a funkciót a szerver hívja meg, mielőtt elküldi a GameState-et a kliensnek.
export const getClientGameState = (serverState: IGameState, requestingPlayerId: PlayerId): IGameState => {
  const clientState: IGameState = JSON.parse(JSON.stringify(serverState));

  // Szűrjük az ellenfél kezét
  clientState.players.forEach(player => {
    if (player.id !== requestingPlayerId) {
      player.hand = player.hand.map(card => ({
          instanceId: card.instanceId, // Az instanceId megtartása fontos az interakcióhoz
          cardId: 'HIDDEN_CARD_BACK', // Kliens oldalon erre az ID-re rendereljük a kártya hátoldalát
          // A többi mező elhagyása, hogy ne szivárogjon ki információ
      }));
    }
  });

  // A húzópakli tartalmát nem küldjük el, csak a méretét
  (clientState as any).drawPileSize = clientState.drawPile.length; // Kliensnek küldjük a méretet
  clientState.drawPile = []; // Ürítjük a tömböt, mielőtt elküldjük

  // RNG seed-et ne küldjük el a kliensnek, az szerver oldali titok
  delete (clientState as any).rngSeed;

  return clientState;
};