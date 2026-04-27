export const NEGROS_OCCIDENTAL_BOUNDS = {
  minLat: 9.18,
  maxLat: 11.05,
  minLng: 122.22,
  maxLng: 123.35,
}

export const isWithinNegrosOccidental = (lat: number, lng: number) =>
  lat >= NEGROS_OCCIDENTAL_BOUNDS.minLat &&
  lat <= NEGROS_OCCIDENTAL_BOUNDS.maxLat &&
  lng >= NEGROS_OCCIDENTAL_BOUNDS.minLng &&
  lng <= NEGROS_OCCIDENTAL_BOUNDS.maxLng
