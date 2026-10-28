/**
 * Cities crew and projects can pick from. Picking from a list (instead of typing
 * an address) keeps distances reliable without paying for a geocoding service.
 * Add a city by adding a line: code, name, country, latitude, longitude.
 */
const list = [
  ['los_angeles', 'Los Angeles', 'US', 34.0522, -118.2437],
  ['new_york', 'New York', 'US', 40.7128, -74.006],
  ['atlanta', 'Atlanta', 'US', 33.749, -84.388],
  ['chicago', 'Chicago', 'US', 41.8781, -87.6298],
  ['new_orleans', 'New Orleans', 'US', 29.9511, -90.0715],
  ['albuquerque', 'Albuquerque', 'US', 35.0844, -106.6504],
  ['austin', 'Austin', 'US', 30.2672, -97.7431],
  ['miami', 'Miami', 'US', 25.7617, -80.1918],
  ['san_francisco', 'San Francisco', 'US', 37.7749, -122.4194],
  ['seattle', 'Seattle', 'US', 47.6062, -122.3321],
  ['portland', 'Portland', 'US', 45.5152, -122.6784],
  ['denver', 'Denver', 'US', 39.7392, -104.9903],
  ['san_diego', 'San Diego', 'US', 32.7157, -117.1611],
  ['nashville', 'Nashville', 'US', 36.1627, -86.7816],
  ['boston', 'Boston', 'US', 42.3601, -71.0589],
  ['philadelphia', 'Philadelphia', 'US', 39.9526, -75.1652],
  ['pittsburgh', 'Pittsburgh', 'US', 40.4406, -79.9959],
  ['wilmington_nc', 'Wilmington (NC)', 'US', 34.2257, -77.9447],
  ['vancouver', 'Vancouver', 'CA', 49.2827, -123.1207],
  ['toronto', 'Toronto', 'CA', 43.6532, -79.3832],
  ['montreal', 'Montreal', 'CA', 45.5019, -73.5674],
  ['mexico_city', 'Mexico City', 'MX', 19.4326, -99.1332],
  ['london', 'London', 'GB', 51.5072, -0.1276],
  ['manchester', 'Manchester', 'GB', 53.4808, -2.2426],
  ['glasgow', 'Glasgow', 'GB', 55.8642, -4.2518],
  ['dublin', 'Dublin', 'IE', 53.3498, -6.2603],
  ['paris', 'Paris', 'FR', 48.8566, 2.3522],
  ['berlin', 'Berlin', 'DE', 52.52, 13.405],
  ['munich', 'Munich', 'DE', 48.1351, 11.582],
  ['rome', 'Rome', 'IT', 41.9028, 12.4964],
  ['milan', 'Milan', 'IT', 45.4642, 9.19],
  ['naples', 'Naples', 'IT', 40.8518, 14.2681],
  ['turin', 'Turin', 'IT', 45.0703, 7.6869],
  ['madrid', 'Madrid', 'ES', 40.4168, -3.7038],
  ['barcelona', 'Barcelona', 'ES', 41.3874, 2.1686],
  ['lisbon', 'Lisbon', 'PT', 38.7223, -9.1393],
  ['amsterdam', 'Amsterdam', 'NL', 52.3676, 4.9041],
  ['brussels', 'Brussels', 'BE', 50.8503, 4.3517],
  ['prague', 'Prague', 'CZ', 50.0755, 14.4378],
  ['budapest', 'Budapest', 'HU', 47.4979, 19.0402],
  ['belgrade', 'Belgrade', 'RS', 44.7866, 20.4489],
  ['malta', 'Malta (Valletta)', 'MT', 35.8989, 14.5146],
  ['sydney', 'Sydney', 'AU', -33.8688, 151.2093],
  ['melbourne', 'Melbourne', 'AU', -37.8136, 144.9631],
  ['auckland', 'Auckland', 'NZ', -36.8485, 174.7633],
  ['cape_town', 'Cape Town', 'ZA', -33.9249, 18.4241],
];

const cities = list.map(([code, name, country, lat, lng]) => ({ code, name, country, lat, lng }));
const byCode = Object.fromEntries(cities.map((c) => [c.code, c]));

function findCity(code) {
  return byCode[code] || null;
}

module.exports = { cities, findCity };
