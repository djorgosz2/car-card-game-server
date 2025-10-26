import { v4 as uuidv4 } from 'uuid'; // Assuming you have uuid installed (npm install uuid)
import { ImageSourcePropType } from 'react-native';
import CarList from './CarList.json';

// Define the Card interface based on your existing structure
export interface Card {
  id: string;
  brand: string;
  model: string;
  carImage: ImageSourcePropType;
  brandLogoUrl: ImageSourcePropType;
  metrics: {
    speed: number;
    hp: number;
    accel: number;
    weight: number;
    // price: number;
    year: number;
  };
  carRank: string; // This will likely be calculated externally
  description: string;
  isSpecial: boolean;
  engineType: string;
}

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
}

/**
 * Converts JSON car data into Card objects.
 *
 * @param jsonData Array of car data from JSON file
 * @returns An array of Card objects
 */
export function parseJsonToCarCards(jsonData: JsonCarData[]): Card[] {
  const cars: Card[] = [];

  jsonData.forEach((carData, index) => {
    try {
      // Safely access values, providing a fallback for missing data
      const brand = carData['Makes: 96'] || 'Unknown Brand';
      const model = carData['Models: 675'] || 'Unknown Model';
      const year = carData.Year || 0;
      const speed = carData['Top Speed'] || 0;
      const hp = carData.HP || 0;
      const accel = carData['0-60 Sec'] || 0;
      const weight = carData.Wt || 0;
      // Remove commas from car value before parsing
      // const price = parseInt(carData['Car Value']?.replace(/,/g, '') || '0') || 0;
      const isSpecial = carData['Special Reward/Gift']?.toLowerCase() === 'yes';
      const engineType = carData.Engine || 'Unknown';
      // if none of the metrics are 0, then add the car to the list
      if (speed === 0 || hp === 0 || accel === 0 || weight === 0 || year === 0) {
        return;
      }
      cars.push({
        id: uuidv4(),
        brand: brand,
        model: model,
        carImage: require('../../../assets/images/card1.jpg'), // Use require for ImageSourcePropType
        brandLogoUrl: require('../../../assets/images/car-icon-1.svg'), // Use require for ImageSourcePropType
        metrics: {
          speed: speed,
          hp: hp,
          accel: accel,
          weight: weight,
          // price: price,
          year: year,
        },
        carRank: 'D', // This will be assigned by your calculateCardRanks function
        description: `The ${brand} ${model} from ${year}.`, // Simple description
        isSpecial: isSpecial,
        engineType: engineType,
      });
    } catch (e) {
      console.error(`Error processing car ${index + 1}:`, carData, 'Error:', e);
    }
  });

  return cars;
}

/**
 * Reads cars from the CarList.json file and returns a limited number of cars.
 *
 * @param maxCars Maximum number of cars to return (default: 50)
 * @returns An array of Card objects
 */
export function readCarsFromJson(maxCars: number = 50): Card[] {
  try {
    console.log('Attempting to read CarList.json...');

    // Import the JSON file content
    const jsonData = CarList as JsonCarData[];
    console.log('JSON data loaded, cars count:', jsonData.length);

    // Parse the JSON content
    const allCars = parseJsonToCarCards(jsonData);
    console.log('Parsed cars from JSON:', allCars.length);

    if (allCars.length > 0) {
      console.log('First car from JSON:', allCars[0].brand, allCars[0].model);
    }

    // Return only the specified number of cars
    const limitedCars = allCars.slice(0, maxCars);
    console.log('Returning cars:', limitedCars.length);

    return limitedCars;
  } catch (error) {
    console.error('Error reading CarList.json:', error);
    // Return empty array if file cannot be read
    return [];
  }
}
