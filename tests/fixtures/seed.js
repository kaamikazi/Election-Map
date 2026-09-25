/** The document the suites load into both versions of the studio. */

export const PARTIES = [
  { id: 1, name: 'Social democrats', color: '#D0453E' },
  { id: 2, name: 'Christian democrats', color: '#3B7DD8' },
  { id: 3, name: 'Greens', color: '#3E9E6E' },
  { id: 4, name: 'Hard right', color: '#8659C4' }
];

/** country -> [party, vote %, seat %, turnout %, margin pts] */
export const SEED = {
  'France': [2, 41.2, 52, 68.4, 9.1], 'Germany': [1, 34.8, 39, 76.6, 5.2],
  'Spain': [1, 44.1, 48, 70.1, 12.4], 'Italy': [4, 36.2, 45, 63.9, 8.4],
  'Poland': [2, 37.5, 44, 74.4, 2.1], 'Sweden': [3, 33.2, 36, 84.2, 1.4],
  'Norway': [1, 31.4, 34, 77.2, 1.9], 'Finland': [2, 35.9, 38, 72.0, 3.3],
  'Portugal': [1, 43.0, 46, 59.3, 11.0], 'Greece': [2, 40.6, 51, 61.2, 14.8],
  'Netherlands': [4, 32.1, 35, 78.4, 2.6], 'Belgium': [2, 30.8, 33, 88.4, 0.9],
  'Austria': [4, 38.4, 41, 76.2, 6.1], 'Ireland': [2, 36.0, 39, 62.9, 4.4],
  'Denmark': [1, 39.2, 43, 84.1, 7.8], 'United Kingdom': [1, 39.7, 63, 59.8, 16.3],
  'Switzerland': [2, 33.6, 36, 45.4, 3.0], 'Czechia': [4, 35.2, 40, 65.4, 5.9],
  'Hungary': [4, 52.3, 67, 70.2, 24.1], 'Romania': [1, 34.4, 37, 52.1, 4.9],
  'Ukraine': [3, 41.8, 49, 62.8, 13.7], 'Iceland': [3, 30.2, 32, 80.1, 0.6],
  'Malta': [1, 55.1, 58, 85.5, 12.0], 'Luxembourg': [2, 37.7, 40, 89.7, 5.5]
};

