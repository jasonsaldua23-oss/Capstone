export const NEGROS_OCCIDENTAL_BOUNDS = {
  minLat: 10.62,
  maxLat: 10.94,
  minLng: 122.86,
  maxLng: 123.08,
}

export const isWithinNegrosOccidental = (lat: number, lng: number) =>
  lat >= NEGROS_OCCIDENTAL_BOUNDS.minLat &&
  lat <= NEGROS_OCCIDENTAL_BOUNDS.maxLat &&
  lng >= NEGROS_OCCIDENTAL_BOUNDS.minLng &&
  lng <= NEGROS_OCCIDENTAL_BOUNDS.maxLng
